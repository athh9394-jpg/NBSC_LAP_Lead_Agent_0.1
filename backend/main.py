import json
import os
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

import firebase_admin
from firebase_admin import auth, credentials


load_dotenv()

APP_NAME = "NBSC LAP Lead Agent"
API_TOKEN = os.getenv("APP_API_TOKEN", "").strip()
ADMIN_UID = os.getenv("ADMIN_UID", "").strip()
DB_PATH = os.getenv("DB_PATH", "./leads.db")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
FIREBASE_CREDENTIALS_JSON = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()

app = FastAPI(title=APP_NAME, version="1.0.0")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    ["*"]
    if allowed_origins_raw.strip() == "*"
    else [origin.strip() for origin in allowed_origins_raw.split(",") if origin.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False if "*" in ALLOWED_ORIGINS else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def initialize_firebase() -> None:
    """Initialize Firebase Admin only when credentials are configured."""
    if firebase_admin._apps:
        return

    try:
        if FIREBASE_CREDENTIALS_JSON:
            credential_data = json.loads(FIREBASE_CREDENTIALS_JSON)
            firebase_credential = credentials.Certificate(credential_data)
            firebase_admin.initialize_app(firebase_credential)
        else:
            # Uses GOOGLE_APPLICATION_CREDENTIALS or the runtime's default credentials.
            firebase_admin.initialize_app()
    except Exception:
        # API-token-protected endpoints can still run without Firebase Admin.
        # Firebase verification will return a clear error if it is used.
        return


initialize_firebase()


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with closing(connect_db()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS leads (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                city TEXT DEFAULT '',
                product TEXT DEFAULT '',
                source TEXT DEFAULT '',
                budget REAL DEFAULT 0,
                consent_status TEXT DEFAULT 'pending',
                score INTEGER DEFAULT 0,
                status TEXT DEFAULT 'new',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


@app.on_event("startup")
def startup() -> None:
    init_db()


def verify_firebase_token(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Firebase login required")

    scheme, separator, token = authorization.partition(" ")
    if (
        scheme.lower() != "bearer"
        or separator != " "
        or not token
        or token != token.strip()
        or " " in token
        or "\t" in token
    ):
        raise HTTPException(status_code=401, detail="Invalid Authorization header")

    if not firebase_admin._apps:
        raise HTTPException(
            status_code=503,
            detail="Firebase Admin is not configured on the server",
        )

    try:
        decoded = auth.verify_id_token(token)
        uid = decoded.get("uid")
        if not uid:
            raise ValueError("Firebase token has no uid")
        return {"uid": uid, "is_admin": bool(ADMIN_UID and uid == ADMIN_UID)}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")


def require_token(
    authorization: Optional[str] = Header(default=None),
) -> bool:
    if not API_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="APP_API_TOKEN is not configured on the server",
        )
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header is missing",
        )

    scheme, separator, token = authorization.partition(" ")
    if (
        scheme.lower() != "bearer"
        or separator != " "
        or not token
        or token != API_TOKEN
    ):
        raise HTTPException(status_code=401, detail="Authentication required")

    return True


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    if not 10 <= len(digits) <= 15:
        raise HTTPException(
            status_code=422,
            detail="Phone number must contain 10 to 15 digits",
        )
    return "+" + digits


def calculate_score(
    budget: float,
    consent_status: str,
    source: str = "",
    product: str = "",
) -> int:
    score = 0
    if budget >= 1000000:
        score += 35
    elif budget >= 500000:
        score += 25
    elif budget >= 100000:
        score += 15
    elif budget > 0:
        score += 5

    if consent_status.lower() in {"yes", "given", "consented", "true"}:
        score += 25

    if source.strip():
        score += 10
    if product.strip():
        score += 10

    return min(score, 100)


class LeadCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    phone: str = Field(..., min_length=10, max_length=30)
    city: str = Field(default="", max_length=120)
    product: str = Field(default="", max_length=120)
    source: str = Field(default="website", max_length=120)
    budget: float = Field(default=0, ge=0)
    consent_status: str = Field(default="pending", max_length=30)
    status: str = Field(default="new", max_length=50)
    notes: str = Field(default="", max_length=2000)


ALLOWED_FIELDS = {
    "name",
    "phone",
    "city",
    "product",
    "source",
    "budget",
    "consent_status",
    "status",
    "notes",
}


@app.get("/")
def root() -> dict:
    return {"name": APP_NAME, "status": "ok", "docs": "/docs"}


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": APP_NAME,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/lead")
def create_lead(
    payload: LeadCreateRequest,
    _authorized: bool = Depends(require_token),
) -> dict:
    data = payload.model_dump()
    data["name"] = data["name"].strip()
    data["phone"] = normalize_phone(data["phone"])
    data["city"] = data["city"].strip()
    data["product"] = data["product"].strip()
    data["source"] = data["source"].strip()
    data["consent_status"] = data["consent_status"].strip().lower()
    data["status"] = data["status"].strip() or "new"
    data["notes"] = data["notes"].strip()

    if data["consent_status"] not in {
        "pending",
        "yes",
        "no",
        "given",
        "consented",
        "true",
        "false",
    }:
        raise HTTPException(status_code=422, detail="Invalid consent_status")

    data["score"] = calculate_score(
        data["budget"],
        data["consent_status"],
        data["source"],
        data["product"],
    )
    now = datetime.now(timezone.utc).isoformat()

    with closing(connect_db()) as connection:
        existing = connection.execute(
            "SELECT id FROM leads WHERE phone = ?",
            (data["phone"],),
        ).fetchone()

        if existing:
            lead_id = existing["id"]
            connection.execute(
                """
                UPDATE leads
                SET name = ?, city = ?, product = ?, source = ?, budget = ?,
                    consent_status = ?, score = ?, status = ?, notes = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    data["name"],
                    data["city"],
                    data["product"],
                    data["source"],
                    data["budget"],
                    data["consent_status"],
                    data["score"],
                    data["status"],
                    data["notes"],
                    now,
                    lead_id,
                ),
            )
            created = False
        else:
            lead_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO leads (
                    id, name, phone, city, product, source, budget,
                    consent_status, score, status, notes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lead_id,
                    data["name"],
                    data["phone"],
                    data["city"],
                    data["product"],
                    data["source"],
                    data["budget"],
                    data["consent_status"],
                    data["score"],
                    data["status"],
                    data["notes"],
                    now,
                    now,
                ),
            )
            created = True

        connection.commit()
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()

    return {"success": True, "created": created, "lead": dict(row)}


@app.get("/leads")
def list_leads(
    limit: int = 100,
    _authorized: bool = Depends(require_token),
) -> dict:
    limit = max(1, min(limit, 500))
    with closing(connect_db()) as connection:
        rows = connection.execute(
            "SELECT * FROM leads ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"success": True, "count": len(rows), "leads": [dict(row) for row in rows]}


@app.get("/lead/{lead_id}")
def get_lead(
    lead_id: str,
    _authorized: bool = Depends(require_token),
) -> dict:
    with closing(connect_db()) as connection:
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"success": True, "lead": dict(row)}


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request) -> Response:
    form = await request.form()

    # Validate Twilio's signature when a Twilio auth token is configured.
    if TWILIO_AUTH_TOKEN:
        signature = request.headers.get("X-Twilio-Signature", "")
        validator = RequestValidator(TWILIO_AUTH_TOKEN)
        form_data = {key: value for key, value in form.items()}
        if not validator.validate(str(request.url), form_data, signature):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    incoming_body = str(form.get("Body", "")).strip().lower()
    response = MessagingResponse()

    if incoming_body in {"hi", "hello", "start", "namaste"}:
        response.message(
            "Namaste! NBSC LAP team se sampark karne ke liye dhanyavaad. "
            "Agar aap follow-up ke liye sahmat hain, YES reply karein; "
            "mana karne ke liye NO reply karein. Kripya PAN, Aadhaar ya bank "
            "documents WhatsApp par na bhejein."
        )
    elif incoming_body in {"yes", "haan", "ha", "y"}:
        response.message(
            "Dhanyavaad. Aapki follow-up consent note kar li gayi hai. "
            "Team secure system se sampark karegi. Kripya PAN, Aadhaar ya "
            "bank documents WhatsApp par na bhejein."
        )
    elif incoming_body in {"no", "nahi", "nahin", "n"}:
        response.message(
            "Theek hai. Aapne follow-up se mana kiya hai. "
            "Aapko is request par aage follow-up nahi kiya jayega."
        )
    else:
        response.message(
            "Madad ke liye HI reply karein. Kripya PAN, Aadhaar ya bank "
            "documents WhatsApp par na bhejein."
        )

    return Response(content=str(response), media_type="application/xml")

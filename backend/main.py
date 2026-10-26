import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

load_dotenv()

DB_PATH = os.getenv("DB_PATH", "./leads.db")
API_TOKEN = os.getenv("APP_API_TOKEN", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
FRONTEND_ORIGINS = [x.strip() for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",") if x.strip()]

app = FastAPI(title="NBSC LAP Lead Agent", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Twilio-Signature"],
)

ALLOWED_FIELDS = {
    "phone", "name", "city", "property_type", "property_value", "loan_amount",
    "source", "employment_type", "monthly_income", "loan_purpose", "existing_emi",
    "property_ownership", "consent_status", "lead_status", "qualification_score",
    "qualification_label", "notes", "assigned_agent", "last_message"
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def connect_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with closing(connect_db()) as conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            phone TEXT NOT NULL UNIQUE,
            name TEXT, city TEXT, property_type TEXT,
            property_value REAL, loan_amount REAL, source TEXT,
            employment_type TEXT, monthly_income REAL, loan_purpose TEXT,
            existing_emi TEXT, property_ownership TEXT, consent_status TEXT NOT NULL DEFAULT 'pending',
            lead_status TEXT NOT NULL DEFAULT 'new',
            qualification_score INTEGER NOT NULL DEFAULT 0,
            qualification_label TEXT NOT NULL DEFAULT 'cold',
            notes TEXT, assigned_agent TEXT, last_message TEXT
        )
        """)
        conn.commit()

@app.on_event("startup")
def startup():
    init_db()

def require_token(authorization: Optional[str] = Header(default=None)):
    # Private/demo starter: set APP_API_TOKEN before using any lead endpoints.
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="Server setup incomplete: APP_API_TOKEN is not configured")
    expected = f"Bearer {API_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Authentication required")

def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    if len(digits) < 10 or len(digits) > 15:
        raise HTTPException(status_code=422, detail="Enter a valid phone number")
    return "+" + digits

def lead_dict(row):
    result = dict(row)
    # Do not expose phone number in the dashboard list; detail endpoint includes it for authorized users.
    return result

def calculate_score(data: dict) -> tuple[int, str]:
    score = 0
    value = float(data.get("property_value") or 0)
    loan = float(data.get("loan_amount") or 0)
    income = float(data.get("monthly_income") or 0)
    ltv = loan / value if value > 0 else 0

    if value > 0 and loan > 0 and 0.20 <= ltv <= 0.70:
        score += 25
    elif loan > 0 and value > 0:
        score -= 10

    if income >= 60000:
        score += 20
    elif income >= 30000:
        score += 10
    else:
        score -= 10

    employment = (data.get("employment_type") or "").lower()
    if employment in {"salaried", "self-employed", "business owner", "business_owner"}:
        score += 15
    if (data.get("loan_purpose") or "").strip():
        score += 8

    ownership = (data.get("property_ownership") or "").lower().strip()
    if ownership in {"owned", "own", "fully owned", "fully_owned"}:
        score += 10
    elif ownership in {"mortgage", "partly owned", "partly_owned"}:
        score += 5

    emi = (data.get("existing_emi") or "").lower().strip()
    if emi in {"no", "n", "none"}:
        score += 10
    elif emi in {"yes", "y"}:
        score -= 5

    if (data.get("consent_status") or "").lower() == "approved":
        score += 8

    score = max(0, min(100, score))
    label = "hot" if score >= 70 else ("warm" if score >= 45 else "cold")
    return score, label

class LeadCreateRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=20)
    name: Optional[str] = Field(default=None, max_length=100)
    city: Optional[str] = Field(default=None, max_length=100)
    property_type: Optional[str] = Field(default=None, max_length=80)
    property_value: Optional[float] = Field(default=None, ge=0, le=1_000_000_000)
    loan_amount: Optional[float] = Field(default=None, ge=0, le=1_000_000_000)
    source: str = Field(default="website", max_length=80)
    employment_type: Optional[str] = Field(default=None, max_length=80)
    monthly_income: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    loan_purpose: Optional[str] = Field(default=None, max_length=200)
    existing_emi: Optional[str] = Field(default=None, max_length=10)
    property_ownership: Optional[str] = Field(default=None, max_length=80)
    consent_status: str = Field(default="pending", max_length=20)
    notes: Optional[str] = Field(default=None, max_length=2000)

@app.get("/health")
def health():
    return {"status": "ok", "service": "NBSC LAP Lead Agent"}

@app.post("/lead", dependencies=[Depends(require_token)])
def create_lead(payload: LeadCreateRequest):
    data = payload.model_dump()
    data["phone"] = normalize_phone(data["phone"])
    if data["consent_status"].lower() not in {"pending", "approved", "declined"}:
        raise HTTPException(status_code=422, detail="consent_status must be pending, approved, or declined")

    score, label = calculate_score(data)
    timestamp = now_iso()
    with closing(connect_db()) as conn:
        existing = conn.execute("SELECT id FROM leads WHERE phone=?", (data["phone"],)).fetchone()
        if existing:
            lead_id = existing["id"]
            updates = {k: v for k, v in data.items() if k in ALLOWED_FIELDS and k != "phone" and v is not None}
            updates.update({"updated_at": timestamp, "qualification_score": score, "qualification_label": label})
            sql = ", ".join(f"{key}=?" for key in updates)
            conn.execute(f"UPDATE leads SET {sql} WHERE id=?", (*updates.values(), lead_id))
        else:
            import uuid
            lead_id = str(uuid.uuid4())
            data.update({
                "id": lead_id, "created_at": timestamp, "updated_at": timestamp,
                "lead_status": "new", "qualification_score": score, "qualification_label": label,
            })
            cols = list(data.keys())
            conn.execute(
                f"INSERT INTO leads ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                [data[k] for k in cols]
            )
        conn.commit()
        row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    return lead_dict(row)

@app.get("/leads", dependencies=[Depends(require_token)])
def list_leads():
    with closing(connect_db()) as conn:
        rows = conn.execute("""
            SELECT id, created_at, updated_at, name, city, source, property_value,
                   loan_amount, employment_type, monthly_income, consent_status,
                   lead_status, qualification_score, qualification_label, assigned_agent
            FROM leads ORDER BY updated_at DESC LIMIT 500
        """).fetchall()
    return [dict(row) for row in rows]

@app.get("/lead/{lead_id}", dependencies=[Depends(require_token)])
def get_lead(lead_id: str):
    with closing(connect_db()) as conn:
        row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead_dict(row)

@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request):
    form = await request.form()
    form_data = dict(form)
    if TWILIO_AUTH_TOKEN:
        signature = request.headers.get("X-Twilio-Signature", "")
        validator = RequestValidator(TWILIO_AUTH_TOKEN)
        # Twilio signature validation should be tested against the exact public URL and proxy setup.
        if not validator.validate(str(request.url), form_data, signature):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    body = str(form.get("Body", "")).strip().lower()
    response = MessagingResponse()
    if body in {"hi", "hello", "start", "namaste"}:
        response.message(
            "Namaste! NBSC LAP inquiry ke liye message karne ka dhanyavaad. "
            "Kya aap chahte hain ki hamari team aapki inquiry par sampark kare? "
            "Reply YES ya NO. PAN/Aadhaar ya bank documents WhatsApp par na bhejein."
        )
    elif body in {"yes", "haan", "ha", "y"}:
        response.message(
            "Dhanyavaad. Aapki consent note karne ke liye team ko secure system se follow-up karna hoga. "
            "Kripya yahan PAN/Aadhaar ya bank documents share na karein."
        )
    elif body in {"no", "nahi", "nahin", "n"}:
        response.message("Theek hai. Aapki request par follow-up nahi kiya jayega.")
    else:
        response.message("Help ke liye HI bhejein. PAN/Aadhaar ya bank documents WhatsApp par na bhejein.")
    return str(response)

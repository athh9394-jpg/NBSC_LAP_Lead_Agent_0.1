
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
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

import firebase_admin
from firebase_admin import auth, credentials

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # SQLite remains available for local development.
    psycopg = None
    dict_row = None


load_dotenv()

APP_NAME = "NBSC LAP Lead Agent"
API_TOKEN = os.getenv("APP_API_TOKEN", "").strip()
ADMIN_UID = os.getenv("ADMIN_UID", "").strip()
SUPABASE_ADMIN_UID = os.getenv("SUPABASE_ADMIN_UID", "920128ab-041c-4955-8e4a-b3574da4e733").strip()
DB_PATH = os.getenv("DB_PATH", "./leads.db")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
FIREBASE_CREDENTIALS_JSON = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()

app = FastAPI(title=APP_NAME, version="1.0.0")

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    ["*"]
    if allowed_origins_raw.strip() == "*"
    else [
        origin.strip()
        for origin in allowed_origins_raw.split(",")
        if origin.strip()
    ]
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
            # Uses GOOGLE_APPLICATION_CREDENTIALS or runtime default credentials.
            firebase_admin.initialize_app()
    except Exception:
        # API-token-protected endpoints can still run without Firebase Admin.
        return


initialize_firebase()


class DatabaseConnection:
    """Small adapter so the existing parameterized queries work with SQLite or PostgreSQL."""

    def __init__(self):
        if USE_POSTGRES:
            if psycopg is None:
                raise RuntimeError("DATABASE_URL is set but psycopg is not installed")
            self.connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
            self.is_postgres = True
        else:
            self.connection = sqlite3.connect(DB_PATH, timeout=30)
            self.connection.row_factory = sqlite3.Row
            self.is_postgres = False

    def execute(self, query, params=()):
        if self.is_postgres:
            query = query.replace("?", "%s")
        return self.connection.execute(query, params)

    def commit(self):
        return self.connection.commit()

    def close(self):
        return self.connection.close()


def connect_db() -> DatabaseConnection:
    return DatabaseConnection()


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
                monthly_income REAL DEFAULT 0,
                customer_type TEXT DEFAULT 'business',
                consent_status TEXT DEFAULT 'pending',
                score INTEGER DEFAULT 0,
                status TEXT DEFAULT 'new',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        if USE_POSTGRES:
            columns = {
                row["name"]
                for row in connection.execute(
                    "SELECT column_name AS name FROM information_schema.columns "
                    "WHERE table_schema = current_schema() AND table_name = 'leads'"
                ).fetchall()
            }
        else:
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(leads)").fetchall()
            }

        if "monthly_income" not in columns:
            connection.execute("ALTER TABLE leads ADD COLUMN monthly_income REAL DEFAULT 0")
        if "customer_type" not in columns:
            connection.execute("ALTER TABLE leads ADD COLUMN customer_type TEXT DEFAULT 'business'")
        if "owner_uid" not in columns:
            connection.execute("ALTER TABLE leads ADD COLUMN owner_uid TEXT NULL")
        if "assigned_to_uid" not in columns:
            connection.execute("ALTER TABLE leads ADD COLUMN assigned_to_uid TEXT NULL")
        connection.execute("""CREATE TABLE IF NOT EXISTS agent_accounts (
            uid TEXT PRIMARY KEY,
            is_blocked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            email TEXT DEFAULT '',
            display_name TEXT DEFAULT ''
        )""")
        if USE_POSTGRES:
            agent_columns = {row["name"] for row in connection.execute(
                "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agent_accounts'"
            ).fetchall()}
        else:
            agent_columns = {row["name"] for row in connection.execute("PRAGMA table_info(agent_accounts)").fetchall()}
        if "email" not in agent_columns:
            connection.execute("ALTER TABLE agent_accounts ADD COLUMN email TEXT DEFAULT ''")
        if "display_name" not in agent_columns:
            connection.execute("ALTER TABLE agent_accounts ADD COLUMN display_name TEXT DEFAULT ''")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_leads_owner_created ON leads (owner_uid, created_at)")
        connection.execute("""CREATE TABLE IF NOT EXISTS lead_followups (
            id TEXT PRIMARY KEY,
            lead_id TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT 'call',
            outcome TEXT NOT NULL DEFAULT 'attempted',
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )""")
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
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header",
        )

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
        return {
            "uid": uid,
            "is_admin": bool(ADMIN_UID and uid == ADMIN_UID),
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")


# Enables the standard Authorize button in Swagger /docs.
api_bearer = HTTPBearer(auto_error=False)


SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()

def require_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(api_bearer),
) -> dict:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Set SUPABASE_URL and SUPABASE_ANON_KEY on Render backend")
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Login required")
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(
            SUPABASE_URL + "/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer " + credentials.credentials,
            },
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            user = json.loads(response.read().decode("utf-8"))
        if not user.get("id"):
            raise ValueError("Missing user id")
        uid = user["id"]
        email = (user.get("email") or "").strip().lower()
        metadata = user.get("user_metadata") or {}
        display_name = (metadata.get("full_name") or metadata.get("name") or metadata.get("display_name") or "").strip()
        is_admin = bool(SUPABASE_ADMIN_UID and uid == SUPABASE_ADMIN_UID)
        with closing(connect_db()) as connection:
            account = connection.execute(
                "SELECT is_blocked FROM agent_accounts WHERE uid = ?", (uid,)
            ).fetchone()
            if not is_admin:
                if account is None:
                    connection.execute(
                        "INSERT INTO agent_accounts (uid, is_blocked, created_at, email, display_name) VALUES (?, 0, ?, ?, ?)",
                        (uid, datetime.now(timezone.utc).isoformat(), email, display_name),
                    )
                else:
                    connection.execute(
                        "UPDATE agent_accounts SET email = ?, display_name = ? WHERE uid = ?",
                        (email, display_name, uid),
                    )
                connection.commit()
                account = connection.execute(
                    "SELECT is_blocked FROM agent_accounts WHERE uid = ?", (uid,)
                ).fetchone()
        if account and bool(account["is_blocked"]) and not is_admin:
            raise HTTPException(status_code=403, detail="Your agent account is blocked. Contact admin.")
        return {"uid": uid, "email": email, "display_name": display_name, "phone": user.get("phone", ""), "is_admin": is_admin}
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=401, detail="Session invalid. Please sign in again")
        raise HTTPException(
            status_code=503,
            detail="Authentication service is temporarily unavailable. Please try again.",
        )
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(
            status_code=503,
            detail="Authentication service is temporarily unavailable. Please try again.",
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Session invalid. Please sign in again")

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
    monthly_income: float = Field(default=0, ge=0)
    customer_type: str = Field(default="business", max_length=20)
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
    "monthly_income",
    "customer_type",
    "consent_status",
    "status",
    "notes",
}


@app.get("/")
def root() -> dict:
    return {
        "name": APP_NAME,
        "status": "ok",
        "docs": "/docs",
    }


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
    user: dict = Depends(require_token),
) -> dict:
    data = payload.model_dump()

    data["name"] = data["name"].strip()
    data["phone"] = normalize_phone(data["phone"])
    data["city"] = data["city"].strip()
    data["product"] = data["product"].strip()
    data["source"] = data["source"].strip()
    data["customer_type"] = data["customer_type"].strip().lower()
    if data["customer_type"] not in {"business", "salary"}:
        raise HTTPException(status_code=422, detail="customer_type must be business or salary")
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
        raise HTTPException(
            status_code=422,
            detail="Invalid consent_status",
        )

    data["score"] = calculate_score(
        data["budget"],
        data["consent_status"],
        data["source"],
        data["product"],
    )

    now = datetime.now(timezone.utc).isoformat()

    with closing(connect_db()) as connection:
        existing = connection.execute(
            "SELECT id FROM leads WHERE phone = ? AND owner_uid = ?",
            (data["phone"], user["uid"]),
        ).fetchone()

        if existing:
            lead_id = existing["id"]

            connection.execute(
                """
                UPDATE leads
                SET name = ?, city = ?, product = ?, source = ?, budget = ?,
                    monthly_income = ?, customer_type = ?, consent_status = ?, score = ?, status = ?, notes = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    data["name"],
                    data["city"],
                    data["product"],
                    data["source"],
                    data["budget"],
                    data["monthly_income"],
                    data["customer_type"],
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
                    monthly_income, customer_type, consent_status, score, status, notes, created_at, updated_at, owner_uid
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lead_id,
                    data["name"],
                    data["phone"],
                    data["city"],
                    data["product"],
                    data["source"],
                    data["budget"],
                    data["monthly_income"],
                    data["customer_type"],
                    data["consent_status"],
                    data["score"],
                    data["status"],
                    data["notes"],
                    now,
                    now,
                    user["uid"],
                ),
            )
            created = True

        connection.commit()

        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()

    return {
        "success": True,
        "created": created,
        "lead": dict(row),
    }


@app.get("/leads")
def list_leads(
    limit: int = 100,
    user: dict = Depends(require_token),
) -> dict:
    limit = max(1, min(limit, 500))

    with closing(connect_db()) as connection:
        if user["is_admin"]:
            rows = connection.execute("SELECT * FROM leads ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        else:
            rows = connection.execute("SELECT * FROM leads WHERE owner_uid = ? OR assigned_to_uid = ? ORDER BY created_at DESC LIMIT ?", (user["uid"], user["uid"], limit)).fetchall()

    return {
        "success": True,
        "count": len(rows),
        "leads": [dict(row) for row in rows],
    }


class FollowUpCreateRequest(BaseModel):
    channel: str = Field(default="call", max_length=20)
    outcome: str = Field(default="attempted", max_length=40)
    notes: str = Field(default="", max_length=2000)


class LeadStatusUpdate(BaseModel):
    status: str = Field(..., min_length=1, max_length=50)


@app.get("/lead/{lead_id}/followups")
def list_followups(lead_id: str, user: dict = Depends(require_token)) -> dict:
    with closing(connect_db()) as connection:
        exists = connection.execute("SELECT id FROM leads WHERE id = ?" + ("" if user["is_admin"] else " AND (owner_uid = ? OR assigned_to_uid = ?)"),
            (lead_id,) if user["is_admin"] else (lead_id, user["uid"], user["uid"])).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Lead not found")
        rows = connection.execute(
            "SELECT * FROM lead_followups WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,)
        ).fetchall()
    return {"success": True, "count": len(rows), "followups": [dict(row) for row in rows]}


@app.post("/lead/{lead_id}/followups")
def add_followup(lead_id: str, payload: FollowUpCreateRequest, user: dict = Depends(require_token)) -> dict:
    channel = payload.channel.strip().lower()
    outcome = payload.outcome.strip().lower()
    if channel not in {"call", "whatsapp", "in_person", "other"}:
        raise HTTPException(status_code=422, detail="Invalid follow-up channel")
    if outcome not in {"attempted", "connected", "no_answer", "callback", "interested", "not_interested", "converted"}:
        raise HTTPException(status_code=422, detail="Invalid follow-up outcome")
    now = datetime.now(timezone.utc).isoformat()
    followup_id = str(uuid.uuid4())
    with closing(connect_db()) as connection:
        exists = connection.execute(
            "SELECT id, consent_status FROM leads WHERE id = ?" + ("" if user["is_admin"] else " AND (owner_uid = ? OR assigned_to_uid = ?)"),
            (lead_id,) if user["is_admin"] else (lead_id, user["uid"], user["uid"]),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Lead not found")
        if str(exists["consent_status"] or "").strip().lower() in {"no", "false"}:
            raise HTTPException(
                status_code=403,
                detail="Customer has declined follow-up. Update consent only after renewed permission.",
            )
        connection.execute(
            "INSERT INTO lead_followups (id, lead_id, channel, outcome, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (followup_id, lead_id, channel, outcome, payload.notes.strip(), now),
        )
        new_status = "converted" if outcome == "converted" else ("not_interested" if outcome == "not_interested" else "follow_up")
        connection.execute("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?", (new_status, now, lead_id))
        connection.commit()
        row = connection.execute("SELECT * FROM lead_followups WHERE id = ?", (followup_id,)).fetchone()
    return {"success": True, "followup": dict(row)}


@app.patch("/lead/{lead_id}/status")
def update_lead_status(lead_id: str, payload: LeadStatusUpdate, user: dict = Depends(require_token)) -> dict:
    allowed = {"new", "follow_up", "converted", "not_interested", "not_converted"}
    status = payload.status.strip().lower()
    if status not in allowed:
        raise HTTPException(status_code=422, detail="Invalid lead status")
    now = datetime.now(timezone.utc).isoformat()
    with closing(connect_db()) as connection:
        cursor = connection.execute("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?" + ("" if user["is_admin"] else " AND (owner_uid = ? OR assigned_to_uid = ?)"), (status, now, lead_id) if user["is_admin"] else (status, now, lead_id, user["uid"], user["uid"]))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lead not found")
        connection.commit()
        row = connection.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
    return {"success": True, "lead": dict(row)}


@app.get("/lead/{lead_id}")
def get_lead(
    lead_id: str,
    user: dict = Depends(require_token),
) -> dict:
    with closing(connect_db()) as connection:
        row = connection.execute(
            "SELECT * FROM leads WHERE id = ?" + ("" if user["is_admin"] else " AND (owner_uid = ? OR assigned_to_uid = ?)"),
            (lead_id,) if user["is_admin"] else (lead_id, user["uid"], user["uid"]),
        ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Lead not found",
        )

    return {
        "success": True,
        "lead": dict(row),
    }


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request) -> Response:
    form = await request.form()

    # Validate Twilio's signature when an auth token is configured.
    if TWILIO_AUTH_TOKEN:
        signature = request.headers.get("X-Twilio-Signature", "")
        validator = RequestValidator(TWILIO_AUTH_TOKEN)
        form_data = {key: value for key, value in form.items()}

        if not validator.validate(str(request.url), form_data, signature):
            raise HTTPException(
                status_code=403,
                detail="Invalid Twilio signature",
            )

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

    return Response(
        content=str(response),
        media_type="application/xml",
    )




@app.get("/me")
def current_user(user: dict = Depends(require_token)) -> dict:
    """Return the authenticated user's identity and role for safe UI rendering."""
    return {key: user.get(key) for key in ("uid", "email", "display_name", "phone", "is_admin")}


@app.get("/admin/agents")
def list_agents(user: dict = Depends(require_token)) -> dict:
    """List agents seen by the backend; never expose this data to non-admin users."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    with closing(connect_db()) as connection:
        rows = connection.execute(
            """
            SELECT a.uid, a.email, a.display_name, a.is_blocked, a.created_at,
                   COUNT(l.id) AS lead_count
            FROM agent_accounts a
            LEFT JOIN leads l ON (l.owner_uid = a.uid OR l.assigned_to_uid = a.uid)
            WHERE a.uid <> ?
            GROUP BY a.uid, a.email, a.display_name, a.is_blocked, a.created_at
            ORDER BY a.created_at DESC
            """,
            (SUPABASE_ADMIN_UID,),
        ).fetchall()
    return {"success": True, "agents": [dict(row) for row in rows]}




class AssignLeadRequest(BaseModel):
    agent_uid: Optional[str] = Field(default=None, max_length=200)




@app.get("/admin/agents/{agent_uid}/activity")
def get_agent_activity(agent_uid: str, user: dict = Depends(require_token)) -> dict:
    """Return an agent's identity, leads, and follow-up activity to admins."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    with closing(connect_db()) as connection:
        agent = connection.execute("SELECT uid, email, display_name, is_blocked, created_at FROM agent_accounts WHERE uid = ?", (agent_uid,)).fetchone()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found. Agent must sign in once to register.")
        leads = connection.execute("SELECT id, name, phone, city, status, created_at, updated_at, owner_uid, assigned_to_uid FROM leads WHERE owner_uid = ? OR assigned_to_uid = ? ORDER BY updated_at DESC", (agent_uid, agent_uid)).fetchall()
        followups = connection.execute("SELECT f.id, f.lead_id, f.channel, f.outcome, f.notes, f.created_at, l.name AS lead_name FROM lead_followups f JOIN leads l ON l.id = f.lead_id WHERE l.owner_uid = ? OR l.assigned_to_uid = ? ORDER BY f.created_at DESC LIMIT 200", (agent_uid, agent_uid)).fetchall()
    identity = dict(agent)
    identity["display_label"] = identity.get("display_name") or identity.get("email") or identity.get("uid")
    return {"agent": identity, "leads": [dict(row) for row in leads], "followups": [dict(row) for row in followups]}

@app.get("/admin/leads/assignable")
def list_assignable_leads(user: dict = Depends(require_token)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    with closing(connect_db()) as connection:
        rows = connection.execute("SELECT id, name, phone, city, owner_uid, assigned_to_uid, status, created_at FROM leads ORDER BY created_at DESC LIMIT 500").fetchall()
        agents = connection.execute("SELECT uid, email, display_name FROM agent_accounts WHERE uid <> ? AND is_blocked = 0 ORDER BY created_at DESC", (SUPABASE_ADMIN_UID,)).fetchall()
    return {"success": True, "leads": [dict(row) for row in rows], "agents": [dict(row) for row in agents]}


@app.patch("/admin/leads/{lead_id}/assign")
def assign_lead(lead_id: str, payload: AssignLeadRequest, user: dict = Depends(require_token)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    with closing(connect_db()) as connection:
        lead = connection.execute("SELECT id FROM leads WHERE id = ?", (lead_id,)).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        if payload.agent_uid:
            agent = connection.execute("SELECT uid FROM agent_accounts WHERE uid = ? AND is_blocked = 0", (payload.agent_uid,)).fetchone()
            if not agent:
                raise HTTPException(status_code=404, detail="Active agent not found")
        connection.execute("UPDATE leads SET assigned_to_uid = ? WHERE id = ?", (payload.agent_uid, lead_id))
        connection.commit()
    return {"success": True, "lead_id": lead_id, "assigned_to_uid": payload.agent_uid}

class AgentBlockRequest(BaseModel):
    is_blocked: bool


@app.patch("/admin/agents/{agent_uid}/block")
def set_agent_block(agent_uid: str, payload: AgentBlockRequest, user: dict = Depends(require_token)) -> dict:
    """Block/unblock an existing agent. Only the configured admin can call this."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not agent_uid or agent_uid == SUPABASE_ADMIN_UID:
        raise HTTPException(status_code=400, detail="Invalid agent UID")
    with closing(connect_db()) as connection:
        existing = connection.execute(
            "SELECT uid FROM agent_accounts WHERE uid = ?", (agent_uid,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Agent not found")
        connection.execute(
            "UPDATE agent_accounts SET is_blocked = ? WHERE uid = ?",
            (1 if payload.is_blocked else 0, agent_uid),
        )
        connection.commit()
    return {"success": True, "uid": agent_uid, "is_blocked": payload.is_blocked}


@app.get("/admin/backup.json")
def download_admin_backup(
    user: dict = Depends(require_token),
) -> Response:
    """Download a private JSON backup; only the configured Supabase admin may export data."""
    if not SUPABASE_ADMIN_UID:
        raise HTTPException(status_code=503, detail="SUPABASE_ADMIN_UID is not configured on the server")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    with closing(connect_db()) as connection:
        leads = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM leads ORDER BY created_at ASC"
            ).fetchall()
        ]
        followups = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM lead_followups ORDER BY created_at ASC"
            ).fetchall()
        ]

    backup = {
        "app": APP_NAME,
        "format_version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "counts": {"leads": len(leads), "followups": len(followups)},
        "leads": leads,
        "followups": followups,
    }
    filename = "nbsc-lap-backup-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".json"
    return Response(
        content=json.dumps(backup, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


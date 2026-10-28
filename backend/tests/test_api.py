import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Import the app after dependencies are installed, then isolate it from
    # production by forcing a temporary SQLite database and a test-only token.
    import main

    monkeypatch.setattr(main, "USE_POSTGRES", False)
    monkeypatch.setattr(main, "DB_PATH", str(tmp_path / "test-leads.db"))
    monkeypatch.setattr(main, "API_TOKEN", "test-only-token")
    monkeypatch.setattr(main, "ADMIN_UID", "test-admin-uid")
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_leads_requires_authentication(client):
    response = client.get("/leads")
    assert response.status_code == 401


def test_invalid_token_is_rejected(client):
    response = client.get("/leads", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_create_list_and_get_lead(client):
    payload = {
        "name": "Test Customer",
        "phone": "9876543210",
        "city": "Raipur",
        "product": "LAP",
        "source": "test",
        "budget": 1500000,
        "monthly_income": 42000,
        "customer_type": "salary",
        "consent_status": "pending",
        "notes": "Automated test record only",
    }
    headers = {"Authorization": "Bearer test-only-token"}
    created = client.post("/lead", json=payload, headers=headers)
    assert created.status_code == 200, created.text
    lead = created.json()["lead"]
    assert lead["phone"] == "+919876543210"

    listed = client.get("/leads", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["leads"][0]["id"] == lead["id"]

    fetched = client.get(f"/lead/{lead['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["lead"]["name"] == "Test Customer"


def test_followup_create_and_list(client):
    headers = {"Authorization": "Bearer test-only-token"}
    lead = client.post(
        "/lead",
        json={"name": "Followup Test", "phone": "9123456789"},
        headers=headers,
    )
    assert lead.status_code == 200, lead.text
    lead_id = lead.json()["lead"]["id"]

    created = client.post(
        f"/lead/{lead_id}/followups",
        json={"channel": "call", "outcome": "connected", "notes": "test note"},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    assert created.json()["followup"]["lead_id"] == lead_id

    listed = client.get(f"/lead/{lead_id}/followups", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["count"] == 1


def test_invalid_customer_type_is_rejected(client):
    response = client.post(
        "/lead",
        json={"name": "Invalid Type", "phone": "9876543210", "customer_type": "unknown"},
        headers={"Authorization": "Bearer test-only-token"},
    )
    assert response.status_code == 422

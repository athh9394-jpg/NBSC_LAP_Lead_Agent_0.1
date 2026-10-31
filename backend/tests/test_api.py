import io
import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Isolate the database and mock Supabase Auth; tests never contact production.
    import main

    monkeypatch.setattr(main, "USE_POSTGRES", False)
    monkeypatch.setattr(main, "DB_PATH", str(tmp_path / "test-leads.db"))
    monkeypatch.setattr(main, "SUPABASE_URL", "https://supabase.test")
    monkeypatch.setattr(main, "SUPABASE_ANON_KEY", "test-publishable-key")
    monkeypatch.setattr(main, "SUPABASE_ADMIN_UID", "test-admin-uid")

    def fake_urlopen(request, timeout=8):
        token = (request.get_header("Authorization") or "").removeprefix("Bearer ").strip()
        users = {
            "test-only-token": {"id": "test-agent-uid", "email": "agent@example.test"},
            "other-agent-token": {"id": "other-agent-uid", "email": "other@example.test"},
            "admin-test-token": {"id": "test-admin-uid", "email": "admin@example.test"},
        }
        if token not in users:
            raise urllib.error.HTTPError(request.full_url, 401, "invalid token", {}, None)
        return io.BytesIO(json.dumps(users[token]).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_leads_requires_authentication(client):
    assert client.get("/leads").status_code == 401


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


def test_agent_cannot_read_another_agents_lead(client):
    lead = client.post(
        "/lead",
        json={"name": "Private Lead", "phone": "9876543210"},
        headers={"Authorization": "Bearer test-only-token"},
    )
    assert lead.status_code == 200
    lead_id = lead.json()["lead"]["id"]

    other_headers = {"Authorization": "Bearer other-agent-token"}
    response = client.get(f"/lead/{lead_id}", headers=other_headers)
    assert response.status_code == 404

    # An unassigned agent must not mutate a lead it cannot read.
    followup = client.post(
        f"/lead/{lead_id}/followups",
        json={"channel": "call", "outcome": "attempted", "notes": "unauthorized"},
        headers=other_headers,
    )
    assert followup.status_code == 404
    status = client.patch(
        f"/lead/{lead_id}/status",
        json={"status": "converted"},
        headers=other_headers,
    )
    assert status.status_code == 404



def test_followup_is_blocked_when_customer_declines_contact(client):
    headers = {"Authorization": "Bearer test-only-token"}
    lead = client.post(
        "/lead",
        json={
            "name": "No Contact Customer",
            "phone": "9123456789",
            "consent_status": "no",
        },
        headers=headers,
    )
    assert lead.status_code == 200, lead.text
    lead_id = lead.json()["lead"]["id"]

    response = client.post(
        f"/lead/{lead_id}/followups",
        json={"channel": "call", "outcome": "attempted", "notes": "must be blocked"},
        headers=headers,
    )
    assert response.status_code == 403
    assert "declined follow-up" in response.json()["detail"]


def test_admin_can_list_and_block_agents(client):
    agent_headers = {"Authorization": "Bearer test-only-token"}
    admin_headers = {"Authorization": "Bearer admin-test-token"}

    # First authenticated agent request creates the managed agent record.
    assert client.get("/leads", headers=agent_headers).status_code == 200
    listed = client.get("/admin/agents", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    agents = listed.json()["agents"]
    assert any(agent["uid"] == "test-agent-uid" for agent in agents)

    blocked = client.patch(
        "/admin/agents/test-agent-uid/block",
        json={"is_blocked": True},
        headers=admin_headers,
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["is_blocked"] is True

    rejected = client.get("/leads", headers=agent_headers)
    assert rejected.status_code == 403

    unblocked = client.patch(
        "/admin/agents/test-agent-uid/block",
        json={"is_blocked": False},
        headers=admin_headers,
    )
    assert unblocked.status_code == 200, unblocked.text
    assert client.get("/leads", headers=agent_headers).status_code == 200


def test_non_admin_cannot_manage_agents(client):
    headers = {"Authorization": "Bearer test-only-token"}
    assert client.get("/admin/agents", headers=headers).status_code == 403
    response = client.patch(
        "/admin/agents/other-agent-uid/block",
        json={"is_blocked": True},
        headers=headers,
    )
    assert response.status_code == 403


def test_auth_service_outage_returns_503_without_marking_session_invalid(client, monkeypatch):
    def auth_unavailable(request, timeout=8):
        raise urllib.error.URLError("simulated network outage")

    monkeypatch.setattr("urllib.request.urlopen", auth_unavailable)
    response = client.get(
        "/leads",
        headers={"Authorization": "Bearer test-only-token"},
    )
    assert response.status_code == 503
    assert "temporarily unavailable" in response.json()["detail"]


def test_assigned_agent_can_open_lead_details_and_followups(client):
    owner_headers = {"Authorization": "Bearer test-only-token"}
    other_headers = {"Authorization": "Bearer other-agent-token"}
    admin_headers = {"Authorization": "Bearer admin-test-token"}

    created = client.post(
        "/lead",
        json={"name": "Assigned Lead", "phone": "9876543210", "consent_status": "yes"},
        headers=owner_headers,
    )
    assert created.status_code == 200, created.text
    lead_id = created.json()["lead"]["id"]

    # Register the receiving agent, then assign the lead as admin.
    assert client.get("/leads", headers=other_headers).status_code == 200
    assigned = client.patch(
        f"/admin/leads/{lead_id}/assign",
        json={"agent_uid": "other-agent-uid"},
        headers=admin_headers,
    )
    assert assigned.status_code == 200, assigned.text

    detail = client.get(f"/lead/{lead_id}", headers=other_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["lead"]["name"] == "Assigned Lead"

    history = client.get(f"/lead/{lead_id}/followups", headers=other_headers)
    assert history.status_code == 200, history.text

    # Assignment grants the receiving agent the same scoped follow-up/status access.
    followup = client.post(
        f"/lead/{lead_id}/followups",
        json={"channel": "call", "outcome": "connected", "notes": "assigned agent test"},
        headers=other_headers,
    )
    assert followup.status_code == 200, followup.text
    changed = client.patch(
        f"/lead/{lead_id}/status",
        json={"status": "follow_up"},
        headers=other_headers,
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["lead"]["status"] == "follow_up"


def test_admin_backup_requires_admin_and_exports_valid_json(client):
    # Unauthenticated and ordinary agent sessions must never export customer data.
    assert client.get("/admin/backup.json").status_code == 401
    agent_headers = {"Authorization": "Bearer test-only-token"}
    assert client.get("/admin/backup.json", headers=agent_headers).status_code == 403

    admin_headers = {"Authorization": "Bearer admin-test-token"}
    created = client.post(
        "/lead",
        json={
            "name": "Backup Test Customer",
            "phone": "9876543210",
            "consent_status": "yes",
            "notes": "isolated test record",
        },
        headers=agent_headers,
    )
    assert created.status_code == 200, created.text
    lead_id = created.json()["lead"]["id"]

    followup = client.post(
        f"/lead/{lead_id}/followups",
        json={"channel": "call", "outcome": "connected", "notes": "backup test"},
        headers=agent_headers,
    )
    assert followup.status_code == 200, followup.text

    response = client.get("/admin/backup.json", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    assert "attachment;" in response.headers["content-disposition"]

    backup = response.json()
    assert backup["app"] == "NBSC LAP Lead Agent"
    assert backup["format_version"] == 1
    assert backup["counts"] == {"leads": 1, "followups": 1}
    assert backup["leads"][0]["id"] == lead_id
    assert backup["followups"][0]["lead_id"] == lead_id



def test_non_admin_cannot_access_admin_activity_assignment_or_assignable_leads(client):
    agent_headers = {"Authorization": "Bearer test-only-token"}

    activity = client.get(
        "/admin/agents/other-agent-uid/activity",
        headers=agent_headers,
    )
    assert activity.status_code == 403

    assignable = client.get(
        "/admin/leads/assignable",
        headers=agent_headers,
    )
    assert assignable.status_code == 403

    assignment = client.patch(
        "/admin/leads/nonexistent-lead-id/assign",
        json={"agent_uid": "other-agent-uid"},
        headers=agent_headers,
    )
    assert assignment.status_code == 403

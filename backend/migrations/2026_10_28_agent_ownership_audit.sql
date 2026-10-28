-- NBSC LAP multi-agent ownership and audit migration.
-- REVIEW BEFORE APPLYING to the Render PostgreSQL database.
-- Existing leads deliberately remain owner_uid NULL; do not auto-assign them.
-- SQLite local development needs a separate migration path.

BEGIN;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS owner_uid TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_owner_created
    ON leads (owner_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_activity (
    id TEXT PRIMARY KEY,
    lead_id TEXT NULL REFERENCES leads(id) ON DELETE SET NULL,
    actor_uid TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_actor_created
    ON lead_activity (actor_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_created
    ON lead_activity (lead_id, created_at DESC);

COMMIT;

-- Important rollout requirements:
-- 1. Deploy backend authorization checks before enabling agent access.
-- 2. Resolve ownership of existing leads manually; NULL means admin-only.
-- 3. Agent profile role/block status must be read from trusted server-side
--    configuration/database, never accepted from client payloads.
-- 4. Do not expose this migration or database credentials to the frontend.

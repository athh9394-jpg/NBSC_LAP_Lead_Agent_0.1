# Secure agent ownership rollout

This branch stages the schema prerequisite for agent-level lead isolation.

## Safety rules
- Do not apply the migration until backend authorization changes are reviewed and ready to deploy together.
- Existing rows get `owner_uid = NULL`. They must remain admin-only until an administrator confirms the correct owner.
- Never trust a role, agent ID, or ownership field supplied by the browser.
- Every lead read/write, status change, and follow-up operation must enforce ownership on the backend.
- Admin backup must use the same verified identity system as the rest of the app; do not mix Firebase identity with Supabase sessions.
- Passwords and OTPs must never be logged or included in backups.

## Required implementation before rollout
1. Verify the Supabase access token server-side.
2. Load the matching agent profile server-side and reject blocked accounts.
3. Restrict agent lead queries to `owner_uid = token subject`; admin may access all rows.
4. Prevent agents from reading or changing unassigned leads.
5. Record actor UID for follow-ups and status/ownership changes.
6. Replace the Firebase-only backup endpoint with Supabase-token plus server-side admin-role authorization.
7. Add tests for unauthenticated, blocked agent, agent A vs agent B, admin, and unassigned legacy lead cases.
8. Deploy to a test environment and verify the existing two leads remain intact before production rollout.

## Database target
The SQL file in this folder is for the backend's PostgreSQL database (Render `DATABASE_URL`), not the Supabase Auth database. It is staged for review only and has not been applied.

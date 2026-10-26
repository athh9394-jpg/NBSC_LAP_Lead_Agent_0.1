# NBSC LAP Lead Agent — Android-friendly starter project

## Is project mein kya hai?
- React + Vite dashboard
- FastAPI backend + SQLite database
- Lead create/list/detail APIs
- Demo login token protection for dashboard APIs
- WhatsApp webhook starter (Twilio signature validation TODO before production)
- `.env.example` only — real secrets yahan kabhi paste na karein

## Important
Yeh starter project hai, production-ready lending system nahi. Live customer data se pehle authentication, HTTPS, backup, rate limits, proper access control, privacy review aur Twilio webhook signature validation configure karein. Hot/Warm/Cold sirf sales follow-up priority hai, loan approval nahi.

## Android mobile se shuru karne ka sabse aasan tareeqa
Aapko project files upload karke browser-based coding environment mein run karna hoga. Agar sirf Android phone hai, pehle GitHub repository banayein aur files upload karein. Backend ko Python hosting par aur frontend ko static hosting par deploy karna hota hai. Free hosting limits badal sakti hain.

### Local backend (computer/online IDE terminal)
1. `cd backend`
2. `python -m venv .venv` (agar supported ho)
3. Activate environment, then `pip install -r requirements.txt`
4. Copy `.env.example` to `.env`, set a long random `APP_API_TOKEN`.
5. Run: `uvicorn main:app --host 0.0.0.0 --port 8000`
6. Test health at `/health` and API docs at `/docs`.

### Frontend
1. Open `frontend/.env.example`, copy to `frontend/.env`.
2. Set `VITE_API_BASE_URL` to your deployed backend URL (for local testing `http://127.0.0.1:8000`).
3. Set `VITE_API_TOKEN` to the same `APP_API_TOKEN` (demo starter only; do not use a shared static token for a public production deployment).
4. `cd frontend && npm install && npm run dev -- --host 0.0.0.0`

### WhatsApp
- Set Twilio credentials only in backend environment variables, never in frontend.
- Configure the Twilio WhatsApp webhook URL to `https://YOUR_BACKEND_DOMAIN/webhook/whatsapp`.
- This starter validates Twilio signature when `TWILIO_AUTH_TOKEN` is configured. Test with Twilio's official sandbox first.
- Do not ask customers to send Aadhaar/PAN or other identity documents in WhatsApp chat. Use a secure official channel instead.
- Automated messages must be sent only with appropriate consent and follow applicable rules.

## Starter limitations
- The demo frontend token is for private testing only.
- WhatsApp intake is deliberately minimal and does not yet implement the full conversational flow.
- For public production use, replace the demo token setup with proper user login/roles and audit logs.

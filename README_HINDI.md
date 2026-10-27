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

## Admin-only backup (new)
- Backend now has `GET /admin/backup.json`, which exports leads and follow-up history together in one JSON file.
- This endpoint requires a valid Firebase ID token **and** the matching `ADMIN_UID` configured on Render. The regular shared frontend API token cannot access this backup endpoint.
- Keep `ADMIN_UID` set to the actual admin user's Firebase Authentication UID. Keep Firebase Admin credentials configured on the backend; never put service-account JSON in frontend files or GitHub.
- The export contains customer personal data. Store the downloaded file privately and do not upload it to a public GitHub repository or share it in chat.
- This is a **manual export**, not an automatic backup. It does not by itself make Render's SQLite database persistent. Until persistent storage and a tested restore process are configured, do not treat the service as safe for critical customer records.

### Dashboard se backup download karna
1. Render ke frontend service `nbsc-lap-frontend-02` → Environment mein Firebase web app ke ye **public client config** values set karein: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Optional: `VITE_FIREBASE_MESSAGING_SENDER_ID`.
2. Firebase Console → Authentication → Sign-in method mein Email/Password enable hona chahiye. Apne authorized admin user se hi sign in karein.
3. Render backend environment mein `ADMIN_UID` usi Firebase admin user ka exact UID hona chahiye; backend Firebase Admin credentials bhi configured hone chahiye.
4. Frontend environment change ke baad redeploy hone dein. Dashboard ke Admin Data Backup panel se sign in karke Download backup JSON dabayein.
5. Agar `Admin access required` aaye, to UID match nahi hai; agar Firebase Admin not configured aaye, backend credentials configure karne honge. Web config values public client settings hain; Firebase service-account private key nahi.

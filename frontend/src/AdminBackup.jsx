import React, { useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ""
};
const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
const auth = configured
  ? getAuth(getApps().length ? getApps()[0] : initializeApp(firebaseConfig))
  : null;
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://nbsc-lap-backend-01.onrender.com").replace(/\/$/, "");

export default function AdminBackup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(auth?.currentUser || null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function login(e) {
    e.preventDefault();
    setBusy(true); setMessage("");
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      setUser(result.user); setPassword("");
      setMessage("Firebase login successful. Ab admin backup download kar sakte hain.");
    } catch (err) {
      setMessage(err?.message || "Login nahi ho paya. Firebase email/password sign-in check karein.");
    } finally { setBusy(false); }
  }

  async function downloadBackup() {
    if (!user) return;
    setBusy(true); setMessage("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch(`${API_BASE}/admin/backup.json`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = body || `HTTP ${response.status}`;
        try { detail = JSON.parse(body).detail || detail; } catch {}
        throw new Error(detail);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nbsc-lap-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      // Keep the blob URL alive briefly so Android WebView's native download bridge can read it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("Backup file download ho gayi. Is file ko private jagah par rakhein.");
    } catch (err) {
      setMessage(err?.message || "Backup download nahi hua. Admin UID / Firebase server config check karein.");
    } finally { setBusy(false); }
  }

  async function logout() {
    await signOut(auth);
    setUser(null); setMessage("Firebase se sign out ho gaye.");
  }

  return <section className="panel" style={{marginBottom:20}}>
    <div className="panel-head">
      <div><h2>Admin Data Backup</h2><p>Leads aur follow-up history ki private JSON copy</p></div>
      <span className="pill">Admin only</span>
    </div>
    {!configured ? <div className="state">
      Backup panel activate karne ke liye Render frontend environment mein Firebase web config set karein:
      <br /><b>VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID</b>
      <br />Optional: VITE_FIREBASE_MESSAGING_SENDER_ID. Firebase web config Firebase Console ke Project settings → Your apps mein milta hai.
    </div> : user ? <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
      <span>Signed in: <b>{user.email || "Firebase user"}</b></span>
      <button className="primary-button" type="button" disabled={busy} onClick={downloadBackup}>{busy ? "Please wait…" : "Download backup JSON"}</button>
      <button className="refresh" type="button" disabled={busy} onClick={logout}>Sign out</button>
    </div> : <form onSubmit={login} style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <label style={{flex:"1 1 180px"}}>Admin email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Firebase admin email" /></label>
      <label style={{flex:"1 1 180px"}}>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Firebase password" /></label>
      <button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Admin sign in"}</button>
    </form>}
    {message && <p role="status" style={{marginTop:12,overflowWrap:"anywhere"}}>{message}</p>}
    <p style={{fontSize:12,marginTop:10,color:"var(--muted,#667085)"}}>Backup mein customer ke personal details honge. Public GitHub ya shared chat mein upload na karein. Manual JSON backup yahan se le sakte hain; automatic encrypted database backup rozana GitHub Actions se banta hai aur 30 din tak rakha jata hai.</p>
  </section>;
}

import React, { useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://nbsc-lap-backend-01.onrender.com").replace(/\/$/, "");

export default function AdminBackup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function downloadBackup() {
    setBusy(true);
    setMessage("");
    try {
      const token = localStorage.getItem("nbsc_access_token");
      if (!token) throw new Error("Pehle app mein admin account se login karein.");
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
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("Backup download shuru ho gaya. File ko private jagah par rakhein.");
    } catch (err) {
      setMessage(err?.message || "Backup download nahi hua.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" style={{marginBottom:20}}>
    <div className="panel-head">
      <div><h2>Admin Data Backup</h2><p>Leads aur follow-up history ki private JSON copy</p></div>
      <span className="pill">Admin only</span>
    </div>
    <p>App mein logged-in admin session istemal hoga. Server admin permission verify karega.</p>
    <button className="primary-button" type="button" disabled={busy} onClick={downloadBackup}>
      {busy ? "Please wait…" : "Download backup JSON"}
    </button>
    {message && <p role="status" style={{marginTop:12,overflowWrap:"anywhere"}}>{message}</p>}
    <p style={{fontSize:12,marginTop:10,color:"var(--muted,#667085)"}}>Backup mein customer ke personal details honge. Public GitHub ya shared chat mein upload na karein.</p>
  </section>;
}

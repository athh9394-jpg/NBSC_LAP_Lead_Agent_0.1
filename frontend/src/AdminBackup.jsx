import React, { useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://nbsc-lap-backend-01.onrender.com").replace(/\/+$/, "");

function saveBlobInAndroid(blob, fileName) {
  return new Promise((resolve, reject) => {
    try {
      const bridge = window.LAPDownload;
      if (!bridge || typeof bridge.saveBase64 !== "function") {
        resolve(false);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Backup file ko read nahi kar paaye."));
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        if (comma < 0) {
          reject(new Error("Backup file ka data invalid hai."));
          return;
        }
        try {
          const saveResult = bridge.saveBase64(fileName, blob.type || "application/json", result.slice(comma + 1));
          if (typeof saveResult === "string" && saveResult.startsWith("OK:")) {
            resolve(saveResult.slice(3));
          } else if (typeof saveResult === "string" && saveResult.startsWith("ERROR:")) {
            reject(new Error(saveResult.slice(6)));
          } else {
            reject(new Error("Android save confirmation nahi mila. Nayi APK install karke dobara try karein."));
          }
        } catch (error) {
          reject(new Error(error?.message || "Android Downloads mein save nahi ho paya."));
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}

export default function AdminBackup() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function downloadBackup() {
    if (busy) return;
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
      if (!blob.size) throw new Error("Backup file khaali hai; server response check karein.");
      const fileName = `nbsc-lap-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

      const nativeSaved = await saveBlobInAndroid(blob, fileName);
      if (nativeSaved) {
        setMessage(`Backup Downloads mein save ho gaya: ${nativeSaved}`);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        setMessage("Browser download request bhej di gayi hai. Downloads folder check karein.");
      }
    } catch (err) {
      setMessage(err?.message || "Backup download nahi hua. Dobara try karein.");
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
    {message && <p role="status" aria-live="polite" style={{marginTop:12,overflowWrap:"anywhere"}}>{message}</p>}
    <p style={{fontSize:12,marginTop:10,color:"var(--muted,#667085)"}}>Backup mein customer ke personal details honge. Public GitHub ya shared chat mein upload na karein.</p>
  </section>;
}

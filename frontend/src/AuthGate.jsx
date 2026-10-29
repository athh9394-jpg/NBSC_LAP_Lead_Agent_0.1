import React, { useState } from "react";
import App from "./App.jsx";
import AgentDashboard from "./AgentDashboard.jsx";
import "./auth.css";

const URL = (import.meta.env.VITE_SUPABASE_URL || "https://vmnpgieduiolzkrbuoei.supabase.co").replace(/\/$/, "");
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_ty9eO2VEiIqBMC_naMy57A_EDOHgrMS";

async function call(path, body, token) {
  const response = await fetch(URL + "/auth/v1/" + path, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || "Authentication failed");
  return data;
}

export default function AuthGate() {
  const [mode, setMode] = useState("login");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(() => localStorage.getItem("nbsc_access_token") || "");

  const isEmail = value => value.trim().includes("@");
  const normalizedIdentity = () => {
    const value = identity.trim();
    if (isEmail(value)) return value.toLowerCase();
    const digits = value.replace(/\D/g, "");
    if (digits.length === 10) return "+91" + digits;
    if (value.startsWith("+")) return "+" + digits;
    return "+" + digits;
  };
  function logout() {
    localStorage.removeItem("nbsc_access_token");
    localStorage.removeItem("nbsc_refresh_token");
    setSession("");
    setMode("login");
    setMessage("");
    setPassword("");
  }
  function isAdminToken(token) {
    try {
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(part));
      return payload.sub === "920128ab-041c-4955-8e4a-b3574da4e733";
    } catch { return false; }
  }
  function saveSession(data) {
    if (!data.access_token) throw new Error("Verification ho gayi, lekin login session nahi mila. Ab Login karein.");
    localStorage.setItem("nbsc_access_token", data.access_token);
    localStorage.setItem("nbsc_refresh_token", data.refresh_token || "");
    setSession(data.access_token);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (!URL || !KEY) throw new Error("Supabase configuration missing hai.");
      const value = normalizedIdentity();
      const email = isEmail(identity);
      let data;

      if (mode === "login") {
        data = await call("token?grant_type=password", email ? { email: value, password } : { phone: value, password });
        saveSession(data);
        return;
      }

      if (mode === "register") {
        if (!email) throw new Error("Free registration ke liye email address aur password use karein. SMS OTP abhi configured nahi hai.");
        data = await call("signup", { email: value, password });
        if (data.access_token) {
          saveSession(data);
          return;
        }
        setMode("verify-register");
        setMessage("Registration request bheji gayi. Supabase email confirmation settings ke hisaab se inbox/spam mein confirmation email ya code check karein.");
        return;
      }

      if (mode === "forgot") {
        if (!email) throw new Error("Free password recovery ke liye registered email address use karein. SMS recovery abhi available nahi hai.");
        await call("otp", { email: value, create_user: false });
        setMode("verify-reset");
        setMessage("Agar email registered hai, to recovery code bheja gaya hai. Inbox aur spam folder check karein.");
        return;
      }

      const emailFlow = isEmail(identity);
      const verifyType = mode === "verify-register" ? (emailFlow ? "signup" : "sms") : "recovery";
      data = await call("verify", emailFlow
        ? { email: normalizedIdentity(), token: otp.trim(), type: verifyType }
        : { phone: normalizedIdentity(), token: otp.trim(), type: verifyType });

      if (mode === "verify-register") {
        saveSession(data);
        return;
      }
      if (!data.access_token) throw new Error("Recovery code verify hua, lekin reset session nahi mila. Naya recovery code mangayein.");
      const response = await fetch(URL + "/auth/v1/user", {
        method: "PUT",
        headers: { apikey: KEY, "Content-Type": "application/json", Authorization: "Bearer " + data.access_token },
        body: JSON.stringify({ password: newPassword })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.msg || result.message || "Password reset fail hua.");
      setMode("login");
      setOtp("");
      setNewPassword("");
      setMessage("Password update ho gaya. Ab naye password se Login karein.");
    } catch (error) {
      setMessage(error.message || "Request fail hui. Supabase Auth settings check karein.");
    } finally {
      setBusy(false);
    }
  }

  if (session) return isAdminToken(session) ? <App onLogout={logout} /> : <AgentDashboard onLogout={logout} />;
  const verify = mode.startsWith("verify-");
  const emailFlow = isEmail(identity);
  const identifierLabel = mode === "login" ? "Email ya agent mobile number" : "Agent email address";
  const identifierPlaceholder = mode === "login" ? "name@example.com ya 10 digit mobile" : "agent@example.com";

  return <main className="auth-shell">
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-mark">N</div>
      <h1>NBSC LAP</h1>
      <p className="auth-sub">Lead Agent · Secure login</p>
      {!verify && <label>{identifierLabel}
        <input value={identity} onChange={event => setIdentity(event.target.value)} type="text"
          inputMode="text" autoComplete="username"
          placeholder={identifierPlaceholder} autoCapitalize="none" spellCheck={false} required />
      </label>}
      {(mode === "login" || mode === "register") && <label>{mode === "login" ? "Password" : "Create password"}
        <input type="password" value={password} onChange={event => setPassword(event.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"} minLength="8" required />
      </label>}
      {verify && <label>{emailFlow ? "Email confirmation / recovery code" : "SMS OTP"}
        <input value={otp} onChange={event => setOtp(event.target.value)} inputMode="numeric"
          autoComplete="one-time-code" minLength="6" maxLength="8" required />
      </label>}
      {mode === "verify-reset" && <label>New password
        <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)}
          autoComplete="new-password" minLength="8" required />
      </label>}
      <button className="auth-submit" disabled={busy}>
        {busy ? "Please wait…" : verify ? "Verify code" : mode === "login" ? "Login" : mode === "register" ? "Create account & send code" : "Send password reset code"}
      </button>
      <div className="auth-links">
        {!verify && <>
          {mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMessage(""); }}>Login</button>}
          {mode !== "register" && <button type="button" onClick={() => { setMode("register"); setMessage(""); }}>Register</button>}
          {mode !== "forgot" && <button type="button" onClick={() => { setMode("forgot"); setMessage(""); }}>Forgot password?</button>}
        </>}
        {verify && <button type="button" onClick={() => { setMode("login"); setOtp(""); setMessage(""); }}>Back to Login</button>}
      </div>
      {message && <p className="auth-message" role="status">{message}</p>}
      <small className="auth-note">Admin apne existing email aur password se login karein. Free agent registration email + password se hai. Mobile number ko agent profile mein baad mein add kiya ja sakta hai; mobile SMS OTP ke liye SMS provider setup zaroori hota hai.</small>
    </form>
  </main>;
}

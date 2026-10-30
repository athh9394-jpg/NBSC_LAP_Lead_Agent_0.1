import React,{useState} from "react";
import App from "./App.jsx";
import "./auth.css";

const URL=(import.meta.env.VITE_SUPABASE_URL||"https://vmnpgieduiolzkrbuoei.supabase.co").replace(/\/$/,"");
const KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||"sb_publishable_ty9eO2VEiIqBMC_naMy57A_EDOHgrMS";

async function call(path,body,token){
  const r=await fetch(URL+"/auth/v1/"+path,{
    method:"POST",
    headers:{apikey:KEY,"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
    body:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    const message=d.msg||d.message||d.error_description||d.error||"Authentication request failed.";
    throw new Error(message);
  }
  return d;
}
function saveSession(d){
  if(!d?.access_token) throw new Error("Verification complete hua, lekin session nahi mila. Ab email aur password se login karein.");
  localStorage.setItem("nbsc_access_token",d.access_token);
  localStorage.setItem("nbsc_refresh_token",d.refresh_token||"");
}
export default function AuthGate(){
  const[mode,M]=useState("login");
  const[identity,I]=useState("");
  const[password,W]=useState("");
  const[otp,O]=useState("");
  const[np,N]=useState("");
  const[msg,S]=useState("");
  const[busy,B]=useState(false);
  const[session,T]=useState(()=>localStorage.getItem("nbsc_access_token")||"");
  if(session)return <App/>;

  const email=identity.trim().toLowerCase();
  async function submit(e){
    e.preventDefault(); B(true); S("");
    try{
      if(!URL||!KEY) throw new Error("Render frontend environment mein VITE_SUPABASE_URL aur VITE_SUPABASE_ANON_KEY set karein.");
      let d;
      if(mode==="login"){
        const id=identity.trim();
        d=await call("token?grant_type=password",id.includes("@")?{email:id.toLowerCase(),password}:{phone:id,password});
        saveSession(d); T(d.access_token); return;
      }
      if(!email||!email.includes("@")||!email.includes(".")) throw new Error("Valid email address enter karein.");
      if(mode==="register"){
        if(password.length<8) throw new Error("Password kam se kam 8 characters ka hona chahiye.");
        d=await call("signup",{email,password});
        if(d.access_token){ saveSession(d); T(d.access_token); return; }
        if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) {
          throw new Error("Is email se account pehle se registered ho sakta hai. Login karein ya Forgot password se password reset karein.");
        }
        M("verify-register");
        S("Signup request process ho gayi. Email delivery ke liye Supabase SMTP aur Confirm Signup template configured hona chahiye. Inbox aur Spam/Junk check karein.");
        return;
      }
      if(mode==="forgot"){
        await call("recover",{email});
        M("verify-reset");
        S("Password recovery email request ho gayi. Inbox aur Spam/Junk check karein.");
        return;
      }
      if(mode==="verify-register"){
        d=await call("verify",{email,token:otp.trim(),type:"signup"});
        if(d.access_token){ saveSession(d); T(d.access_token); return; }
        M("login"); O(""); S("Email verify ho gaya. Ab email aur password se login karein."); return;
      }
      if(mode==="verify-reset"){
        d=await call("verify",{email,token:otp.trim(),type:"recovery"});
        if(!d.access_token) throw new Error("OTP verify hua lekin reset session nahi mila. Naya OTP mangayein.");
        const r=await fetch(URL+"/auth/v1/user",{
          method:"PUT",
          headers:{apikey:KEY,"Content-Type":"application/json",Authorization:"Bearer "+d.access_token},
          body:JSON.stringify({password:np})
        });
        const result=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(result.msg||result.message||"Password reset fail hua. Supabase Email Auth settings check karein.");
        M("login"); O(""); N(""); W(""); S("Password update ho gaya. Ab login karein."); return;
      }
    }catch(e){
      const raw=e?.message||"Request fail hua.";
      const helpful=raw.includes("fetch")?"Server se connection nahi ho pa raha. Internet, Render deployment aur Supabase URL check karein.":raw;
      S(helpful);
    }finally{B(false);}
  }

  async function resendCode(){
    B(true); S("");
    try{
      if(!email||!email.includes("@")||!email.includes(".")) throw new Error("Valid email address enter karein.");
      if(mode==="verify-register"){
        await call("resend",{type:"signup",email});
        S("Signup verification email dobara request ho gayi. Inbox aur Spam/Junk check karein; resend limit ho to thoda intezar karein.");
      }else if(mode==="verify-reset"){
        await call("recover",{email});
        S("Password reset email dobara request ho gayi. Inbox aur Spam/Junk check karein; resend limit ho to thoda intezar karein.");
      }
    }catch(e){
      const raw=e?.message||"OTP dobara mangane mein error hua.";
      const helpful=raw.includes("fetch")?"Server se connection nahi ho pa raha. Internet aur Supabase URL check karein.":raw;
      S(helpful);
    }finally{B(false);}
  }

  const verify=mode==="verify-register"||mode==="verify-reset";
  return <main className="auth-shell">
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-mark">N</div><h1>NBSC LAP</h1><p className="auth-sub">Lead Agent · Secure login</p>
      {!verify&&<label>{mode==="login"?"Admin email or agent mobile number":"Agent email address"}
        <input value={identity} onChange={e=>I(e.target.value)} type="text" inputMode={mode==="login"?"text":"email"} autoComplete={mode==="login"?"username":"email"} placeholder={mode==="login"?"Email or mobile number":"name@example.com"} required/>
      </label>}
      {(mode==="login"||mode==="register")&&<label>{mode==="login"?"Password":"Create password"}
        <input type="password" value={password} onChange={e=>W(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"} minLength={mode==="register"?8:undefined} required/>
      </label>}
      {verify&&<label>Email OTP
        <input value={otp} onChange={e=>O(e.target.value.replace(/\D/g,"").slice(0,6))} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength="6" maxLength="6" placeholder="6 digit email code" aria-label="6 digit email OTP" required/>
      </label>}
      {mode==="verify-reset"&&<label>New password
        <input type="password" value={np} onChange={e=>N(e.target.value)} autoComplete="new-password" minLength="8" required/>
      </label>}
      <button className="auth-submit" disabled={busy}>{busy?"Please wait…":verify?"Verify email OTP":mode==="login"?"Login":mode==="register"?"Register & send email OTP":"Send password reset OTP"}</button>
      <div className="auth-links">
        {!verify&&<>{mode!=="login"&&<button type="button" onClick={()=>{M("login");S("");O("");}}>Login</button>}{mode!=="register"&&<button type="button" onClick={()=>{M("register");S("");O("");}}>Register</button>}{mode!=="forgot"&&<button type="button" onClick={()=>{M("forgot");S("");O("");}}>Forgot password?</button>}</>}
        {verify&&<button type="button" disabled={busy} onClick={resendCode}>{busy?"Please wait…":mode==="verify-register"?"Resend signup OTP":"Resend password reset OTP"}</button>}
      </div>
      {msg&&<p className="auth-message" role="status" aria-live="polite">{msg}</p>}
      <small className="auth-note">Agent signup and password recovery use email OTP. Admin email/password login remains supported. Supabase Email Auth and an OTP-enabled email template/SMTP provider must be configured.</small>
    </form>
  </main>;
}

import React, { useEffect, useMemo, useState } from "react";
import { fetchLeads, fetchFollowups, addFollowup, updateLeadStatus } from "./services/api";

const money = value => value == null || value === "" ? "—" : new Intl.NumberFormat("en-IN", {style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(value)||0);

export default function AgentDashboard({ onLogout }) {
  const [leads,setLeads]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState(null);
  const [history,setHistory]=useState([]);
  const [note,setNote]=useState("");
  const [outcome,setOutcome]=useState("attempted");
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);

  async function load(){setLoading(true);setError("");try{setLeads(await fetchLeads())}catch(e){setError(e.message||"Leads load nahi hui")}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  const counts=useMemo(()=>({total:leads.length,new:leads.filter(x=>(x.lead_status||"new")==="new").length,follow:leads.filter(x=>(x.lead_status||"")==="follow_up").length,done:leads.filter(x=>["converted","not_interested","not_converted"].includes(x.lead_status)).length}),[leads]);
  const visible=leads.filter(x=>[x.name,x.phone,x.city,x.lead_status,x.product].some(v=>String(v||"").toLowerCase().includes(query.toLowerCase())));
  async function open(lead){setSelected(lead);setMessage("");setNote("");setOutcome("attempted");try{setHistory(await fetchFollowups(lead.id))}catch(e){setHistory([]);setMessage(e.message||"History load nahi hui")}}
  async function saveFollowup(e){e.preventDefault();if(!selected)return;setSaving(true);setMessage("");try{await addFollowup(selected.id,{channel:"call",outcome,notes:note});setHistory(await fetchFollowups(selected.id));await load();setSelected(current=>current?({...current,lead_status:outcome==="converted"?"converted":outcome==="not_interested"?"not_interested":"follow_up"}):current);setNote("");setMessage("Follow-up save ho gaya.")}catch(e){setMessage(e.message||"Save nahi hua")}finally{setSaving(false)}}
  async function statusChange(e){const status=e.target.value;try{const r=await updateLeadStatus(selected.id,status);const lead=r?.lead||r;setSelected(lead);setLeads(prev=>prev.map(x=>String(x.id)===String(lead.id)?{...x,...lead,lead_status:lead.lead_status||lead.status}:x));setMessage("Status update ho gaya.")}catch(err){setMessage(err.message||"Status update nahi hua")}}
  return <div className="agent-shell">
    <header className="agent-top"><div className="brand"><span className="brand-icon">N</span><div><b>NBSC LAP</b><small>Agent Workspace</small></div></div><button className="refresh" onClick={load} disabled={loading}>↻ Refresh</button></header>
    <main className="agent-main"><div className="agent-welcome"><div><div className="eyebrow">AGENT WORKSPACE</div><h1>My Leads Dashboard</h1><p>Apni leads, follow-ups aur status yahan manage karein.</p></div>{onLogout&&<button className="refresh" onClick={onLogout}>Logout</button>}</div>
      <section className="agent-stats"><div><small>Total My Leads</small><strong>{counts.total}</strong></div><div><small>New</small><strong>{counts.new}</strong></div><div><small>Follow-ups</small><strong>{counts.follow}</strong></div><div><small>Completed</small><strong>{counts.done}</strong></div></section>
      <section className="panel"><div className="panel-head"><div><h2>My Leads</h2><p>Sirf aapke account ki leads</p></div><span className="pill">{visible.length} records</span></div><div className="toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Naam, mobile ya city search karein"/></div>
      {loading?<div className="state">Leads load ho rahi hain…</div>:error?<div className="error"><b>Connection error</b><p>{error}</p><button className="refresh" onClick={load}>Try again</button></div>:visible.length===0?<div className="state">Abhi aapko koi lead assign nahi hui ya search match nahi mila.</div>:<div className="agent-lead-list">{visible.map(lead=><button className="agent-lead-card" key={lead.id} onClick={()=>open(lead)}><div className="agent-card-head"><b>{lead.name||"Customer"}</b><span className="status">{lead.lead_status||"new"}</span></div><p>{lead.phone||"Mobile nahi hai"} · {lead.city||"City nahi hai"}</p><div className="agent-card-foot"><span>{lead.customer_type==="salary"?"Salary":"Business"}</span><b>{money(lead.loan_amount??lead.budget)}</b></div></button>)}</div>}</section>
    </main>
    {selected&&<div className="modal-backdrop" onClick={()=>setSelected(null)}><section className="lead-modal" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">MY LEAD</span><h2>{selected.name}</h2><p>{selected.phone} · {selected.city||"City not provided"}</p></div><button className="modal-close" onClick={()=>setSelected(null)}>✕</button></div>
      <div className="agent-detail-grid"><div><small>Loan amount</small><b>{money(selected.loan_amount??selected.budget)}</b></div><div><small>Monthly income</small><b>{money(selected.monthly_income)}</b></div><div><small>Product</small><b>{selected.product||"LAP"}</b></div><div><small>Priority score</small><b>{selected.qualification_score??selected.score??0}/100</b></div></div>
      <label className="agent-status-label">Lead Status<select value={selected.lead_status||selected.status||"new"} onChange={statusChange}><option value="new">New</option><option value="follow_up">Follow-up</option><option value="converted">Converted</option><option value="not_interested">Not interested</option><option value="not_converted">Not converted</option></select></label>
      <h3>Follow-up history</h3>{history.length?<div className="agent-history">{history.map(item=><div key={item.id}><b>{item.outcome}</b><small>{item.channel} · {item.created_at?new Date(item.created_at).toLocaleString():""}</small>{item.notes&&<p>{item.notes}</p>}</div>)}</div>:<p className="state">Abhi follow-up history nahi hai.</p>}
      <form onSubmit={saveFollowup} className="agent-follow-form"><label>Call result<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="attempted">Attempted</option><option value="connected">Connected</option><option value="no_answer">No answer</option><option value="callback">Call back</option><option value="interested">Interested</option><option value="not_interested">Not interested</option><option value="converted">Converted</option></select></label><label>Notes<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength="2000" placeholder="Follow-up notes (optional)" rows="2"/></label><button className="primary-button" disabled={saving}>{saving?"Saving…":"Save Follow-up"}</button>{message&&<p role="status">{message}</p>}</form>
    </section></div>}
  </div>
}

import React, { useEffect, useMemo, useState } from "react";
import { createLead, fetchLeads, fetchFollowups, addFollowup, updateLeadStatus, removeLead, logoutSession, fetchCurrentUser } from "./services/api";
import AdminBackup from "./AdminBackup.jsx";
import AdminAgents from "./AdminAgents.jsx";

const emptyForm = {
  name: "", phone: "", city: "", customer_type: "business",
  budget: "", monthly_income: "", product: "LAP",
  source: "website", consent_status: "pending", notes: ""
};

export default function App() {
  const [leads, setLeads] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [removingLeadId, setRemovingLeadId] = useState(null);
  const [confirmingLead, setConfirmingLead] = useState(null);
  const [removeNotice, setRemoveNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [followups, setFollowups] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [followupForm, setFollowupForm] = useState({channel:"call", outcome:"attempted", notes:""});
  const [followupSaving, setFollowupSaving] = useState(false);
  const [detailMessage, setDetailMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try { setLeads(await fetchLeads()); }
    catch (e) { setError(e.message || "Leads load nahi ho paye."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    fetchCurrentUser().then(user => { if (active) setCurrentUser(user); }).catch(e => { if (active) setError(e.message || "User role load nahi hua."); }).finally(() => { if (active) setRoleLoading(false); });
    load();
    return () => { active = false; };
  }, []);

  function logout() {
    void logoutSession();
  }

  async function openLead(lead) {
    setSelectedLead(lead); setFollowups([]); setDetailMessage("");
    setFollowupForm({channel:"call", outcome:"attempted", notes:""}); setDetailLoading(true);
    try { setFollowups(await fetchFollowups(lead.id)); }
    catch (e) { setDetailMessage("Follow-up history load nahi hui: " + (e.message || "API error")); }
    finally { setDetailLoading(false); }
  }

  async function saveFollowup(event) {
    event.preventDefault(); if (!selectedLead) return;
    setFollowupSaving(true); setDetailMessage("");
    try {
      await addFollowup(selectedLead.id, followupForm);
      setFollowupForm({channel:"call", outcome:"attempted", notes:""});
      setFollowups(await fetchFollowups(selectedLead.id));
      const updated = await fetchLeads(); setLeads(updated);
      setSelectedLead(updated.find(x => String(x.id) === String(selectedLead.id)) || selectedLead);
      setDetailMessage("Follow-up history save ho gayi.");
    } catch(e) { setDetailMessage(e.message || "Follow-up save nahi hua."); }
    finally { setFollowupSaving(false); }
  }

  async function changeStatus(status) {
    if (!selectedLead) return;
    setDetailMessage("");
    try {
      const updated = await updateLeadStatus(selectedLead.id, status);
      setSelectedLead(updated); setLeads(current => current.map(x => String(x.id) === String(updated.id) ? updated : x));
      setDetailMessage("Lead status update ho gaya.");
    } catch(e) { setDetailMessage(e.message || "Status update nahi hua."); }
  }

  async function removeLeadFromPipeline(lead) {
    const name = lead.name || "this lead";
    setConfirmingLead(null);
    setRemovingLeadId(lead.id);
    try {
      await removeLead(lead.id);
      setLeads(current => current.filter(item => String(item.id) !== String(lead.id)));
      if (selectedLead && String(selectedLead.id) === String(lead.id)) setSelectedLead(null);
      setRemoveNotice(`"${name}" successfully removed from active pipeline. Follow-up history safe hai.`);
    } catch (e) { setRemoveNotice("Remove nahi hua: " + (e.message || "Dobara try karein.")); }
    finally { setRemovingLeadId(null); }
  }

  function changeForm(event) {
    const { name, value } = event.target;
    setForm(current => ({ ...current, [name]: value }));
  }

  async function submitLead(event) {
    event.preventDefault();
    setSaving(true);
    setFormMessage("");
    try {
      await createLead({
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        budget: Number(form.budget || 0),
        monthly_income: Number(form.monthly_income || 0),
        customer_type: form.customer_type,
        product: form.product.trim(),
        source: form.source.trim() || "website",
        notes: form.notes.trim()
      });
      setForm(emptyForm);
      setFormMessage("Lead successfully save ho gaya. Agar phone pehle se tha, record update hua hai.");
      await load();
    } catch (e) {
      setFormMessage(e.message || "Lead save nahi hua. Connection aur API token check karein.");
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(() => ({
    total: leads.length,
    hot: leads.filter(x => x.qualification_label === "hot").length,
    warm: leads.filter(x => x.qualification_label === "warm").length,
    cold: leads.filter(x => x.qualification_label === "cold").length,
    fresh: leads.filter(x => (x.lead_status || "new") === "new").length,
    conversation: leads.filter(x => (x.lead_status || "new") === "follow_up").length,
    converted: leads.filter(x => (x.lead_status || "new") === "converted").length,
    rejected: leads.filter(x => ["not_converted", "not_interested"].includes(x.lead_status)).length
  }), [leads]);

  const filteredLeads = leads.filter(lead => {
    const matchesPriority = filter === "all" || lead.qualification_label === filter;
    const matchesType = typeFilter === "all" || (lead.customer_type || "business") === typeFilter;
    const status = String(lead.lead_status || "new").toLowerCase();
    const stage = status === "new" ? "fresh" : status === "follow_up" ? "conversation" : status === "converted" ? "converted" : "rejected";
    const matchesStage = stageFilter === "all" || stage === stageFilter;
    const term = query.toLowerCase();
    const matchesQuery = [
      lead.name, lead.phone, lead.city, lead.source, lead.lead_status,
      lead.customer_type, lead.product
    ].some(v => String(v || "").toLowerCase().includes(term));
    return matchesPriority && matchesType && matchesStage && matchesQuery;
  });
  const visible = [...filteredLeads].sort((a,b) => {
    if (sortBy === "priority") return Number(b.qualification_score || 0) - Number(a.qualification_score || 0);
    if (sortBy === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
  });

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">N</span><div><b>NBSC LAP</b><small>Lead Agent</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <a className="nav-item active" href="#sales-dashboard">▦ &nbsp; Sales Dashboard</a>
      <a className="nav-item" href="#add-new-lead">＋ &nbsp; Add New Lead</a>
      <a className="nav-item" href="#lead-pipeline">◉ &nbsp; Lead Pipeline</a>
      <a className="nav-item" href="#lead-assignment">↗ &nbsp; Lead Assignment</a>
      <div className="sidebar-note">Sales priority dashboard<br/><small>Private testing starter</small></div>
    </aside>
    <main className="main">
      <header id="sales-dashboard" className="topbar">
        <div><div className="eyebrow">WORKSPACE / OVERVIEW</div><h1>Sales Dashboard</h1><p>NBSC LAP lead pipeline ka snapshot</p>{currentUser && <p className="user-identity">Logged in: {currentUser.display_name || currentUser.email || currentUser.uid} · {currentUser.is_admin ? "Admin" : "Agent"}</p>}</div>
        <div className="topbar-actions"><button onClick={load} className="refresh" disabled={loading}>↻ Refresh</button><button onClick={logout} className="refresh" type="button">Logout</button></div>
      </header>

      <section className="stats">
        <Stat title="Total Leads" value={counts.total} color="blue" icon="▤" />
        <Stat title="Hot Leads" value={counts.hot} color="green" icon="🔥" />
        <Stat title="Warm Leads" value={counts.warm} color="orange" icon="◷" />
        <Stat title="Cold Leads" value={counts.cold} color="red" icon="❄" />
      </section>

      <section className="pipeline-overview" aria-label="Lead stage summary">
        <button className={"stage-summary fresh" + (stageFilter === "fresh" ? " selected" : "")} onClick={() => setStageFilter(stageFilter === "fresh" ? "all" : "fresh")}><span>Fresh</span><b>{counts.fresh}</b></button>
        <button className={"stage-summary conversation" + (stageFilter === "conversation" ? " selected" : "")} onClick={() => setStageFilter(stageFilter === "conversation" ? "all" : "conversation")}><span>Conversation</span><b>{counts.conversation}</b></button>
        <button className={"stage-summary converted" + (stageFilter === "converted" ? " selected" : "")} onClick={() => setStageFilter(stageFilter === "converted" ? "all" : "converted")}><span>Converted</span><b>{counts.converted}</b></button>
        <button className={"stage-summary rejected" + (stageFilter === "rejected" ? " selected" : "")} onClick={() => setStageFilter(stageFilter === "rejected" ? "all" : "rejected")}><span>Rejected</span><b>{counts.rejected}</b></button>
      </section>

      <section id="add-new-lead" className="panel add-panel">
        <div className="panel-head"><div><h2>+ Add New Lead</h2><p>Customer details bhar kar record save karein</p></div><span className="pill">Business / Salary</span></div>
        <form className="lead-form" onSubmit={submitLead}>
          <label>Customer Name *<input name="name" value={form.name} onChange={changeForm} minLength="2" maxLength="120" required placeholder="Customer ka naam"/></label>
          <label>Mobile Number *<input name="phone" type="tel" inputMode="tel" value={form.phone} onChange={changeForm} minLength="10" maxLength="30" required placeholder="10 digit mobile"/></label>
          <label>City<input name="city" value={form.city} onChange={changeForm} maxLength="120" placeholder="Raipur"/></label>
          <ChoiceGroup label="Customer Type *" value={form.customer_type} onChange={value => setForm(current => ({...current, customer_type:value}))} options={[{value:"business",label:"Business / Self-employed"},{value:"salary",label:"Salary / Salaried"}]} />
          <label>Loan Amount (₹)<input name="budget" type="number" min="0" step="1000" value={form.budget} onChange={changeForm} placeholder="e.g. 1500000"/></label>
          <label>Monthly Income (₹){form.customer_type === "salary" ? " *" : ""}<input name="monthly_income" type="number" min="0" step="1000" value={form.monthly_income} onChange={changeForm} required={form.customer_type === "salary"} placeholder="Monthly income"/></label>
          <ChoiceGroup label="Loan Product" value={form.product} onChange={value => setForm(current => ({...current, product:value}))} options={[{value:"LAP",label:"Loan Against Property (LAP)"},{value:"Home Loan",label:"Home Loan"},{value:"Business Loan",label:"Business Loan"},{value:"Personal Loan",label:"Personal Loan"},{value:"Other",label:"Other"}]} />
          <label>Lead Source<input name="source" value={form.source} onChange={changeForm} maxLength="120" placeholder="Website / Referral / Call"/></label>
          <ChoiceGroup label="Follow-up Consent" value={form.consent_status} onChange={value => setForm(current => ({...current, consent_status:value}))} options={[{value:"pending",label:"Pending"},{value:"yes",label:"Yes — consent received"},{value:"no",label:"No — do not contact"}]} />
          <label className="full-field">Notes<textarea name="notes" value={form.notes} onChange={changeForm} maxLength="2000" rows="2" placeholder="Optional notes (sensitive documents yahan na likhein)"/></label>
          <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save Lead"}</button>{formMessage && <span className={formMessage.startsWith("Lead successfully") ? "form-success" : "form-error"} role="status">{formMessage}</span>}</div>
        </form>
      </section>

      <section id="lead-pipeline" className="panel">
        <div className="panel-head"><div><h2>Lead Pipeline</h2><p>Latest updated leads</p></div><span className="pill">{leads.length} records</span></div>
        <div className="toolbar">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, phone, city, type..."/>
          <ChoiceGroup label="Customer filter" compact value={typeFilter} onChange={setTypeFilter} options={[{value:"all",label:"All types"},{value:"business",label:"Business"},{value:"salary",label:"Salary"}]} />
          <ChoiceGroup label="Pipeline stage" compact value={stageFilter} onChange={setStageFilter} options={[{value:"all",label:"All leads"},{value:"fresh",label:"Fresh"},{value:"conversation",label:"Conversation"},{value:"converted",label:"Converted"},{value:"rejected",label:"Rejected"}]} />
          <ChoiceGroup label="Priority filter" compact value={filter} onChange={setFilter} options={[{value:"all",label:"All priorities"},{value:"hot",label:"Hot"},{value:"warm",label:"Warm"},{value:"cold",label:"Cold"}]} />
          <ChoiceGroup label="Sort by" compact value={sortBy} onChange={setSortBy} options={[{value:"recent",label:"Recent"},{value:"priority",label:"Priority"},{value:"name",label:"Name"}]} />
        </div>
        {loading ? <div className="state">Leads load ho rahe hain…</div> : error ? <div className="error"><b>Connection error</b><p>{error}</p><p>Backend URL aur VITE_API_TOKEN / APP_API_TOKEN settings check karni hongi.</p><button onClick={load} className="refresh">Try again</button></div> : visible.length === 0 ? <div className="state">Abhi koi lead nahi hai, ya search/filter se match nahi mila.</div> :
        <div className="table-wrap"><table><thead><tr><th>LEAD</th><th>PHONE</th><th>CUSTOMER TYPE</th><th>CITY</th><th>LOAN AMOUNT</th><th>MONTHLY INCOME</th><th>PRIORITY</th><th>STATUS</th><th>SCORE</th><th>ACTION</th></tr></thead><tbody>
          {visible.map(lead=><tr key={lead.id} className={"clickable-row pipeline-" + (lead.lead_status || "new")} onClick={() => openLead(lead)} title="Tap karke complete lead details dekhein"><td><div className="person"><span className="avatar">{(lead.name || "L").slice(0,1).toUpperCase()}</span><div><b>{lead.name || "Unnamed lead"}</b><small>{lead.source || "Unknown source"}</small></div></div></td><td>{lead.phone || "—"}</td><td><span className={`type-pill ${lead.customer_type || "business"}`}>{lead.customer_type === "salary" ? "Salary" : "Business"}</span></td><td>{lead.city || "—"}</td><td>{money(lead.loan_amount)}</td><td>{money(lead.monthly_income)}</td><td><span className={`badge ${lead.qualification_label || "cold"}`}>{lead.qualification_label || "cold"}</span></td><td><span className="status">{lead.lead_status || "new"}</span></td><td><b>{lead.qualification_score ?? 0}</b><span className="outof"> / 100</span></td><td><button type="button" className="remove-lead-button" disabled={String(removingLeadId)===String(lead.id)} onClick={event=>{event.stopPropagation();setConfirmingLead(lead);}}>{String(removingLeadId)===String(lead.id)?"Removing…":"Remove"}</button></td></tr>)}
        </tbody></table></div>}
      </section>
      {!roleLoading && currentUser?.is_admin && <AdminAgents />}
      {!roleLoading && currentUser?.is_admin && <AdminBackup />}
      <footer>NBSC LAP Lead Agent · Lead score sirf sales follow-up priority ke liye hai, loan approval nahi.</footer>
      {selectedLead && <div className="modal-backdrop" onClick={() => setSelectedLead(null)}><section className="lead-modal" role="dialog" aria-modal="true" aria-label="Lead details" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><div><span className="eyebrow">LEAD DETAILS</span><h2>{selectedLead.name || "Unnamed lead"}</h2><p>{selectedLead.city || "City not provided"} · {selectedLead.customer_type === "salary" ? "Salary customer" : "Business customer"}</p></div><button className="modal-close" onClick={() => setSelectedLead(null)} aria-label="Close">✕</button></div>
        {!["no","false"].includes(String(selectedLead.consent_status || "").trim().toLowerCase()) ? <div className="contact-actions"><a className="contact-button call" href={`tel:${String(selectedLead.phone || "").replace(/[^+\d]/g,"")}`}>📞 Call customer</a><a className="contact-button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${String(selectedLead.phone || "").replace(/\D/g,"").replace(/^0/,"")}`}>🟢 WhatsApp</a></div> : <p className="contact-restriction" role="status">Customer ne follow-up se mana kiya hai. Contact buttons disabled hain.</p>}
        <div className="detail-grid"><Detail label="Phone" value={selectedLead.phone}/><Detail label="Product" value={selectedLead.product}/><Detail label="Loan amount" value={money(selectedLead.loan_amount)}/><Detail label="Monthly income" value={money(selectedLead.monthly_income)}/><Detail label="Lead source" value={selectedLead.source}/><Detail label="Consent" value={selectedLead.consent_status}/><Detail label="Priority score" value={`${selectedLead.qualification_score ?? 0}/100`}/><Detail label="Created" value={formatDate(selectedLead.created_at)}/></div>
        <div className="conversion-box"><div><b>Lead conversion status</b><p>Abhi: <strong>{statusLabel(selectedLead.lead_status)}</strong></p></div><ChoiceGroup label="Lead status" compact value={selectedLead.lead_status || "new"} onChange={changeStatus} options={[{value:"new",label:"New"},{value:"follow_up",label:"Follow-up"},{value:"converted",label:"Converted"},{value:"not_converted",label:"Not converted"},{value:"not_interested",label:"Not interested"}]} /></div>
        <h3>Follow-up history <span className="pill">{followups.length} times</span></h3>
        {!["no","false"].includes(String(selectedLead.consent_status || "").trim().toLowerCase()) ? <form className="followup-form" onSubmit={saveFollowup}><ChoiceGroup label="Contact method" compact value={followupForm.channel} onChange={value=>setFollowupForm({...followupForm,channel:value})} options={[{value:"call",label:"Phone call"},{value:"whatsapp",label:"WhatsApp"},{value:"in_person",label:"In person"},{value:"other",label:"Other"}]} /><ChoiceGroup label="Result" compact value={followupForm.outcome} onChange={value=>setFollowupForm({...followupForm,outcome:value})} options={[{value:"attempted",label:"Attempted"},{value:"connected",label:"Connected"},{value:"no_answer",label:"No answer"},{value:"callback",label:"Call back later"},{value:"interested",label:"Interested"},{value:"not_interested",label:"Not interested"},{value:"converted",label:"Loan converted"}]} /><label className="full-field">Notes<textarea rows="2" maxLength="2000" value={followupForm.notes} onChange={e=>setFollowupForm({...followupForm,notes:e.target.value})} placeholder="Is follow-up mein kya baat hui?"/></label><button className="primary-button" disabled={followupSaving}>{followupSaving ? "Saving..." : "Save follow-up"}</button></form> : <p className="contact-restriction">Is customer ke liye follow-up save nahi kiya ja sakta jab tak woh dobara permission na de.</p>}
        {detailMessage && <p className="detail-message" role="status">{detailMessage}</p>}
        <div className="history-list">{detailLoading ? <p>History load ho rahi hai…</p> : followups.length ? followups.map(f => <article className="history-item" key={f.id}><div><b>{channelLabel(f.channel)} · {outcomeLabel(f.outcome)}</b><small>{formatDate(f.created_at)}</small></div><p>{f.notes || "No notes added."}</p></article>) : <p>Abhi tak koi follow-up record nahi hai.</p>}</div>
        {selectedLead.notes && <div className="original-notes"><b>Lead notes</b><p>{selectedLead.notes}</p></div>}
      </section></div>}
      {removeNotice && <div className="remove-toast" role="status"><span>{removeNotice}</span><button type="button" onClick={()=>setRemoveNotice("")} aria-label="Dismiss">✕</button></div>}
      {confirmingLead && <div className="remove-dialog-backdrop" onClick={()=>setConfirmingLead(null)}><section className="remove-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-dialog-title" onClick={e=>e.stopPropagation()}><div className="remove-dialog-icon">!</div><h2 id="remove-dialog-title">Remove lead?</h2><p><strong>{confirmingLead.name || "This lead"}</strong> ko active pipeline se remove karna hai?</p><p className="remove-dialog-note">Is lead ki follow-up history safe rahegi. Lead active list se hide ho jayegi.</p><div className="remove-dialog-actions"><button type="button" className="remove-cancel" onClick={()=>setConfirmingLead(null)}>Cancel</button><button type="button" className="remove-confirm" disabled={String(removingLeadId)===String(confirmingLead.id)} onClick={()=>removeLeadFromPipeline(confirmingLead)}>{String(removingLeadId)===String(confirmingLead.id)?"Removing…":"Yes, remove"}</button></div></section></div>}
    </main>
  </div>;
}

function ChoiceGroup({label,value,onChange,options,compact=false}) { return <fieldset className={"choice-group"+(compact?" compact":"")}><legend>{label}</legend><div className="choice-options">{options.map(option => <button key={option.value} type="button" className={"choice-option"+(option.value===value?" active":"")} aria-pressed={option.value===value} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div></fieldset>; }
function Detail({label,value}) { return <div className="detail-item"><small>{label}</small><b>{value || "—"}</b></div>; }
function statusLabel(value) { return ({new:"New",follow_up:"Follow-up in progress",converted:"Converted / Loan done",not_converted:"Not converted",not_interested:"Not interested"})[value] || value || "New"; }
function channelLabel(value) { return ({call:"Phone call",whatsapp:"WhatsApp",in_person:"In person",other:"Other"})[value] || value; }
function outcomeLabel(value) { return ({attempted:"Attempted",connected:"Connected",no_answer:"No answer",callback:"Call back",interested:"Interested",not_interested:"Not interested",converted:"Converted"})[value] || value; }
function formatDate(value) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-IN", {dateStyle:"medium", timeStyle:"short"}); }

function Stat({title,value,color,icon}) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-foot">Current pipeline</div></div>;
}

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  return "₹" + Number(v).toLocaleString("en-IN", {maximumFractionDigits:0});
}

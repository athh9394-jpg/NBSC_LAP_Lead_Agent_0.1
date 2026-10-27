import React, { useEffect, useMemo, useState } from "react";
import { createLead, fetchLeads } from "./services/api";

const emptyForm = {
  name: "", phone: "", city: "", customer_type: "business",
  budget: "", monthly_income: "", product: "LAP",
  source: "website", consent_status: "pending", notes: ""
};

export default function App() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try { setLeads(await fetchLeads()); }
    catch (e) { setError(e.message || "Leads load nahi ho paye."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

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
    cold: leads.filter(x => x.qualification_label === "cold").length
  }), [leads]);

  const visible = leads.filter(lead => {
    const matchesPriority = filter === "all" || lead.qualification_label === filter;
    const matchesType = typeFilter === "all" || (lead.customer_type || "business") === typeFilter;
    const term = query.toLowerCase();
    const matchesQuery = [
      lead.name, lead.phone, lead.city, lead.source, lead.lead_status,
      lead.customer_type, lead.product
    ].some(v => String(v || "").toLowerCase().includes(term));
    return matchesPriority && matchesType && matchesQuery;
  });

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">N</span><div><b>NBSC LAP</b><small>Lead Agent</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <div className="nav-item active">▦ &nbsp; Dashboard</div>
      <div className="nav-item">◉ &nbsp; Leads</div>
      <div className="nav-item">↗ &nbsp; Follow-ups</div>
      <div className="sidebar-note">Sales priority dashboard<br/><small>Private testing starter</small></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div><div className="eyebrow">WORKSPACE / OVERVIEW</div><h1>Sales Dashboard</h1><p>NBSC LAP lead pipeline ka snapshot</p></div>
        <button onClick={load} className="refresh" disabled={loading}>↻ Refresh</button>
      </header>

      <section className="stats">
        <Stat title="Total Leads" value={counts.total} color="blue" icon="▤" />
        <Stat title="Hot Leads" value={counts.hot} color="green" icon="🔥" />
        <Stat title="Warm Leads" value={counts.warm} color="orange" icon="◷" />
        <Stat title="Cold Leads" value={counts.cold} color="red" icon="❄" />
      </section>

      <section className="panel add-panel">
        <div className="panel-head"><div><h2>+ Add New Lead</h2><p>Customer details bhar kar record save karein</p></div><span className="pill">Business / Salary</span></div>
        <form className="lead-form" onSubmit={submitLead}>
          <label>Customer Name *<input name="name" value={form.name} onChange={changeForm} minLength="2" maxLength="120" required placeholder="Customer ka naam"/></label>
          <label>Mobile Number *<input name="phone" type="tel" inputMode="tel" value={form.phone} onChange={changeForm} minLength="10" maxLength="30" required placeholder="10 digit mobile"/></label>
          <label>City<input name="city" value={form.city} onChange={changeForm} maxLength="120" placeholder="Raipur"/></label>
          <label>Customer Type *<select name="customer_type" value={form.customer_type} onChange={changeForm}><option value="business">Business / Self-employed</option><option value="salary">Salary / Salaried</option></select></label>
          <label>Loan Amount (₹)<input name="budget" type="number" min="0" step="1000" value={form.budget} onChange={changeForm} placeholder="e.g. 1500000"/></label>
          <label>Monthly Income (₹){form.customer_type === "salary" ? " *" : ""}<input name="monthly_income" type="number" min="0" step="1000" value={form.monthly_income} onChange={changeForm} required={form.customer_type === "salary"} placeholder="Monthly income"/></label>
          <label>Loan Product<select name="product" value={form.product} onChange={changeForm}><option value="LAP">Loan Against Property (LAP)</option><option value="Home Loan">Home Loan</option><option value="Business Loan">Business Loan</option><option value="Personal Loan">Personal Loan</option><option value="Other">Other</option></select></label>
          <label>Lead Source<input name="source" value={form.source} onChange={changeForm} maxLength="120" placeholder="Website / Referral / Call"/></label>
          <label>Follow-up Consent<select name="consent_status" value={form.consent_status} onChange={changeForm}><option value="pending">Pending</option><option value="yes">Yes — consent received</option><option value="no">No — do not contact</option></select></label>
          <label className="full-field">Notes<textarea name="notes" value={form.notes} onChange={changeForm} maxLength="2000" rows="2" placeholder="Optional notes (sensitive documents yahan na likhein)"/></label>
          <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save Lead"}</button>{formMessage && <span className={formMessage.startsWith("Lead successfully") ? "form-success" : "form-error"} role="status">{formMessage}</span>}</div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Lead Pipeline</h2><p>Latest updated leads</p></div><span className="pill">{leads.length} records</span></div>
        <div className="toolbar">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, phone, city, type..."/>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All customer types</option><option value="business">Business</option><option value="salary">Salary</option></select>
          <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All priorities</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        </div>
        {loading ? <div className="state">Leads load ho rahe hain…</div> : error ? <div className="error"><b>Connection error</b><p>{error}</p><p>Backend URL aur VITE_API_TOKEN / APP_API_TOKEN settings check karni hongi.</p><button onClick={load} className="refresh">Try again</button></div> : visible.length === 0 ? <div className="state">Abhi koi lead nahi hai, ya search/filter se match nahi mila.</div> :
        <div className="table-wrap"><table><thead><tr><th>LEAD</th><th>PHONE</th><th>CUSTOMER TYPE</th><th>CITY</th><th>LOAN AMOUNT</th><th>MONTHLY INCOME</th><th>PRIORITY</th><th>STATUS</th><th>SCORE</th></tr></thead><tbody>
          {visible.map(lead=><tr key={lead.id}><td><div className="person"><span className="avatar">{(lead.name || "L").slice(0,1).toUpperCase()}</span><div><b>{lead.name || "Unnamed lead"}</b><small>{lead.source || "Unknown source"}</small></div></div></td><td>{lead.phone || "—"}</td><td><span className={`type-pill ${lead.customer_type || "business"}`}>{lead.customer_type === "salary" ? "Salary" : "Business"}</span></td><td>{lead.city || "—"}</td><td>{money(lead.loan_amount)}</td><td>{money(lead.monthly_income)}</td><td><span className={`badge ${lead.qualification_label || "cold"}`}>{lead.qualification_label || "cold"}</span></td><td><span className="status">{lead.lead_status || "new"}</span></td><td><b>{lead.qualification_score ?? 0}</b><span className="outof"> / 100</span></td></tr>)}
        </tbody></table></div>}
      </section>
      <footer>NBSC LAP Lead Agent · Lead score sirf sales follow-up priority ke liye hai, loan approval nahi.</footer>
    </main>
  </div>;
}

function Stat({title,value,color,icon}) {
  return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-foot">Current pipeline</div></div>;
}

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  return "₹" + Number(v).toLocaleString("en-IN", {maximumFractionDigits:0});
}

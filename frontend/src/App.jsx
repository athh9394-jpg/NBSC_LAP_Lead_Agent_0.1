import React, { useEffect, useMemo, useState } from "react";
import { fetchLeads } from "./services/api";

export default function App() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  async function load() {
    setLoading(true); setError("");
    try { setLeads(await fetchLeads()); }
    catch (e) { setError(e.message || "Leads load nahi ho paye."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    total: leads.length,
    hot: leads.filter(x => x.qualification_label === "hot").length,
    warm: leads.filter(x => x.qualification_label === "warm").length,
    cold: leads.filter(x => x.qualification_label === "cold").length
  }), [leads]);

  const visible = leads.filter(lead => {
    const matchesFilter = filter === "all" || lead.qualification_label === filter;
    const term = query.toLowerCase();
    const matchesQuery = [lead.name, lead.city, lead.source, lead.lead_status]
      .some(v => String(v || "").toLowerCase().includes(term));
    return matchesFilter && matchesQuery;
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
      <header className="topbar"><div><div className="eyebrow">WORKSPACE / OVERVIEW</div><h1>Sales Dashboard</h1><p>NBSC LAP lead pipeline ka snapshot</p></div><button onClick={load} className="refresh">↻ Refresh</button></header>
      <section className="stats">
        <Stat title="Total Leads" value={counts.total} color="blue" icon="▤" />
        <Stat title="Hot Leads" value={counts.hot} color="green" icon="🔥" />
        <Stat title="Warm Leads" value={counts.warm} color="orange" icon="◷" />
        <Stat title="Cold Leads" value={counts.cold} color="red" icon="❄" />
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Lead Pipeline</h2><p>Latest updated leads</p></div><span className="pill">{leads.length} records</span></div>
        <div className="toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, city, source..." /><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All priorities</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></div>
        {loading ? <div className="state">Leads load ho rahe hain…</div> : error ? <div className="error"><b>Connection error</b><p>{error}</p><p>Backend URL, APP_API_TOKEN aur CORS settings check karein.</p><button onClick={load} className="refresh">Try again</button></div> : visible.length === 0 ? <div className="state">Abhi koi lead nahi hai, ya search se match nahi mila.</div> :
        <div className="table-wrap"><table><thead><tr><th>LEAD</th><th>CITY</th><th>LOAN AMOUNT</th><th>INCOME / MONTH</th><th>PRIORITY</th><th>STATUS</th><th>SCORE</th></tr></thead><tbody>
          {visible.map(lead=><tr key={lead.id}><td><div className="person"><span className="avatar">{(lead.name || "L").slice(0,1).toUpperCase()}</span><div><b>{lead.name || "Unnamed lead"}</b><small>{lead.source || "Unknown source"}</small></div></div></td><td>{lead.city || "—"}</td><td>{money(lead.loan_amount)}</td><td>{money(lead.monthly_income)}</td><td><span className={`badge ${lead.qualification_label || "cold"}`}>{lead.qualification_label || "cold"}</span></td><td><span className="status">{lead.lead_status || "new"}</span></td><td><b>{lead.qualification_score ?? 0}</b><span className="outof"> / 100</span></td></tr>)}
        </tbody></table></div>}
      </section>
      <footer>NBSC LAP Lead Agent · Lead score is for sales follow-up only, not loan approval.</footer>
    </main>
  </div>;
}
function Stat({title,value,color,icon}) { return <div className="stat-card"><div className={`stat-icon ${color}`}>{icon}</div><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-foot">Current pipeline</div></div>; }
function money(v) { if (v === null || v === undefined || v === "") return "—"; return "₹" + Number(v).toLocaleString("en-IN", {maximumFractionDigits:0}); }

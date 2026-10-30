import React, { useEffect, useState } from "react";
import { fetchAdminAgents, setAgentBlocked } from "./services/api";

export default function AdminAgents() {
  const [agents, setAgents] = useState([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const rows = await fetchAdminAgents();
      setAgents(rows);
      setVisible(true);
      setMessage("");
    } catch (error) {
      // Non-admin users receive 403 and do not see the admin panel.
      setVisible(false);
      if (!String(error?.message || "").includes("403")) {
        setMessage("Agent management load nahi hua. " + (error?.message || ""));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(agent) {
    setBusyUid(agent.uid);
    setMessage("");
    try {
      await setAgentBlocked(agent.uid, !Boolean(agent.is_blocked));
      await load();
      setMessage(agent.is_blocked ? "Agent unblock ho gaya." : "Agent block ho gaya.");
    } catch (error) {
      setMessage(error?.message || "Agent status update nahi hua.");
    } finally {
      setBusyUid("");
    }
  }

  if (!visible) return message ? <section className="panel"><p role="status">{message}</p></section> : null;

  return <section className="panel">
    <div className="panel-head">
      <div><h2>Admin · Agent Management</h2><p>Agent name/email, UID, leads aur access status</p></div>
      <button type="button" className="refresh" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh agents"}</button>
    </div>
    {message && <p role="status">{message}</p>}
    {loading ? <div className="state">Agents load ho rahe hain…</div> :
      agents.length === 0 ? <div className="state">Abhi koi agent record nahi mila. Agent ke pehli baar login karne par record banega.</div> :
      <div className="table-wrap"><table>
        <thead><tr><th>Agent identity</th><th>Agent UID</th><th>Leads</th><th>Created</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{agents.map(agent => <tr key={agent.uid}>
          <td style={{minWidth:180,wordBreak:"break-word"}}><b>{agent.display_name || "Name not set"}</b><small style={{display:"block",marginTop:4}}>{agent.email || "Email unavailable"}</small></td><td style={{maxWidth:240,wordBreak:"break-all"}}>{agent.uid}</td>
          <td>{agent.lead_count ?? 0}</td>
          <td>{agent.created_at ? new Date(agent.created_at).toLocaleDateString() : "—"}</td>
          <td>{agent.is_blocked ? "Blocked" : "Active"}</td>
          <td><button type="button" className="refresh" disabled={busyUid === agent.uid} onClick={() => toggle(agent)}>
            {busyUid === agent.uid ? "Saving…" : agent.is_blocked ? "Unblock" : "Block"}
          </button></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

import React, { useEffect, useRef, useState } from "react";
import { fetchAdminAgents, setAgentBlocked, fetchAssignableLeads, assignLeadToAgent, fetchAgentActivity } from "./services/api";

export default function AdminAgents() {
  const [agents, setAgents] = useState([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState("");
  const [message, setMessage] = useState("");
  const [assignableLeads, setAssignableLeads] = useState([]);
  const [assignableAgents, setAssignableAgents] = useState([]);
  const [assignmentBusy, setAssignmentBusy] = useState("");
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const activityPanelRef = useRef(null);

  useEffect(() => {
    if (selectedAgent && activityPanelRef.current) {
      activityPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedAgent]);

  async function load() {
    setLoading(true);
    try {
      const [rows, assignmentData] = await Promise.all([fetchAdminAgents(), fetchAssignableLeads()]);
      setAgents(rows);
      setAssignableLeads(assignmentData.leads);
      setAssignableAgents(assignmentData.agents);
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

  async function openAgent(agent) {
    setSelectedAgent({ agent, leads: [], followups: [] });
    setActivityLoading(true);
    setActivityError("");
    try {
      const data = await fetchAgentActivity(agent.uid);
      setSelectedAgent({ agent: data.agent || agent, leads: data.leads || [], followups: data.followups || [] });
    } catch (error) { setActivityError(error?.message || "Agent activity load nahi hui."); }
    finally { setActivityLoading(false); }
  }

  async function assign(leadId, agentUid) {
    setAssignmentBusy(leadId);
    setMessage("");
    try {
      await assignLeadToAgent(leadId, agentUid);
      const data = await fetchAssignableLeads();
      setAssignableLeads(data.leads);
      setAssignableAgents(data.agents);
      setMessage(agentUid ? "Lead agent ko assign ho gaya." : "Lead assignment hata diya gaya.");
    } catch (error) {
      setMessage(error?.message || "Lead assign nahi hua.");
    } finally {
      setAssignmentBusy("");
    }
  }

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
      <div><h2>Admin · Agent Management</h2><p>Agent name/email, assigned leads aur access status</p></div>
      <button type="button" className="refresh" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh agents"}</button>
    </div>
    {message && <p role="status">{message}</p>}
    <h3 style={{marginTop:20}}>Lead Assignment</h3>
    <p>Lead ko active agent ko assign karein. Agent assigned lead aur follow-up dekh sakega.</p>
    {assignableLeads.length === 0 ? <div className="state">Assign karne ke liye abhi lead nahi hai.</div> : <div className="table-wrap"><table>
      <thead><tr><th>Lead</th><th>Phone</th><th>Assigned Agent</th><th>Action</th></tr></thead>
      <tbody>{assignableLeads.map(lead => <tr key={lead.id}>
        <td>{lead.name || "Unnamed lead"}</td><td>{lead.phone || "—"}</td>
        <td><div className="choice-options admin-assign-options"><button type="button" className={"choice-option"+(!lead.assigned_to_uid?" active":"")} disabled={assignmentBusy===lead.id} onClick={()=>void assign(lead.id,"")}>Unassigned</button>{assignableAgents.map(agent=><button type="button" key={agent.uid} className={"choice-option"+(lead.assigned_to_uid===agent.uid?" active":"")} disabled={assignmentBusy===lead.id} onClick={()=>void assign(lead.id,agent.uid)}>{agent.display_name || agent.email || agent.uid}</button>)}</div></td><td>{assignmentBusy === lead.id ? "Saving…" : "Auto-save"}</td>
      </tr>)}</tbody>
    </table></div>}
    {loading ? <div className="state">Agents load ho rahe hain…</div> :
      agents.length === 0 ? <div className="state">Abhi koi agent record nahi mila. Agent ke pehli baar login karne par record banega.</div> :
      <div className="table-wrap"><table>
        <thead><tr><th>Agent</th><th>Leads</th><th>Activity</th><th>Created</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{agents.map(agent => <tr key={agent.uid}>
          <td style={{minWidth:180,wordBreak:"break-word"}}><button type="button" className="refresh" style={{display:"block",textAlign:"left",whiteSpace:"normal"}} onClick={() => void openAgent(agent)} aria-label={"Open activity for " + (agent.display_name || agent.email || "agent")}><b>{agent.display_name || "Name not set"}</b></button><small style={{display:"block",marginTop:4}}>{agent.email || "Email unavailable"}</small></td>
          <td>{agent.lead_count ?? 0}</td>
          <td><button type="button" className="refresh" onClick={() => void openAgent(agent)}>Open activity</button></td>
          <td>{agent.created_at ? new Date(agent.created_at).toLocaleDateString() : "—"}</td>
          <td>{agent.is_blocked ? "Blocked" : "Active"}</td>
          <td><button type="button" className="refresh" disabled={busyUid === agent.uid} onClick={() => toggle(agent)}>
            {busyUid === agent.uid ? "Saving…" : agent.is_blocked ? "Unblock" : "Block"}
          </button></td>
        </tr>)}</tbody>
      </table></div>}

    {selectedAgent && <section ref={activityPanelRef} className="panel" style={{marginTop:16, scrollMarginTop:16}}><div className="panel-head"><div><h3>Agent Activity</h3><p>{selectedAgent.agent.display_name || selectedAgent.agent.email || selectedAgent.agent.uid}</p><p>Email/Login ID: {selectedAgent.agent.email || "Email unavailable — agent ko dobara sign in karna hoga"}</p></div><button type="button" className="refresh" onClick={() => setSelectedAgent(null)}>Close</button></div>{activityLoading ? <div className="state">Agent activity load ho rahi hai…</div> : activityError ? <p role="alert">{activityError}</p> : <><h4>Leads ({selectedAgent.leads.length})</h4>{selectedAgent.leads.length ? <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Phone</th><th>Status</th><th>Ownership</th></tr></thead><tbody>{selectedAgent.leads.map(lead => <tr key={lead.id}><td>{lead.name}</td><td>{lead.phone}</td><td>{lead.status}</td><td>{lead.assigned_to_uid === selectedAgent.agent.uid ? "Assigned" : "Created by agent"}</td></tr>)}</tbody></table></div> : <p>No leads created or assigned to this agent.</p>}<h4>Follow-up activity ({selectedAgent.followups.length})</h4>{selectedAgent.followups.length ? <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Channel</th><th>Outcome</th><th>Notes</th><th>Date</th></tr></thead><tbody>{selectedAgent.followups.map(item => <tr key={item.id}><td>{item.lead_name}</td><td>{item.channel}</td><td>{item.outcome}</td><td>{item.notes || "—"}</td><td>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div> : <p>No follow-up history found.</p>}</>}</section>}
  </section>;
}

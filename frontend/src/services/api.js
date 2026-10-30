const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://nbsc-lap-backend-01.onrender.com"
).replace(/\/$/, "");

const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  "https://vmnpgieduiolzkrbuoei.supabase.co"
).replace(/\/$/, "");
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_ty9eO2VEiIqBMC_naMy57A_EDOHgrMS";

let refreshPromise = null;

async function refreshSession() {
  const refreshToken = localStorage.getItem("nbsc_refresh_token");
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        throw new Error(data.msg || data.message || "Session expired. Please sign in again.");
      }
      localStorage.setItem("nbsc_access_token", data.access_token);
      if (data.refresh_token) {
        localStorage.setItem("nbsc_refresh_token", data.refresh_token);
      }
      return data.access_token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function clearSessionAndReturnToLogin() {
  localStorage.removeItem("nbsc_access_token");
  localStorage.removeItem("nbsc_refresh_token");
  // AuthGate reads the stored token on mount; reload returns the user to login.
  window.location.reload();
}

async function request(path, options = {}, retry = true) {
  const token = localStorage.getItem("nbsc_access_token") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  if (res.status === 401 && retry) {
    try {
      const newToken = await refreshSession();
      if (newToken) return request(path, options, false);
      clearSessionAndReturnToLogin();
    } catch {
      clearSessionAndReturnToLogin();
    }
  }

  if (!res.ok) {
    const raw = await res.text();
    let message = raw || res.statusText;
    try {
      const body = JSON.parse(raw);
      message = body.detail || JSON.stringify(body);
    } catch {
      // Keep the plain-text error message when the API does not return JSON.
    }
    throw new Error(`API ${res.status}: ${message}`);
  }

  return res.json();
}

function normalizeLead(lead) {
  const score = Number(lead.qualification_score ?? lead.score ?? 0);
  return {
    ...lead,
    lead_status: lead.lead_status ?? lead.status ?? "new",
    qualification_score: score,
    qualification_label:
      lead.qualification_label ?? (score >= 60 ? "hot" : score >= 30 ? "warm" : "cold"),
    loan_amount: lead.loan_amount ?? lead.budget ?? null,
    monthly_income: lead.monthly_income ?? null,
    customer_type: lead.customer_type ?? "business"
  };
}

export async function fetchLeads() {
  const data = await request("/leads");
  const leads = Array.isArray(data) ? data : data?.leads;
  if (!Array.isArray(leads)) {
    throw new Error("Invalid API response: leads list missing");
  }
  return leads.filter(Boolean).map(normalizeLead);
}

export async function fetchLead(id) {
  const data = await request(`/lead/${encodeURIComponent(id)}`);
  return data?.lead ? { ...data, lead: normalizeLead(data.lead) } : data;
}

export async function createLead(payload) {
  const data = await request("/lead", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data?.lead ? { ...data, lead: normalizeLead(data.lead) } : data;
}

export async function fetchFollowups(id) {
  const data = await request(`/lead/${encodeURIComponent(id)}/followups`);
  return Array.isArray(data?.followups) ? data.followups : [];
}

export async function addFollowup(id, payload) {
  return request(`/lead/${encodeURIComponent(id)}/followups`, {
    method: "POST", body: JSON.stringify(payload)
  });
}

export async function updateLeadStatus(id, status) {
  const data = await request(`/lead/${encodeURIComponent(id)}/status`, {
    method: "PATCH", body: JSON.stringify({ status })
  });
  return data?.lead ? normalizeLead(data.lead) : data;
}


export async function fetchAdminAgents() {
  const data = await request("/admin/agents");
  return Array.isArray(data?.agents) ? data.agents : [];
}

export async function setAgentBlocked(uid, isBlocked) {
  return request(`/admin/agents/${encodeURIComponent(uid)}/block`, {
    method: "PATCH",
    body: JSON.stringify({ is_blocked: Boolean(isBlocked) })
  });
}

// Revoke the Supabase session when possible; always clear local credentials even offline.
export async function logoutSession() {
  const accessToken = localStorage.getItem("nbsc_access_token") || "";
  try {
    if (accessToken) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${accessToken}`
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }
  } catch {
    // Offline logout must still clear this device's stored session.
  } finally {
    localStorage.removeItem("nbsc_access_token");
    localStorage.removeItem("nbsc_refresh_token");
    window.location.reload();
  }
}


export async function fetchCurrentUser() {
  return request("/me");
}


export async function fetchAssignableLeads() {
  const data = await request("/admin/leads/assignable");
  return { leads: Array.isArray(data?.leads) ? data.leads : [], agents: Array.isArray(data?.agents) ? data.agents : [] };
}

export async function assignLeadToAgent(leadId, agentUid) {
  return request("/admin/leads/" + encodeURIComponent(leadId) + "/assign", {
    method: "PATCH", body: JSON.stringify({ agent_uid: agentUid || null })
  });
}


 
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://nbsc-lap-backend-01.onrender.com"
).replace(/\/$/, "");

const TOKEN = import.meta.env.VITE_API_TOKEN || "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`API ${res.status}: ${message || res.statusText}`);
  }

  const data = await res.json();

  if (path === "/leads") {
    // Backend se { success, count, leads: [...] } aata hai
    const leads = Array.isArray(data) ? data : data?.leads;

    if (!Array.isArray(leads)) {
      throw new Error("Invalid API response: leads list missing");
    }

    // Backend aur dashboard ke field names match karna
    return leads.filter(Boolean).map((lead) => ({
      ...lead,
      lead_status: lead.lead_status ?? lead.status ?? "new",
      qualification_score:
        lead.qualification_score ?? lead.score ?? 0,
      qualification_label:
        lead.qualification_label ?? "cold",
      loan_amount: lead.loan_amount ?? lead.budget ?? null,
      monthly_income: lead.monthly_income ?? null
    }));
  }

  // Single lead endpoint ka response
  return data;
}

export function fetchLeads() {
  return request("/leads");
}

export function fetchLead(id) {
  return request(`/lead/${encodeURIComponent(id)}`);
}

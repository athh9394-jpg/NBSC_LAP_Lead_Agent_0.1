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
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail || JSON.stringify(body);
    } catch {
      const bodyText = await res.text();
      if (bodyText) message = bodyText;
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

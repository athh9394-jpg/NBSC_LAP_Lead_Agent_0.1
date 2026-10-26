
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://nbsc-lap-backend-01.onrender.com"
).replace(/\/$/, "");

const TOKEN = import.meta.env.VITE_API_TOKEN || "";

async function request(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`API ${res.status}: ${message || res.statusText}`);
  }

  return res.json();
}

export function fetchLeads() {
  return request("/leads");
}

export function fetchLead(id) {
  return request(`/lead/${encodeURIComponent(id)}`);
}

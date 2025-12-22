// =====================================
// HTTP helper central
// =====================================
export async function fetchJSON(url, options = {}) {
  const r = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (r.status === 401) {
    location.href = "/login.html";
    throw new Error("No autorizado");
  }

  const data = await r.json().catch(() => null);

  if (!r.ok) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }

  return data;
}


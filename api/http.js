// api/http.js (ESM)
// Cliente HTTP reutilizable para /api con sesión por cookie (credentials: "include").

function normalizeApiPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "/api";
  const cleaned = raw.startsWith("/") ? raw : `/${raw}`;
  // Evita dobles slashes en el medio
  return `/api${cleaned}`.replace(/\/{2,}/g, "/");
}

export function toQuery(paramsObj = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    params.append(k, s);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function readErrorMessage(res) {
  // Intenta JSON { ok:false, error } o texto
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const j = await res.json();
      if (j && typeof j.error === "string" && j.error.trim()) return j.error.trim();
      return JSON.stringify(j);
    }
    const t = await res.text();
    return (t || "").trim() || `HTTP ${res.status}`;
  } catch (_) {
    return `HTTP ${res.status}`;
  }
}

export async function apiFetch(path, options = {}) {
  const url = normalizeApiPath(path);

  const opts = {
    method: "GET",
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  };

  // Auto JSON
  const hasBody = opts.body !== undefined && opts.body !== null;
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const contentType = Object.keys(opts.headers).find((h) => h.toLowerCase() === "content-type");

  if (hasBody && !isFormData) {
    // Si body es objeto, lo serializamos a JSON
    if (typeof opts.body === "object" && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer)) {
      opts.body = JSON.stringify(opts.body);
      if (!contentType) opts.headers["Content-Type"] = "application/json";
    } else {
      if (!contentType) opts.headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, opts);

  if (res.status === 401) {
    // Sesión caída -> login
    window.location.href = "/login.html";
    throw new Error("No autorizado");
  }

  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new Error(msg);
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await res.json();
  // Si el backend responde vacío o texto
  const text = await res.text();
  return text || null;
}

export async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: "POST", body });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: "PUT", body });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: "DELETE" });
}

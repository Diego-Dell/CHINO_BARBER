// api/egresos.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/egresos";

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function assertId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new Error("ID inválido");
  return n;
}

function assertPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido");
  }
  return payload;
}

// 6.1 Listar egresos
export async function list({ desde, hasta, categoria, q, limit, offset } = {}) {
  const query = qs({ desde, hasta, categoria, q, limit, offset });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 6.2 Obtener egreso por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 6.3 Crear egreso
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.4 Actualizar egreso
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.5 Eliminar egreso
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 7.1 Resumen por rango
// Nota: si tu resumen está en /api/reportes/egresos, cambia BASE a "/api/reportes/egresos" aquí.
export async function resumen({ desde, hasta } = {}) {
  const query = qs({ desde, hasta });
  return fetchJSON(`${BASE}/resumen${query}`, { method: "GET" });
}

// Ejemplo:
// import { list, create } from "../../api/egresos.api.js";
// await create({ categoria:"Servicios", detalle:"Luz", monto:120, fecha:"2025-12-10" });
// const { data } = await list({ desde:"2025-12-01", hasta:"2025-12-31" });

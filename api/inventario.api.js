// api/inventario.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/inventario";

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

// 5.A — ITEMS
export async function listItems({ q, estado, limit, offset } = {}) {
  const query = qs({ q, estado, limit, offset });
  return fetchJSON(`${BASE}/items${query}`, { method: "GET" });
}

export async function getItemById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/items/${safeId}`, { method: "GET" });
}

export async function createItem(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateItem(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/items/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function removeItem(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/items/${safeId}`, { method: "DELETE" });
}

export async function getItemStock(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/items/${safeId}/stock`, { method: "GET" });
}

// 5.B — MOVIMIENTOS
export async function createMovimiento(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/movimientos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listMovimientos({
  item_id,
  curso_id,
  instructor_id,
  tipo,
  desde,
  hasta,
  limit,
  offset,
} = {}) {
  const query = qs({ item_id, curso_id, instructor_id, tipo, desde, hasta, limit, offset });
  return fetchJSON(`${BASE}/movimientos${query}`, { method: "GET" });
}

// 5.C — ALERTAS / RESÚMENES
export async function alertas() {
  return fetchJSON(`${BASE}/alertas`, { method: "GET" });
}

// Nota: si tu resumen está en /api/reportes/inventario, cambia esta función a:
// return fetchJSON(`/api/reportes/inventario${query}`, { method: "GET" });
export async function resumen({ desde, hasta } = {}) {
  const query = qs({ desde, hasta });
  return fetchJSON(`${BASE}/resumen${query}`, { method: "GET" });
}

// Ejemplo:
// import { listItems, createMovimiento, alertas } from "../../api/inventario.api.js";
// const { data } = await listItems({ q: "navaja", estado: "Activo" });
// await createMovimiento({ item_id: 1, tipo: "Salida", cantidad: 2, motivo: "Clase", fecha: "2025-12-18" });
// const low = await alertas();

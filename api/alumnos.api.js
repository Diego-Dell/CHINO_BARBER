// api/alumnos.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/alumnos";

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

// 6.1 Listar alumnos
export async function list({ q, estado, limit, offset } = {}) {
  const query = qs({ q, estado, limit, offset });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 6.2 Obtener por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 6.3 Crear
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.4 Actualizar
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.5 Eliminar (soft delete)
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 6.6 Activar
export async function activate(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/activar`, { method: "POST" });
}

// 6.7 Inscripciones del alumno
export async function getInscripciones(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/inscripciones`, { method: "GET" });
}

// Ejemplo:
// import { list, create } from "../../api/alumnos.api.js";
// const { data, meta } = await list({ q: "juan", estado: "Activo" });
// await create({ nombre:"Juan", documento:"123" });

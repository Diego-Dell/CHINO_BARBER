// api/instructores.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/instructores";

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;

    if (k === "soloActivos") {
      // acepta true/false, 1/0, "1"/"0"
      const val = v === true || v === 1 || String(v).trim() === "1" ? "1" : "0";
      sp.set(k, val);
      continue;
    }

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

// 5.1 Listar instructores
export async function list({ q, estado, soloActivos, limit, offset } = {}) {
  const query = qs({ q, estado, soloActivos, limit, offset });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 5.2 Obtener por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 5.3 Crear instructor
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.4 Actualizar instructor
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.5 Eliminar (soft delete)
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 6.1 Cursos del instructor
export async function getCursos(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/cursos`, { method: "GET" });
}

// 6.2 Agenda del instructor
export async function getAgenda(id, { desde, hasta, estado } = {}) {
  const safeId = assertId(id);
  const query = qs({ desde, hasta, estado });
  return fetchJSON(`${BASE}/${safeId}/agenda${query}`, { method: "GET" });
}

// 6.3 Uso/Movimientos de inventario del instructor
export async function getUsoInventario(id, { desde, hasta, item_id } = {}) {
  const safeId = assertId(id);
  const query = qs({ desde, hasta, item_id });
  return fetchJSON(`${BASE}/${safeId}/uso-inventario${query}`, { method: "GET" });
}

// Ejemplo:
// import { list, create } from "../../api/instructores.api.js";
// const { data } = await list({ soloActivos: true });
// await create({ nombre:"Carlos", especialidad:"Fade", estado:"Activo" });

// api/cursos.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/cursos";

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;

    if (k === "withStats") {
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

// 5.1 Listar cursos
export async function list({ q, estado, instructor_id, limit, offset, withStats } = {}) {
  const query = qs({ q, estado, instructor_id, limit, offset, withStats });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 5.2 Obtener por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 5.3 Crear curso
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.4 Actualizar curso
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

// 6.1 Ver inscritos del curso
export async function getInscritos(id, { estado = "Activa" } = {}) {
  const safeId = assertId(id);
  const query = qs({ estado });
  return fetchJSON(`${BASE}/${safeId}/inscritos${query}`, { method: "GET" });
}

// 6.2 Ver cupo del curso (stats)
export async function getCupo(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/cupo`, { method: "GET" });
}

// Ejemplo:
// import { list, create, getCupo } from "../../api/cursos.api.js";
// const { data } = await list({ withStats: true });
// await create({ nombre:"Fade Pro", precio:500, cupo:20, instructor_id:2, estado:"Activo" });
// const cupo = await getCupo(3);

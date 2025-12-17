// api/inscripciones.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/inscripciones";

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

// 5.1 Listar inscripciones
export async function list({ alumno_id, curso_id, estado, q, limit, offset } = {}) {
  const query = qs({ alumno_id, curso_id, estado, q, limit, offset });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 5.2 Obtener detalle por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 5.3 Crear inscripción
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.4 Actualizar inscripción
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.5 Eliminar inscripción (baja lógica)
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 6.1 Inscripciones por curso (para asistencia)
export async function listByCurso(curso_id, { estado = "Activa" } = {}) {
  const safeCursoId = assertId(curso_id);
  try {
    // Endpoint recomendado: /por-curso/:curso_id
    return await fetchJSON(`${BASE}/por-curso/${safeCursoId}`, { method: "GET" });
  } catch (err) {
    // Fallback: usar list() (sin duplicar lógica)
    return list({ curso_id: safeCursoId, estado });
  }
}

// 6.2 Pagos de una inscripción
export async function getPagos(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/pagos`, { method: "GET" });
}

// 6.3 Asistencia de una inscripción
export async function getAsistencia(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/asistencia`, { method: "GET" });
}

// 6.4 Deuda de una inscripción
export async function getDeuda(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/deuda`, { method: "GET" });
}

// Ejemplo:
// import { list, listByCurso, create, getDeuda } from "../../api/inscripciones.api.js";
// const { data } = await list({ curso_id: 1, estado: "Activa" });
// const inscritos = await listByCurso(1);
// await create({ alumno_id: 3, curso_id: 1, estado: "Activa" });
// const deuda = await getDeuda(10);

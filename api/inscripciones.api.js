// api/inscripciones.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/inscripciones";

// ===============================
// Helpers
// ===============================
function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;

    // permitir 0 / false (por si algún día lo usas)
    const s = typeof v === "string" ? v.trim() : String(v);
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

/**
 * Normaliza errores para que SIEMPRE tengas un mensaje usable en UI.
 * - Si backend manda {error:"Cupo lleno"} y fetchJSON lo lanza como Error("..."),
 *   esto lo deja intacto.
 */
function normalizeError(err, fallback = "Error en inscripciones") {
  const msg = String(err?.message || err || fallback);

  // si vino un html o algo raro, reducimos
  if (msg.includes("<html") || msg.includes("<!DOCTYPE")) {
    const e = new Error(fallback);
    e.code = err?.code;
    e.status = err?.status;
    return e;
  }

  const e = new Error(msg || fallback);
  e.code = err?.code;
  e.status = err?.status;
  return e;
}

/**
 * Llamada central para no duplicar lógica.
 */
async function call(url, options) {
  try {
    return await fetchJSON(url, options);
  } catch (err) {
    throw normalizeError(err);
  }
}

// ===============================
// 5.1 Listar inscripciones
// GET /api/inscripciones?alumno_id&curso_id&estado&q&limit&offset
// ===============================
export async function list({ alumno_id, curso_id, estado, q, limit, offset } = {}) {
  const query = qs({ alumno_id, curso_id, estado, q, limit, offset });
  return call(`${BASE}${query}`, { method: "GET" });
}

// ===============================
// 5.2 Obtener detalle por id
// GET /api/inscripciones/:id
// ===============================
export async function getById(id) {
  const safeId = assertId(id);
  return call(`${BASE}/${safeId}`, { method: "GET" });
}

// ===============================
// 5.3 Crear inscripción
// POST /api/inscripciones
// payload: { alumno_id, curso_id, estado }
// ===============================
export async function create(payload) {
  const body = assertPayload(payload);

  // validaciones suaves (no rompen nada si vienen strings)
  if (!body.alumno_id || !body.curso_id) {
    throw new Error("alumno_id y curso_id son obligatorios");
  }

  try {
    return await call(`${BASE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Mensajes amigables (si backend responde Cupo lleno / Ya inscrito)
    const msg = String(err.message || "");

    // No cambies el texto base si ya viene bien del backend
    if (msg.includes("Cupo lleno")) throw err;
    if (msg.includes("Ya inscrito")) throw err;

    // fallback
    throw normalizeError(err, "No se pudo crear la inscripción");
  }
}

// ===============================
// 5.4 Actualizar inscripción
// PUT /api/inscripciones/:id
// ===============================
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return call(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ===============================
// 5.5 Eliminar inscripción (baja lógica o delete)
// DELETE /api/inscripciones/:id
// ===============================
export async function remove(id) {
  const safeId = assertId(id);
  return call(`${BASE}/${safeId}`, { method: "DELETE" });
}

// ===============================
// 6.1 Inscripciones por curso (para asistencia)
// - Intenta /por-curso/:curso_id
// - Si no existe, hace fallback con list({curso_id, estado})
// ===============================
export async function listByCurso(curso_id, { estado = "Activa" } = {}) {
  const safeCursoId = assertId(curso_id);

  // 1) endpoint recomendado
  try {
    return await call(`${BASE}/por-curso/${safeCursoId}${qs({ estado })}`, { method: "GET" });
  } catch (err) {
    // 2) fallback genérico
    return list({ curso_id: safeCursoId, estado });
  }
}

// ===============================
// 6.2 Pagos de una inscripción
// GET /api/inscripciones/:id/pagos
// ===============================
export async function getPagos(id) {
  const safeId = assertId(id);
  return call(`${BASE}/${safeId}/pagos`, { method: "GET" });
}

// ===============================
// 6.3 Asistencia de una inscripción
// GET /api/inscripciones/:id/asistencia
// ===============================
export async function getAsistencia(id) {
  const safeId = assertId(id);
  return call(`${BASE}/${safeId}/asistencia`, { method: "GET" });
}

// ===============================
// 6.4 Deuda de una inscripción
// GET /api/inscripciones/:id/deuda
// ===============================
export async function getDeuda(id) {
  const safeId = assertId(id);
  return call(`${BASE}/${safeId}/deuda`, { method: "GET" });
}

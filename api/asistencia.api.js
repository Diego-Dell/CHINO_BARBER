// api/asistencia.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/asistencia";

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

function toPosInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeRegistro(r) {
  if (!r || typeof r !== "object") return null;

  const inscripcion_id = toPosInt(r.inscripcion_id);
  const estado = String(r.estado ?? "").trim();
  if (!inscripcion_id || !estado) return null;

  const observacion = String(r.observacion ?? "").trim();
  return { inscripcion_id, estado, observacion };
}

// 6.1 Listar asistencia por curso y fecha
export async function listByCursoFecha({ curso_id, fecha } = {}) {
  const cid = toPosInt(curso_id);
  const f = String(fecha ?? "").trim();
  const query = qs({ curso_id: cid || undefined, fecha: f || undefined });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 6.2 Listar asistencia por inscripción (detalle)
export async function listByInscripcion(inscripcion_id, { desde, hasta } = {}) {
  const iid = toPosInt(inscripcion_id);
  if (!iid) throw new Error("inscripcion_id inválido");
  const query = qs({ desde, hasta });
  return fetchJSON(`${BASE}/inscripcion/${iid}${query}`, { method: "GET" });
}

// 6.3 Guardar asistencia BULK (CRÍTICO)
export async function bulkSave({ fecha, curso_id, registros } = {}) {
  const f = String(fecha ?? "").trim();
  const cid = toPosInt(curso_id);
  if (!f) throw new Error("fecha es obligatoria");
  if (!cid) throw new Error("curso_id es obligatorio");
  if (!Array.isArray(registros)) throw new Error("registros debe ser un array");

  const cleaned = registros
    .map(normalizeRegistro)
    .filter(Boolean);

  if (cleaned.length === 0) {
    throw new Error("No hay registros válidos para guardar");
  }

  // Backend esperado (según tu prompt): { fecha, curso_id, registros:[...] }
  return fetchJSON(`${BASE}/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha: f, curso_id: cid, registros: cleaned }),
  });
}

// 6.4 Guardar 1 registro (opcional)
export async function saveOne({ inscripcion_id, fecha, estado, observacion } = {}) {
  const iid = toPosInt(inscripcion_id);
  const f = String(fecha ?? "").trim();
  const st = String(estado ?? "").trim();
  const obs = String(observacion ?? "").trim();

  if (!iid) throw new Error("inscripcion_id es obligatorio");
  if (!f) throw new Error("fecha es obligatoria");
  if (!st) throw new Error("estado es obligatorio");

  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inscripcion_id: iid, fecha: f, estado: st, observacion: obs }),
  });
}

// Ejemplo:
// import { bulkSave } from "../../api/asistencia.api.js";
// await bulkSave({
//   fecha: "2025-12-20",
//   curso_id: 1,
//   registros: [
//     { inscripcion_id: 10, estado: "Asistio", observacion: "" },
//     { inscripcion_id: 11, estado: "Falto", observacion: "No llegó" }
//   ]
// });

// api/pagos.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/pagos";

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

// 5.1 Listar pagos
export async function list({
  inscripcion_id,
  alumno_id,
  curso_id,
  estado,
  metodo,
  desde,
  hasta,
  q,
  limit,
  offset,
} = {}) {
  const query = qs({
    inscripcion_id,
    alumno_id,
    curso_id,
    estado,
    metodo,
    desde,
    hasta,
    q,
    limit,
    offset,
  });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 5.2 Obtener pago por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 5.3 Crear pago
export async function create(payload) {
  const body = assertPayload(payload);

  const insId = Number(body.inscripcion_id);
  if (!Number.isFinite(insId) || insId <= 0) throw new Error("inscripcion_id es obligatorio");

  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.4 Actualizar pago
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);

  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.5 Anular pago
export async function anular(id, { motivo } = {}) {
  const safeId = assertId(id);

  const m = motivo !== undefined && motivo !== null ? String(motivo).trim() : "";
  const hasBody = Boolean(m);

  return fetchJSON(`${BASE}/${safeId}/anular`, {
    method: "POST",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: m }),
        }
      : {}),
  });
}

// 6.1 Resumen de una inscripción (precio, pagado, deuda)
export async function resumenInscripcion(inscripcion_id) {
  const safeId = assertId(inscripcion_id);
  return fetchJSON(`${BASE}/inscripcion/${safeId}/resumen`, { method: "GET" });
}

// 6.2 Deudores
// Nota: si tu backend expone esto en /api/pagos/deudores, funciona directo aquí.
// Si lo moviste a /api/reportes/deudores, cambia la línea a:
// return fetchJSON(`/api/reportes/deudores${query}`, { method: "GET" });
export async function deudores({ q, curso_id, limit, offset } = {}) {
  const query = qs({ q, curso_id, limit, offset });
  return fetchJSON(`${BASE}/deudores${query}`, { method: "GET" });
}

// 6.3 Resumen financiero (dashboard)
export async function resumen({ desde, hasta } = {}) {
  const query = qs({ desde, hasta });
  return fetchJSON(`${BASE}/resumen${query}`, { method: "GET" });
}

// Ejemplo:
// import { create, list, resumenInscripcion, anular } from "../../api/pagos.api.js";
// await create({ inscripcion_id: 10, monto: 200, metodo: "Efectivo", observaciones: "Adelanto" });
// const { data } = await list({ alumno_id: 3, desde: "2025-12-01", hasta: "2025-12-31" });
// const r = await resumenInscripcion(10);
// await anular(55, { motivo: "Error de caja" });

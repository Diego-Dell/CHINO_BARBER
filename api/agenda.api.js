// api/agenda.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/agenda";

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

// 6.1 Listar turnos
export async function list({
  fecha,
  desde,
  hasta,
  instructor_id,
  alumno_id,
  estado,
  q,
  limit,
  offset,
} = {}) {
  const query = qs({
    fecha,
    desde,
    hasta,
    instructor_id,
    alumno_id,
    estado,
    q,
    limit,
    offset,
  });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 6.2 Obtener turno por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 6.3 Crear turno
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.4 Actualizar turno
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 6.5 Eliminar turno
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 7.1 Confirmar turno
export async function confirmar(id, { notas } = {}) {
  const safeId = assertId(id);

  const n = notas !== undefined && notas !== null ? String(notas).trim() : "";
  const hasBody = Boolean(n);

  return fetchJSON(`${BASE}/${safeId}/confirmar`, {
    method: "POST",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notas: n }),
        }
      : {}),
  });
}

// 7.2 Cancelar turno
export async function cancelar(id, { motivo } = {}) {
  const safeId = assertId(id);

  const m = motivo !== undefined && motivo !== null ? String(motivo).trim() : "";
  const hasBody = Boolean(m);

  return fetchJSON(`${BASE}/${safeId}/cancelar`, {
    method: "POST",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: m }),
        }
      : {}),
  });
}

// 7.3 Turnos por instructor (atajo con fallback)
export async function listByInstructor(instructor_id, { desde, hasta, fecha, estado } = {}) {
  const iid = assertId(instructor_id);
  const query = qs({ desde, hasta, fecha, estado });

  try {
    return await fetchJSON(`${BASE}/instructor/${iid}${query}`, { method: "GET" });
  } catch (err) {
    return list({ instructor_id: iid, desde, hasta, fecha, estado });
  }
}

// 7.4 Turnos por alumno (atajo con fallback)
export async function listByAlumno(alumno_id, { desde, hasta, fecha, estado } = {}) {
  const aid = assertId(alumno_id);
  const query = qs({ desde, hasta, fecha, estado });

  try {
    return await fetchJSON(`${BASE}/alumno/${aid}${query}`, { method: "GET" });
  } catch (err) {
    return list({ alumno_id: aid, desde, hasta, fecha, estado });
  }
}

// Ejemplo:
// import { list, create, confirmar } from "../../api/agenda.api.js";
// const { data } = await list({ fecha:"2025-12-20", instructor_id: 2 });
// const t = await create({ fecha:"2025-12-20", hora:"10:00", cliente_nombre:"Juan", instructor_id:2, servicio:"Corte", precio:50 });
// await confirmar(t.data?.id || t.id);

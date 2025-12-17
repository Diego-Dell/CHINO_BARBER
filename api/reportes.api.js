// api/reportes.api.js
// Cliente (browser) para /api/reportes. Usa fetchJSON (con credentials: "include").
// No calcula nada en frontend: solo llama endpoints del backend.

import { fetchJSON } from "./http.js";

const BASE = "/api/reportes";

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (s === "") continue;
    sp.set(k, String(s));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function assertRequired(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${name} es requerido`);
  }
}

// 5.1 Dashboard
export async function dashboard() {
  return fetchJSON(`${BASE}/dashboard`);
}

// 5.2 Ingresos
export async function ingresos({ desde, hasta } = {}) {
  return fetchJSON(`${BASE}/ingresos${qs({ desde, hasta })}`);
}

// 5.3 Egresos
export async function egresos({ desde, hasta } = {}) {
  return fetchJSON(`${BASE}/egresos${qs({ desde, hasta })}`);
}

// 5.4 Balance
export async function balance({ desde, hasta } = {}) {
  return fetchJSON(`${BASE}/balance${qs({ desde, hasta })}`);
}

// 5.5 Cursos (ocupación/ingresos)
export async function cursos() {
  return fetchJSON(`${BASE}/cursos`);
}

// 5.6 Asistencia por curso
export async function asistencia({ curso_id, desde, hasta } = {}) {
  assertRequired(curso_id, "curso_id");
  return fetchJSON(`${BASE}/asistencia${qs({ curso_id, desde, hasta })}`);
}

// 5.7 Deudores
export async function deudores() {
  return fetchJSON(`${BASE}/deudores`);
}

// 5.8 Caja por día
export async function caja({ fecha } = {}) {
  assertRequired(fecha, "fecha");
  return fetchJSON(`${BASE}/caja${qs({ fecha })}`);
}

// 5.9 Inventario (stock + alertas)
export async function inventario() {
  return fetchJSON(`${BASE}/inventario`);
}

/*
// Ejemplo:
// import { dashboard, ingresos, asistencia } from "../../api/reportes.api.js";
// const d = await dashboard();
// const ing = await ingresos({ desde:"2025-12-01", hasta:"2025-12-31" });
// const a = await asistencia({ curso_id: 1, desde:"2025-12-01", hasta:"2025-12-31" });
*/

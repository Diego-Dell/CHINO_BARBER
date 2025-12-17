// api/settings.api.js
// Frontend API client (ES Module) para SETTINGS. Usa fetchJSON (cookies/sesión) desde api/http.js.

import { fetchJSON } from "./http.js";

const BASE = "/api/settings";

function assertKey(clave) {
  if (typeof clave !== "string") throw new Error("clave debe ser string");
  const k = clave.trim();
  if (!k) throw new Error("clave es requerida");
  return k;
}

function safeKeyPath(clave) {
  return encodeURIComponent(assertKey(clave));
}

// 5.1 Obtener settings públicos (para frontend)
export async function getPublic() {
  return fetchJSON(`${BASE}/public`, { method: "GET" });
}

// 5.2 Listar todas las settings (Admin)
export async function list() {
  return fetchJSON(BASE, { method: "GET" });
}

// 5.3 Obtener por clave
export async function getByKey(clave) {
  const k = safeKeyPath(clave);
  return fetchJSON(`${BASE}/${k}`, { method: "GET" });
}

// 5.4 Crear o upsert por clave (Admin)
export async function upsert({ clave, valor, descripcion } = {}) {
  const k = assertKey(clave);
  const body = { clave: k };
  if (valor !== undefined) body.valor = valor;
  if (descripcion !== undefined) body.descripcion = descripcion;

  return fetchJSON(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.5 Actualizar por clave (Admin)
export async function update(clave, { valor, descripcion } = {}) {
  const k = safeKeyPath(clave);
  const body = {};
  if (valor !== undefined) body.valor = valor;
  if (descripcion !== undefined) body.descripcion = descripcion;

  return fetchJSON(`${BASE}/${k}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.6 Eliminar por clave (Admin)
export async function remove(clave) {
  const k = safeKeyPath(clave);
  return fetchJSON(`${BASE}/${k}`, { method: "DELETE" });
}

// Ejemplo:
// import { getPublic, upsert } from "../../api/settings.api.js";
// const pub = await getPublic();
// await upsert({ clave:"moneda", valor:"Bs", descripcion:"Moneda del sistema" });

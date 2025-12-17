// api/auth.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/auth";

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

function assertObj(v, msg = "Payload inválido") {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(msg);
  return v;
}

// 5.1 Login
export async function login({ usuario, password } = {}) {
  const payload = assertObj({ usuario, password }, "Credenciales inválidas");
  if (!String(payload.usuario || "").trim()) throw new Error("usuario es obligatorio");
  if (!String(payload.password || "").trim()) throw new Error("password es obligatorio");

  const res = await fetchJSON(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: payload.usuario, password: payload.password }),
  });

  // backend: { ok:true, data:{ id, usuario, rol } }
  return res?.data;
}

// 5.2 Logout
export async function logout() {
  return fetchJSON(`${BASE}/logout`, { method: "POST" });
}

// 5.3 Sesión actual
export async function me({ silent = false } = {}) {
  try {
    const res = await fetchJSON(`${BASE}/me`, { method: "GET" });
    return res?.data || null;
  } catch (err) {
    if (silent) {
      // Si fetchJSON redirige en 401, no podemos evitarlo aquí.
      // Si fetchJSON lanza error en 401, aquí devolvemos null.
      const msg = String(err?.message || "");
      if (msg.toLowerCase().includes("401") || msg.toLowerCase().includes("no autorizado")) {
        return null;
      }
      return null;
    }
    throw err;
  }
}

// 5.4 Cambiar contraseña
export async function changePassword({ oldPassword, newPassword } = {}) {
  const payload = assertObj({ oldPassword, newPassword }, "Payload inválido");
  if (!String(payload.oldPassword || "").trim()) throw new Error("oldPassword es obligatorio");

  const np = String(payload.newPassword || "");
  if (np.trim().length < 6) throw new Error("newPassword debe tener al menos 6 caracteres");

  return fetchJSON(`${BASE}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPassword: payload.oldPassword, newPassword: payload.newPassword }),
  });
}

// 6.1 Listar usuarios (Admin)
export async function listUsers({ limit, offset, q } = {}) {
  const query = qs({ limit, offset, q });
  return fetchJSON(`${BASE}/users${query}`, { method: "GET" });
}

// 6.2 Crear usuario (Admin)
export async function createUser({ usuario, password, rol, estado } = {}) {
  const payload = assertObj({ usuario, password, rol, estado }, "Payload inválido");
  if (!String(payload.usuario || "").trim()) throw new Error("usuario es obligatorio");
  if (!String(payload.password || "").trim()) throw new Error("password es obligatorio");

  return fetchJSON(`${BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usuario: payload.usuario,
      password: payload.password,
      rol: payload.rol,
      estado: payload.estado,
    }),
  });
}

// Ejemplo:
// import { login, me, logout } from "../../api/auth.api.js";
// const user = await login({ usuario:"admin", password:"admin123" });
// const current = await me({ silent:true });
// await logout();

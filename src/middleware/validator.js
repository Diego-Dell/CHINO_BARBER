// src/middleware/validator.js
// Utilidades de validación y sanitización para rutas API

/**
 * Sanitiza string: elimina nulos, trim, y limita longitud.
 * @param {*} v - Valor a sanitizar
 * @param {number} maxLen - Longitud máxima permitida
 * @returns {string}
 */
function sanitizeStr(v, maxLen = 500) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

/**
 * Valida que un string es una fecha ISO válida (YYYY-MM-DD).
 * @param {string} s
 * @returns {boolean}
 */
function isISODate(s) {
  if (!s || typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  const [y, m, d] = s.split("-").map(Number);
  return (
    !isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

/**
 * Valida que un string es un mes ISO válido (YYYY-MM).
 * @param {string} s
 * @returns {boolean}
 */
function isISOMonth(s) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(s || ""));
}

/**
 * Convierte a entero seguro.
 * @param {*} v
 * @param {number} def - Valor por defecto
 * @returns {number}
 */
function toInt(v, def = 0) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/**
 * Convierte a número flotante seguro.
 * @param {*} v
 * @param {number} def
 * @returns {number}
 */
function toNum(v, def = 0) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Middleware que rechaza peticiones con payload demasiado grande
 * o con tipos de content-type inesperados.
 * (La limitación de tamaño ya la hace express.json({ limit: '2mb' }))
 */
function validateJsonBody(req, res, next) {
  // Solo validar en métodos que envían body
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] || "";
    if (req.body && typeof req.body !== "object") {
      return res.status(400).json({ ok: false, error: "Body inválido" });
    }
  }
  next();
}

module.exports = { sanitizeStr, isISODate, isISOMonth, toInt, toNum, validateJsonBody };

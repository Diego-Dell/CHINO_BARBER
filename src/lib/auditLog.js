const db = require("../db");

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * @param {string} accion
 * @param {string|null} detalle
 * @param {"admin"|"sistema"} actor
 */
async function writeLog(accion, detalle, actor = "admin") {
  const a = String(accion || "").trim();
  if (!a) return;
  const usuario = actor === "sistema" ? "sistema" : "admin";
  try {
    await dbRun(
      `INSERT INTO logs (accion, detalle, actor, usuario) VALUES (?, ?, ?, ?)`,
      [a, detalle != null ? String(detalle) : null, usuario, usuario]
    );
  } catch (e) {
    console.error("[auditLog]", e.message);
  }
}

/**
 * Auditoría rica (before/after) sin cambiar esquema: se guarda en `logs.detalle` como JSON.
 * @param {object} evt
 * @param {string} evt.accion
 * @param {string} evt.entidad
 * @param {number|string} evt.entidad_id
 * @param {any} [evt.before]
 * @param {any} [evt.after]
 * @param {any} [evt.extra]
 * @param {"admin"|"sistema"} [evt.actor]
 */
async function writeAudit(evt = {}) {
  const accion = String(evt.accion || "").trim();
  if (!accion) return;
  const actor = evt.actor === "sistema" ? "sistema" : "admin";
  const payload = {
    actor,
    accion,
    entidad: evt.entidad || null,
    entidad_id: evt.entidad_id ?? null,
    before: evt.before ?? null,
    after: evt.after ?? null,
    extra: evt.extra ?? null,
  };
  return writeLog(accion, JSON.stringify(payload), actor);
}

module.exports = { writeLog, writeAudit };

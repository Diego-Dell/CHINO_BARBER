// src/db.js
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

// ✅ ahora config vive en /services/config.js (root)
const config = require("../services/config");

const db = new sqlite3.Database(config.DB_PATH, (err) => {
  if (err) console.error("[DB] open error:", err.message);
  else console.log("[DB] OK:", config.DB_PATH);

  try { db.configure("busyTimeout", 5000); } catch (_) {}
  try { db.run("PRAGMA busy_timeout = 5000;"); } catch (_) {}
});

db.serialize(() => {
  try { db.run("PRAGMA foreign_keys = ON;"); } catch (_) {}
  try { db.run("PRAGMA journal_mode = WAL;"); } catch (_) {}
  try { db.run("PRAGMA synchronous = NORMAL;"); } catch (_) {}
});

// ✅ schema.sql: buscar en varios lugares (packaged + dev)
function findSchemaPath() {
  const cands = [];

  // si quieres forzar desde env
  if (process.env.SCHEMA_PATH) cands.push(process.env.SCHEMA_PATH);

  // ✅ primero el schema del proyecto (el correcto)
  cands.push(path.join(config.ROOT_DIR, "db", "schema.sql"));

  // fallback relativo (desde src/)
  cands.push(path.join(__dirname, "..", "db", "schema.sql"));

  // por si lo copias a DB_DIR (AppData, etc.) → AL FINAL por si hay uno viejo
  cands.push(path.join(config.DB_DIR, "schema.sql"));

  for (const p of cands) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

try {
  const schemaPath = findSchemaPath();
  if (schemaPath) {
    const schema = fs.readFileSync(schemaPath, "utf8");
    function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function fixPagosFecha() {
  try {
    // borra índice viejo (si existiera)
    await dbRun(`DROP INDEX IF EXISTS ix_pagos_fecha;`);

    const cols = await dbAll(`PRAGMA table_info(pagos);`);
    const names = new Set(cols.map(c => String(c.name || "").toLowerCase()));

    // si DB vieja: fecha -> fecha_pago
    if (names.has("fecha") && !names.has("fecha_pago")) {
      await dbRun(`ALTER TABLE pagos RENAME COLUMN fecha TO fecha_pago;`);
    }

    // crea índice correcto si existe fecha_pago
    const cols2 = await dbAll(`PRAGMA table_info(pagos);`);
    const names2 = new Set(cols2.map(c => String(c.name || "").toLowerCase()));

    if (names2.has("fecha_pago")) {
      await dbRun(`CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON pagos(fecha_pago);`);
    }

    console.log("[DB] fixPagosFecha OK");
  } catch (e) {
    console.warn("[DB] fixPagosFecha warn:", e.message);
  }
}

    db.exec(schema, (err) => {
      if (err) console.error("[DB] schema error:", err.message);
      else console.log("[DB] schema aplicado/ok:", schemaPath);
    });
  } else {
    console.warn("[DB] schema.sql no encontrado (busqué en ROOT/db, fallback y DB_DIR)");
  }
} catch (e) {
  console.error("[DB] schema init error:", e.message);
}

module.exports = db;

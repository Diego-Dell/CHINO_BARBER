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

  // por si lo copias a DB_DIR
  cands.push(path.join(config.DB_DIR, "schema.sql"));

  // packaged: <root>/db/schema.sql (dentro del asar)
  cands.push(path.join(config.ROOT_DIR, "db", "schema.sql"));

  // fallback relativo (desde src/)
  cands.push(path.join(__dirname, "..", "db", "schema.sql"));

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
    db.exec(schema, (err) => {
      if (err) console.error("[DB] schema error:", err.message);
      else console.log("[DB] schema aplicado/ok");
    });
  } else {
    console.warn("[DB] schema.sql no encontrado (busqué en DB_DIR y en /db/schema.sql)");
  }
} catch (e) {
  console.error("[DB] schema init error:", e.message);
}

module.exports = db;

// src/db.js (estable / simple)
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const config = require("../services/config");

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

// asegurar carpeta DB
ensureDir(path.dirname(config.DB_PATH));

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

// schema.sql: el del proyecto
function findSchemaPath() {
  const cands = [];

  if (process.env.SCHEMA_PATH) cands.push(process.env.SCHEMA_PATH);

  // el principal
  cands.push(path.join(config.ROOT_DIR, "db", "schema.sql"));

  // fallback relativo
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
  if (!schemaPath) {
    console.warn("[DB] schema.sql no encontrado");
  } else {
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema, (err) => {
      if (err) console.error("[DB] schema error:", err.message);
      else console.log("[DB] schema aplicado/ok:", schemaPath);
    });
  }
} catch (e) {
  console.error("[DB] schema init error:", e.message);
}

module.exports = db;

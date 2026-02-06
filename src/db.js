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


// ==== MIGRACIONES (compatibilidad con DBs viejas) ====
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

async function ensureColumn(table, colName, colType) {
  const cols = await dbAll(`PRAGMA table_info(${table});`);
  const names = new Set(cols.map(c => String(c.name || "").toLowerCase()));
  if (!names.has(colName.toLowerCase())) {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType};`);
    console.log(`[DB] Migración: agregado ${table}.${colName}`);
  }
}

async function runMigrations() {
  try {
    // cursos: estas columnas son las que te están fallando en queries nuevas
    await ensureColumn("cursos", "fecha_inicio", "TEXT");
    await ensureColumn("cursos", "fecha_fin", "TEXT");

    // pagos: compatibilidad (DBs viejas usaban "fecha")
    // - si existe pagos.fecha pero no pagos.fecha_pago: crear fecha_pago y copiar
    try {
      const cols = await dbAll(`PRAGMA table_info(pagos);`);
      const names = new Set(cols.map(c => String(c.name || "").toLowerCase()));
      if (!names.has("fecha_pago")) {
        await dbRun(`ALTER TABLE pagos ADD COLUMN fecha_pago TEXT;`);
        console.log("[DB] Migración: agregado pagos.fecha_pago");
      }
      if (names.has("fecha") && names.has("fecha_pago")) {
        await dbRun(`UPDATE pagos SET fecha_pago = fecha WHERE (fecha_pago IS NULL OR fecha_pago = "") AND (fecha IS NOT NULL AND fecha <> "")`);
      }
    } catch (e) {
      console.warn("[DB] Migración pagos warn:", e.message);
    }
  } catch (e) {
    console.warn("[DB] Migraciones warn:", e.message);
  }
}

// Ejecutar migraciones
runMigrations();


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
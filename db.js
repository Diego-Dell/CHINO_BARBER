// db.js (raíz del proyecto)
// Punto único de conexión a SQLite para todo el sistema (routes + services).
// CommonJS, compatible Windows/Linux. Usa services/config.js para DB_PATH.

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const config = require("./services/config");

const DB_PATH = config && config.DB_PATH ? String(config.DB_PATH) : path.resolve("./db/database.sqlite");

// Asegurar carpeta contenedora
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (_) {}

// Abrir DB
const db = new sqlite3.Database(DB_PATH);

// ===============================
// Helpers promisificados (OBLIGATORIOS)
// ===============================
function _normalizeParams(params) {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}

function _decorateError(err, sql) {
  if (!err) return err;
  const e = new Error(`${err.message} | SQL: ${String(sql).slice(0, 500)}`);
  e.code = err.code;
  return e;
}

function run(sql, params = []) {
  const p = _normalizeParams(params);
  return new Promise((resolve, reject) => {
    db.run(sql, p, function (err) {
      if (err) return reject(_decorateError(err, sql));
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  const p = _normalizeParams(params);
  return new Promise((resolve, reject) => {
    db.get(sql, p, (err, row) => {
      if (err) return reject(_decorateError(err, sql));
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  const p = _normalizeParams(params);
  return new Promise((resolve, reject) => {
    db.all(sql, p, (err, rows) => {
      if (err) return reject(_decorateError(err, sql));
      resolve(rows || []);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(_decorateError(err, sql));
      resolve(true);
    });
  });
}

// Helper extra recomendado: transacciones
async function transaction(fn) {
  if (typeof fn !== "function") throw new Error("transaction(fn): fn must be a function");
  await exec("BEGIN");
  try {
    const result = await fn({ run, get, all, exec, db, DB_PATH });
    await exec("COMMIT");
    return result;
  } catch (e) {
    try {
      await exec("ROLLBACK");
    } catch (_) {}
    throw e;
  }
}

// ===============================
// PRAGMAs recomendados + init mínimo
// ===============================
db.serialize(() => {
  // PRAGMA foreign keys
  db.run("PRAGMA foreign_keys = ON;");

  // Evitar locks frecuentes
  db.run("PRAGMA busy_timeout = 5000;");

  // Mejor performance en la mayoría de casos
  db.run("PRAGMA synchronous = NORMAL;");

  // temp_store en memoria (opcional)
  db.run("PRAGMA temp_store = MEMORY;");

  // WAL (si falla, ignorar sin tumbar)
  db.run("PRAGMA journal_mode = WAL;", (err) => {
    if (err) {
      // No crashear: algunos FS/entornos no soportan WAL bien
      // console.warn("[DB] WAL not enabled:", err.message);
    }
  });

  // Init mínimo: tabla usuarios (para auth) — sin seed por defecto
  db.run(
    `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      rol TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activo',
      created_at TEXT
    )
    `,
    (err) => {
      if (err) {
        // No crashear, pero deja error visible si alguien mira logs
        // console.error("[DB] Failed to ensure usuarios table:", err.message);
      }
    }
  );

  // Seed opcional (desactivado por defecto)
  // Si quieres, pon SEED_ADMIN=true y asegúrate que auth.routes maneje bcrypt.
  // Aquí NO insertamos admin por seguridad/consistencia con tu auth.routes.js.
});

// ===============================
// Compatibilidad de importación
// Forma A: const { db, run, get, all, exec } = require("../db");
// Forma B: const db = require("../db"); // y db.run/db.get/db.all disponibles
// ===============================
const exported = { db, run, get, all, exec, transaction, DB_PATH };

// Adjuntar helpers al objeto exportado y al db para compatibilidad
exported.run = run;
exported.get = get;
exported.all = all;
exported.exec = exec;
exported.transaction = transaction;

db.runP = run;
db.getP = get;
db.allP = all;
db.execP = exec;
db.transaction = transaction;
db.DB_PATH = DB_PATH;

module.exports = exported;

/*
Uso desde routes:
  const { all } = require("../db");
  const rows = await all("SELECT * FROM alumnos WHERE estado=?", ["Activo"]);

También compatible:
  const database = require("../db");
  const rows = await database.all("SELECT * FROM cursos");
*/

// src/db.js
// ✅ ÚNICA conexión SQLite para TODO el backend (routes + server)
// - Usa el mismo DB_PATH que config
// - Exporta sqlite3.Database() (lo que esperan tus rutas)

const sqlite3 = require("sqlite3").verbose();
const config = require("./services/config");
const fs = require("fs");
const path = require("path");

const db = new sqlite3.Database(config.DB_PATH, (err) => {
  if (err) {
    console.error("[DB] open error:", err.message);
  } else {
    console.log("[DB] OK:", config.DB_PATH);
  }

  // evita SQLITE_BUSY cuando la DB está siendo usada por otra conexión
try { db.configure("busyTimeout", 5000); } catch (_) {}
try { db.run("PRAGMA busy_timeout = 5000;"); } catch (_) {}

});

// PRAGMAs recomendados (no rompen si fallan)
db.serialize(() => {
  try { db.run("PRAGMA foreign_keys = ON;"); } catch (_) {}
  try { db.run("PRAGMA journal_mode = WAL;"); } catch (_) {}
  try { db.run("PRAGMA synchronous = NORMAL;"); } catch (_) {}
});

// ✅ Aplicar schema automáticamente (CREATE TABLE IF NOT EXISTS ...)
// Esto evita 500s por "no such table" cuando arrancas por primera vez.
try {
  const schemaPath = path.join(config.DB_DIR, "schema.sql");
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema, (err) => {
      if (err) console.error("[DB] schema error:", err.message);
      else console.log("[DB] schema aplicado/ok");
    });
  } else {
    console.warn("[DB] schema.sql no encontrado en:", schemaPath);
  }
} catch (e) {
  console.error("[DB] schema init error:", e.message);
}

module.exports = db;

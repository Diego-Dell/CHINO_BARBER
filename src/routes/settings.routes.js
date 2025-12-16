// src/routes/settings.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta ruta según tu estructura
// ===============================
function authRequired(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  if (req.session.user.rol !== "Admin") {
    return res.status(403).json({ ok: false, error: "Solo Admin" });
  }
  next();
}

// ✅ Todas las rutas requieren sesión y rol Admin (settings sensible)
router.use(authRequired);
router.use(adminOnly);

// ===============================
// Helpers SQLite promisificados
// ===============================
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// ===============================
// Ensure table exists (CREATE TABLE IF NOT EXISTS)
// ===============================
let _settingsInitPromise = null;

async function ensureSettingsTable() {
  if (_settingsInitPromise) return _settingsInitPromise;

  _settingsInitPromise = (async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT UNIQUE NOT NULL,
        valor TEXT,
        descripcion TEXT
      )
    `);

    // Seed opcional (no obligatorio). Lo dejamos vacío para no "inventar" settings.
    // Si quieres defaults, créalos desde el panel admin llamando POST /api/settings.

    return true;
  })();

  return _settingsInitPromise;
}

// ===============================
// 6) GET /api/settings/public
// Nota: como TODAS las rutas de settings requieren adminOnly por tu requisito,
// este endpoint también queda protegido.
// Si en tu frontend quieres consumirlo SIN Admin, entonces mueve este endpoint
// a otro router público o quita adminOnly solo aquí.
// ===============================
router.get("/public", async (req, res) => {
  try {
    await ensureSettingsTable();

    // Whitelist de claves públicas
    const PUBLIC_KEYS = ["nombre_academia", "moneda", "metodos_pago"];

    const placeholders = PUBLIC_KEYS.map(() => "?").join(",");
    const rows = await dbAll(
      `
      SELECT clave, valor, descripcion
      FROM settings
      WHERE clave IN (${placeholders})
      ORDER BY clave ASC
      `,
      PUBLIC_KEYS
    );

    // Devolver también las claves faltantes como null (para que el frontend no falle)
    const map = {};
    for (const k of PUBLIC_KEYS) map[k] = { clave: k, valor: null, descripcion: null };
    for (const r of rows) map[r.clave] = r;

    return res.json({ ok: true, data: PUBLIC_KEYS.map((k) => map[k]) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener settings públicos" });
  }
});

// ===============================
// 1) GET /api/settings
// Devuelve todas las configuraciones
// ===============================
router.get("/", async (req, res) => {
  try {
    await ensureSettingsTable();

    const rows = await dbAll(
      `
      SELECT clave, valor, descripcion
      FROM settings
      ORDER BY clave ASC
      `
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar settings" });
  }
});

// ===============================
// 2) GET /api/settings/:clave
// ===============================
router.get("/:clave", async (req, res) => {
  try {
    await ensureSettingsTable();

    const clave = normStr(req.params.clave);
    if (!clave) return res.status(400).json({ ok: false, error: "clave inválida" });

    const row = await dbGet(
      `
      SELECT clave, valor, descripcion
      FROM settings
      WHERE clave = ?
      `,
      [clave]
    );

    if (!row) return res.status(404).json({ ok: false, error: "Configuración no encontrada" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener setting" });
  }
});

// ===============================
// 3) POST /api/settings (UPSERT por clave)
// Crea o actualiza configuración
// ===============================
router.post("/", async (req, res) => {
  try {
    await ensureSettingsTable();

    const clave = normStr(req.body?.clave);
    const valor = req.body?.valor !== undefined ? String(req.body.valor) : null;
    const descripcion = req.body?.descripcion !== undefined ? String(req.body.descripcion) : null;

    if (!clave) return res.status(400).json({ ok: false, error: "clave es obligatoria" });

    const exists = await dbGet(`SELECT id FROM settings WHERE clave = ?`, [clave]);

    if (exists) {
      await dbRun(
        `
        UPDATE settings
        SET valor = ?, descripcion = ?
        WHERE clave = ?
        `,
        [valor, descripcion, clave]
      );
    } else {
      await dbRun(
        `
        INSERT INTO settings (clave, valor, descripcion)
        VALUES (?, ?, ?)
        `,
        [clave, valor, descripcion]
      );
    }

    const row = await dbGet(
      `SELECT clave, valor, descripcion FROM settings WHERE clave = ?`,
      [clave]
    );

    return res.status(exists ? 200 : 201).json({ ok: true, data: row });
  } catch (err) {
    // UNIQUE conflict
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ ok: false, error: "clave duplicada (UNIQUE)" });
    }
    return res.status(500).json({ ok: false, error: "Error al guardar setting" });
  }
});

// ===============================
// 4) PUT /api/settings/:clave
// Actualiza solo valor y descripción
// ===============================
router.put("/:clave", async (req, res) => {
  try {
    await ensureSettingsTable();

    const clave = normStr(req.params.clave);
    if (!clave) return res.status(400).json({ ok: false, error: "clave inválida" });

    const valor = req.body?.valor !== undefined ? String(req.body.valor) : null;
    const descripcion = req.body?.descripcion !== undefined ? String(req.body.descripcion) : null;

    const exists = await dbGet(`SELECT id FROM settings WHERE clave = ?`, [clave]);
    if (!exists) return res.status(404).json({ ok: false, error: "Configuración no encontrada" });

    await dbRun(
      `
      UPDATE settings
      SET valor = ?, descripcion = ?
      WHERE clave = ?
      `,
      [valor, descripcion, clave]
    );

    const row = await dbGet(
      `SELECT clave, valor, descripcion FROM settings WHERE clave = ?`,
      [clave]
    );

    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar setting" });
  }
});

// ===============================
// 5) DELETE /api/settings/:clave
// Elimina configuración (uso excepcional)
// ===============================
router.delete("/:clave", async (req, res) => {
  try {
    await ensureSettingsTable();

    const clave = normStr(req.params.clave);
    if (!clave) return res.status(400).json({ ok: false, error: "clave inválida" });

    const exists = await dbGet(`SELECT id FROM settings WHERE clave = ?`, [clave]);
    if (!exists) return res.status(404).json({ ok: false, error: "Configuración no encontrada" });

    await dbRun(`DELETE FROM settings WHERE clave = ?`, [clave]);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al eliminar setting" });
  }
});

module.exports = router;

/*
settings.routes.js centraliza la configuración global del sistema (tabla settings) y evita hardcodear valores.

Cómo otros módulos lo consumen:
- pagos: moneda y metodos_pago (para mostrar/validar en UI y reportes).
- reportes: nombre_academia (encabezados/branding de reportes).
- dashboard: datos generales (moneda, nombre academia, etc.).

Qué endpoints usa el frontend:
- Carga inicial (settings públicos): GET /api/settings/public
- Administración (panel Admin): GET /api/settings, POST /api/settings, PUT /api/settings/:clave, DELETE /api/settings/:clave

Seguridad:
- Todas las rutas requieren sesión (authRequired) y rol Admin (adminOnly) porque settings es configuración sensible.
- Este módulo crea la tabla settings si no existe y permite UPSERT por clave (POST).
*/

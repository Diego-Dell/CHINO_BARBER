// src/routes/auth.routes.js
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db"); // module.exports = sqlite3.Database()
const router = express.Router();

/* =====================================
   Helpers SQLite promisificados
===================================== */
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

/* =====================================
   Middlewares reutilizables
===================================== */
function authRequired(req, res, next) {
  return next();
}

function adminOnly(req, res, next) {
  return next();
}

/* =====================================
   Bootstrap DB: tabla + admin/caja por defecto
   (se ejecuta 1 vez)
===================================== */
let _bootstrapped = false;

async function bootstrapAuth() {
  if (_bootstrapped) return;
  _bootstrapped = true;

  await dbRun(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('Admin','Caja')),
      estado TEXT NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo','Inactivo')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Admin por defecto si no hay ninguno
  const adminExists = await dbGet(`SELECT id FROM usuarios WHERE rol = 'Admin' LIMIT 1`);
  if (!adminExists) {
    const pass_hash = await bcrypt.hash("admin123", 10);
    try {
      await dbRun(
        `INSERT INTO usuarios (usuario, pass_hash, rol, estado) VALUES (?,?,?,?)`,
        ["admin", pass_hash, "Admin", "Activo"]
      );
    } catch (_) {}
  }

  // Caja por defecto (opcional)
  const cajaExists = await dbGet(`SELECT id FROM usuarios WHERE rol = 'Caja' LIMIT 1`);
  if (!cajaExists) {
    const pass_hash = await bcrypt.hash("caja123", 10);
    try {
      await dbRun(
        `INSERT INTO usuarios (usuario, pass_hash, rol, estado) VALUES (?,?,?,?)`,
        ["caja", pass_hash, "Caja", "Activo"]
      );
    } catch (_) {}
  }
}

// Garantiza bootstrap antes de cualquier endpoint del router
router.use(async (req, res, next) => {
  try {
    await bootstrapAuth();
    next();
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error inicializando autenticación" });
  }
});

/* =====================================
   ENDPOINTS
   OJO: SIN /api aquí dentro.
   Se acceden como:
   - POST /api/auth/login
   - GET  /api/auth/me
   - POST /api/auth/logout
===================================== */

// 1) POST /auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const usuario = String(req.body?.usuario || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!usuario || !password) {
      return res.status(400).json({ ok: false, error: "usuario y password son obligatorios" });
    }

    const row = await dbGet(
      `SELECT id, usuario, pass_hash, rol, estado
       FROM usuarios
       WHERE usuario = ? AND estado = 'Activo'`,
      [usuario]
    );

    if (!row) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    const ok = await bcrypt.compare(password, row.pass_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    const userPayload = { id: row.id, usuario: row.usuario, rol: row.rol };

    // Regenerar sesión (mitiga fixation)
    if (req.session && typeof req.session.regenerate === "function") {
      return req.session.regenerate((err) => {
        if (err) return res.status(500).json({ ok: false, error: "No se pudo crear la sesión" });
        req.session.user = userPayload;
        return res.json({ ok: true, data: userPayload });
      });
    }

    // fallback
    req.session.user = userPayload;
    return res.json({ ok: true, data: userPayload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error en login" });
  }
});

// 2) POST /auth/logout
router.post("/auth/logout", (req, res) => {
  try {
    if (!req.session) return res.json({ ok: true });

    req.session.destroy((err) => {
      if (err) return res.status(500).json({ ok: false, error: "No se pudo cerrar sesión" });

      // Limpia cookie típica; si tu cookie tiene otro nombre, igual funciona
      res.clearCookie("connect.sid");
      res.clearCookie("CHINO_BARBER_SESSION");

      return res.json({ ok: true });
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error en logout" });
  }
});

// 3) GET /auth/me
router.get("/auth/me", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  return res.json({ ok: true, data: req.session.user });
});

// 4) POST /auth/change-password
router.post("/auth/change-password", authRequired, async (req, res) => {
  try {
    const oldPassword = String(req.body?.oldPassword || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "oldPassword y newPassword son obligatorios" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: "newPassword debe tener mínimo 6 caracteres" });
    }

    const userId = req.session.user.id;

    const row = await dbGet(
      `SELECT id, pass_hash, estado
       FROM usuarios
       WHERE id = ?`,
      [userId]
    );

    if (!row || row.estado !== "Activo") {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }

    const ok = await bcrypt.compare(oldPassword, row.pass_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "oldPassword incorrecto" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await dbRun(`UPDATE usuarios SET pass_hash = ? WHERE id = ?`, [newHash, userId]);

    return res.json({ ok: true, data: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al cambiar contraseña" });
  }
});

// 5) GET /auth/users (solo Admin)
router.get("/auth/users", adminOnly, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, usuario, rol, estado, created_at
       FROM usuarios
       ORDER BY id DESC`
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar usuarios" });
  }
});

// 6) POST /auth/users (solo Admin)
router.post("/auth/users", adminOnly, async (req, res) => {
  try {
    const usuario = String(req.body?.usuario || "").trim();
    const password = String(req.body?.password || "").trim();
    const rol = String(req.body?.rol || "").trim();
    const estado = String(req.body?.estado || "Activo").trim();

    if (!usuario || !password || !rol) {
      return res.status(400).json({ ok: false, error: "usuario, password y rol son obligatorios" });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: "password debe tener mínimo 6 caracteres" });
    }
    if (rol !== "Admin" && rol !== "Caja") {
      return res.status(400).json({ ok: false, error: "rol inválido. Usa Admin|Caja" });
    }
    if (estado !== "Activo" && estado !== "Inactivo") {
      return res.status(400).json({ ok: false, error: "estado inválido. Usa Activo|Inactivo" });
    }

    const exists = await dbGet(`SELECT id FROM usuarios WHERE usuario = ?`, [usuario]);
    if (exists) {
      return res.status(409).json({ ok: false, error: "El usuario ya existe" });
    }

    const pass_hash = await bcrypt.hash(password, 10);
    const r = await dbRun(
      `INSERT INTO usuarios (usuario, pass_hash, rol, estado) VALUES (?,?,?,?)`,
      [usuario, pass_hash, rol, estado]
    );

    const created = await dbGet(
      `SELECT id, usuario, rol, estado, created_at
       FROM usuarios
       WHERE id = ?`,
      [r.lastID]
    );

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear usuario" });
  }
});

/* =====================================
   Export
===================================== */
module.exports = {
  router,
  authRequired,
  adminOnly,
};

// src/routes/auth.routes.js
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db"); // module.exports = db (sqlite3.Database)
const router = express.Router();

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

// ===============================
// Middlewares reutilizables
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

// ===============================
// Bootstrap DB: crear tabla + admin por defecto
// ===============================
let _bootstrapped = false;

async function bootstrapAuth() {
  if (_bootstrapped) return;
  _bootstrapped = true;

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('Admin','Caja')),
      estado TEXT NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo','Inactivo')),
      created_at TEXT DEFAULT (datetime('now'))
    )
    `
  );

  // Si no existe ningún Admin, crear admin por defecto
  const adminExists = await dbGet(
    `SELECT id FROM usuarios WHERE rol = 'Admin' LIMIT 1`
  );

  if (!adminExists) {
    const pass_hash = await bcrypt.hash("admin123", 10);
    try {
      await dbRun(
        `INSERT INTO usuarios (usuario, pass_hash, rol, estado) VALUES (?,?,?,?)`,
        ["admin", pass_hash, "Admin", "Activo"]
      );
    } catch (e) {
      // Si por carrera ya se creó, ignorar
      // (por ejemplo, UNIQUE usuario)
    }
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

// ===============================
// 1) POST /api/auth/login
// ===============================
router.post("/api/auth/login", async (req, res) => {
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

    // Regenerar sesión (mitiga session fixation)
    const userPayload = { id: row.id, usuario: row.usuario, rol: row.rol };

    // Si tu express-session soporta regenerate (sí), úsalo:
    if (req.session && typeof req.session.regenerate === "function") {
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ ok: false, error: "No se pudo crear la sesión" });
        req.session.user = userPayload;
        return res.json({ ok: true, data: userPayload });
      });
      return;
    }

    // Fallback
    req.session.user = userPayload;
    return res.json({ ok: true, data: userPayload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error en login" });
  }
});

// ===============================
// 2) POST /api/auth/logout
// ===============================
router.post("/api/auth/logout", (req, res) => {
  try {
    if (!req.session) return res.json({ ok: true });

    const cookieName =
      (req.session && req.session.cookie && req.session.cookie.name) || null;

    req.session.destroy((err) => {
      if (err) return res.status(500).json({ ok: false, error: "No se pudo cerrar sesión" });

      // Limpia cookie (si conoces el nombre exacto, mejor. Caso típico: connect.sid)
      // Usamos ambos por compatibilidad:
      res.clearCookie("connect.sid");
      if (cookieName) res.clearCookie(cookieName);

      return res.json({ ok: true });
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error en logout" });
  }
});

// ===============================
// 3) GET /api/auth/me
// ===============================
router.get("/api/auth/me", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  return res.json({ ok: true, data: req.session.user });
});

// ===============================
// 4) POST /api/auth/change-password
// (Admin o el usuario logueado)
// ===============================
router.post("/api/auth/change-password", authRequired, async (req, res) => {
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

// ===============================
// 5) GET /api/auth/users (solo Admin) - sin pass_hash
// ===============================
router.get("/api/auth/users", adminOnly, async (req, res) => {
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

// ===============================
// 6) POST /api/auth/users (solo Admin) - crear usuario
// ===============================
router.post("/api/auth/users", adminOnly, async (req, res) => {
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

// ===============================
// Export
// Permite importar middlewares así:
// const auth = require("./auth.routes");
// const { authRequired, adminOnly } = auth;
// app.use(auth.router);  // o router.use("/auth", auth.router) según tu estructura
// ===============================
module.exports = {
  router,
  authRequired,
  adminOnly,
};

/*
Conexión correcta con el resto del sistema:
- Este módulo crea y maneja la sesión guardando: req.session.user = { id, usuario, rol }.
- Por eso el resto de rutas deben protegerse usando los middlewares exportados:
  const { authRequired, adminOnly } = require("./auth.routes");

Cómo montarlo:
- Si tienes un routes.js agregador, ejemplo:
  const auth = require("./auth.routes");
  app.use(auth.router);
  // (o si quieres prefijo /auth, entonces NO uses /api/auth dentro de este archivo. En este archivo ya está /api/auth/*)

Qué espera el frontend:
- Login:   POST /api/auth/login
- Sesión:  GET  /api/auth/me
- Logout:  POST /api/auth/logout

Estados/roles:
- roles: Admin | Caja
- estado usuario: Activo | Inactivo
*/

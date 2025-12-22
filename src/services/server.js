// services/server.js
// Servidor principal (Express + SQLite). CommonJS, sin TS, sin libs extra.
// ✅ SIN LOGIN / SIN SESIONES: no hay apiAuthGuard ni middleware de session.

const express = require("express");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const backup = require("./backup"); // queda disponible para usar desde routes/admin si lo necesitas

// ✅ Usar la MISMA conexión de DB que usan las rutas
const db = require("../db");

// ==============================
// Helpers mínimos
// ==============================
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (_) {}
}

function existsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function safeSendFile(res, filePath) {
  if (existsFile(filePath)) return res.sendFile(filePath);
  return res.status(404).send("File not found");
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

// ==============================
// DB SQLite (init ligero)
// ✅ SIN LOGIN: no creamos tabla usuarios aquí.

// ==============================
// App + middlewares base
// ==============================
const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ==============================
// Frontend estático
// ==============================
ensureDir(config.PUBLIC_DIR);
app.use(express.static(config.PUBLIC_DIR));

// Raíz: sirve login.html si existe, si no index.html, si no 404
app.get("/", (req, res) => {
  const indexPath = path.join(config.PUBLIC_DIR, "index.html");
  if (existsFile(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("No public entry file (index.html) found");
});

// ==============================
// Health
// ==============================
app.get("/health", async (req, res) => {
  try {
    let dbOk = false;
    try {
      const r = await dbGet(db, "SELECT 1 AS ok");
      dbOk = !!(r && r.ok === 1);
    } catch (_) {
      dbOk = false;
    }

    return res.json({
      ok: true,
      db: dbOk,
      uptime: process.uptime(),
      env: config.NODE_ENV || "development",
    });
  } catch (_) {
    return res.json({ ok: true, db: false, uptime: process.uptime() });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    let dbOk = false;
    try {
      const r = await dbGet(db, "SELECT 1 AS ok");
      dbOk = !!(r && r.ok === 1);
    } catch (_) {
      dbOk = false;
    }

    return res.json({ ok: true, db: dbOk, uptime: process.uptime() });
  } catch (_) {
    return res.json({ ok: true, db: false, uptime: process.uptime() });
  }
});

// ==============================
// Montaje de rutas
// - Preferir router central routes.js si existe
// - Si no, montar módulos sueltos /api/<modulo>
// ==============================
function tryRequire(p) {
  try {
    return require(p);
  } catch (_) {
    return null;
  }
}

function mountRoutes() {
  // Preferido: router central
  const candidates = [
    path.join(__dirname, "..", "src", "routes", "routes.js"),
    path.join(__dirname, "..", "routes", "routes.js"),
    path.join(__dirname, "..", "src", "routes", "routes"),
    path.join(__dirname, "..", "routes", "routes"),
  ];

  for (const c of candidates) {
    const mod = tryRequire(c);
    if (mod) {
      app.use("/api", mod);
      console.log("[ROUTES] Mounted router:", c);
      return true;
    }
  }

  // Fallback: montar uno por uno
  const baseCandidates = [
    path.join(__dirname, "..", "src", "routes"),
    path.join(__dirname, "..", "routes"),
  ];

  let base = null;
  for (const b of baseCandidates) {
    try {
      if (fs.existsSync(b) && fs.statSync(b).isDirectory()) {
        base = b;
        break;
      }
    } catch (_) {}
  }

  if (!base) {
    console.warn("[ROUTES] No routes directory found. Skipping /api mounts.");
    return false;
  }

  const routeFiles = [
    ["auth", "auth.routes.js"],
    ["alumnos", "alumnos.routes.js"],
    ["instructores", "instructores.routes.js"],
    ["cursos", "cursos.routes.js"],
    ["inscripciones", "inscripciones.routes.js"],
    ["asistencia", "asistencia.routes.js"],
    ["pagos", "pagos.routes.js"],
    ["egresos", "egresos.routes.js"],
    ["inventario", "inventario.routes.js"],
    ["agenda", "agenda.routes.js"],
    ["reportes", "reportes.routes.js"],
    ["settings", "settings.routes.js"],
  ];

  let mounted = 0;
  for (const [mount, file] of routeFiles) {
    const full = path.join(base, file);
    const mod = tryRequire(full);
    if (mod) {
      app.use(`/api/${mount}`, mod);
      mounted++;
    } else {
      if (config.DEBUG) console.warn("[ROUTES] Missing:", full);
    }
  }

  console.log(`[ROUTES] Mounted ${mounted} route modules from: ${base}`);
  return mounted > 0;
}

mountRoutes();

// ==============================
// 404 API
// ==============================
app.use((req, res, next) => {
  if (req.path && req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  return next();
});

// ==============================
// Error handler global
// ==============================
app.use((err, req, res, next) => {
  const isApi = req.path && req.path.startsWith("/api/");
  const prod = String(config.NODE_ENV || "").toLowerCase() === "production";

  const msg = err && err.message ? err.message : "Server error";
  console.error("[ERROR]", msg);

  if (isApi) {
    return res
      .status(500)
      .json({ ok: false, error: prod ? "Internal server error" : msg });
  }
  return res.status(500).send(prod ? "Internal server error" : msg);
});

// ==============================
// Start
// ==============================
const port = Number(config.PORT) || 3000;
app.listen(port, () => {
  console.log(`[SERVER] Running on http://localhost:${port}`);
  console.log(`[SERVER] Public dir: ${config.PUBLIC_DIR}`);
  console.log(`[SERVER] DB: ${config.DB_PATH}`);
});

// Export app (para tests)
module.exports = app;

// services/server.js
// Servidor principal (Express + SQLite + Sessions). CommonJS, sin TS, sin libs extra.

const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const backup = require("./backup"); // listo para usar desde routes/administración

const sqlite3 = require("sqlite3").verbose();

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
// DB SQLite (CRÍTICO)
// ==============================
ensureDir(path.dirname(config.DB_PATH));

const db = new sqlite3.Database(config.DB_PATH, async (err) => {
  if (err) {
    // No crashear duro: log claro y seguir; health indicará db:false
    console.error("[DB] Error opening DB:", err.message);
    return;
  }
  try {
    await dbRun(db, "PRAGMA foreign_keys = ON;");
    // WAL recomendado (si falla en FS raro, no romper)
    try {
      await dbRun(db, "PRAGMA journal_mode = WAL;");
    } catch (_) {}
    try {
      await dbRun(db, "PRAGMA synchronous = NORMAL;");
    } catch (_) {}

    // Tabla mínima para auth (sin inventar fuera del esquema pedido)
    await dbRun(
      db,
      `
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        rol TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'Activo',
        created_at TEXT
      )
      `
    );
  } catch (e) {
    console.error("[DB] Init error:", e.message);
  }
});

// Exponer DB para rutas que hacen: require("../db")
try {
  // Crea/reescribe un export en runtime: solo si tu proyecto lo usa.
  // Si ya existe un ../db.js en el root, NO lo tocamos.
  // Tus routes anteriores esperan ../db desde src/routes/*.js
  // => deben existir src/db.js o db.js en raíz. Si no, esto ayuda.
} catch (_) {}

// ==============================
// App + middlewares base
// ==============================
const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ==============================
// Sesiones (CRÍTICO)
// ==============================
app.use(
  session({
    name: config.COOKIE_NAME,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: config.COOKIE_SAMESITE || "lax",
      secure: !!config.COOKIE_SECURE, // true solo prod (HTTPS)
      maxAge: (Number(config.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000,
    },
  })
);

// ==============================
// Frontend estático
// ==============================
ensureDir(config.PUBLIC_DIR);
// --- STATIC ---
app.use(express.static(config.PUBLIC_DIR));

// Raíz: sirve login.html si existe, si no index.html
app.get("/", (req, res) => {
  const login = path.join(config.PUBLIC_DIR, "login.html");
  const index = path.join(config.PUBLIC_DIR, "index.html");

  if (fs.existsSync(login)) return res.sendFile(login);
  if (fs.existsSync(index)) return res.sendFile(index);

  return res.status(404).send("File not found");
});


// ==============================
// Protección simple de páginas HTML (opcional pero útil)
// - Permite /login.html sin sesión
// - Protege otras páginas .html redirigiendo a /login.html
// ==============================
const PUBLIC_HTML = new Set(["/login.html"]);

app.use((req, res, next) => {
  const p = req.path || "";

  // Permitir assets, api y archivos no-html
  if (p.startsWith("/api/")) return next();
  if (!p.toLowerCase().endsWith(".html")) return next();
  if (PUBLIC_HTML.has(p)) return next();

  const hasSession = !!(req.session && req.session.user);
  if (!hasSession) return res.redirect("/login.html");
  return next();
});

// ==============================
// Health
// ==============================
app.get("/health", async (req, res) => {
  try {
    // db "alive" si responde a una consulta simple
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
  } catch (e) {
    return res.json({ ok: true, db: false, uptime: process.uptime() });
  }
});

app.get("/api/health", async (req, res) => {
  // Igual que /health (útil para frontend)
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
    });
  } catch (e) {
    return res.json({ ok: true, db: false, uptime: process.uptime() });
  }
});

// ==============================
// API Guard (401 si no hay sesión)
// - Se permite login/logout/me (auth) sin sesión según endpoint.
// - Lo normal: el frontend maneja 401 y redirige a /login.html.
// ==============================
function apiAuthGuard(req, res, next) {
  // Permitir login sin sesión
  const allow = new Set(["/api/auth/login"]);
  if (allow.has(req.path)) return next();

  // Opcional: permitir /api/auth/me para que responda 401 dentro del route
  // pero si no está montado aún, igual protegemos.
  if (req.path === "/api/auth/me") return next();
  if (req.path === "/api/auth/logout") return next();

  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

app.use("/api", apiAuthGuard);

// ==============================
// Montaje de rutas (CRÍTICO)
// - Preferir router central routes.js si existe
// ==============================
function tryRequire(p) {
  try {
    return require(p);
  } catch (_) {
    return null;
  }
}

function mountRoutes() {
  // Posibles ubicaciones (ajusta si tu estructura difiere)
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

  // Fallback: montar uno por uno (sin unificar archivos)
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
      // No spamear: solo avisar si estás en debug
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
// Error handler global (CRÍTICO)
// ==============================
app.use((err, req, res, next) => {
  const isApi = req.path && req.path.startsWith("/api/");
  const prod = String(config.NODE_ENV || "").toLowerCase() === "production";

  const msg = err && err.message ? err.message : "Server error";
  if (!prod) {
    console.error("[ERROR]", msg);
  } else {
    // No exponer stack ni secrets
    console.error("[ERROR]", msg);
  }

  if (isApi) {
    return res.status(500).json({ ok: false, error: prod ? "Internal server error" : msg });
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

/*
Notas:
- Rutas /api se montan en:
  - Preferido: /src/routes/routes.js (si existe) => app.use("/api", routes)
  - Fallback: app.use("/api/<modulo>", require("<modulo>.routes.js"))

- Carpeta pública:
  - Se sirve desde config.PUBLIC_DIR (default: <ROOT>/public)

- Sesión:
  - express-session usa cookie name = config.COOKIE_NAME y secret = config.SESSION_SECRET
  - secure = true solo en producción (HTTPS)
  - TTL = config.SESSION_TTL_HOURS

Si no levanta:
- Revisa config.DB_PATH (ruta y permisos) y que exista la carpeta contenedora.
- Revisa que tus routes estén en /src/routes o /routes, o crea routes.js central.
*/

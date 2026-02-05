// services/server.js
// Express + SQLite para Electron (dev + packaged)
// - Puerto dinámico si PORT=0
// - Escribe server-port.txt en APP_USER_DATA (lo setea Electron)

const express = require("express");
const path = require("path");
const fs = require("fs");

const config = require("./config");

// DB: preferimos src/db.js
function tryRequire(p) {
  try { return require(p); } catch (_) { return null; }
}

const db =
  tryRequire(path.join(__dirname, "..", "src", "db.js")) ||
  tryRequire(path.join(__dirname, "..", "src", "db")) ||
  tryRequire(path.join(__dirname, "..", "db.js")) ||
  tryRequire(path.join(__dirname, "..", "db"));

if (!db) throw new Error("[DB] No se pudo cargar src/db.js");

function ensureDir(dirPath) {
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) {}
}

function existsFile(p) {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (_) { return false; }
}

function dbGet(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static front
ensureDir(config.PUBLIC_DIR);
app.use(express.static(config.PUBLIC_DIR));

app.get("/", (req, res) => {
  const indexPath = path.join(config.PUBLIC_DIR, "index.html");
  if (existsFile(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("No public entry file (index.html) found");
});

// Health
app.get("/health", async (req, res) => {
  let dbOk = false;
  try {
    const r = await dbGet(db, "SELECT 1 AS ok");
    dbOk = !!(r && r.ok === 1);
  } catch (_) {}
  return res.json({ ok: true, db: dbOk, uptime: process.uptime(), env: config.NODE_ENV || "dev" });
});
app.get("/api/health", async (req, res) => {
  let dbOk = false;
  try {
    const r = await dbGet(db, "SELECT 1 AS ok");
    dbOk = !!(r && r.ok === 1);
  } catch (_) {}
  return res.json({ ok: true, db: dbOk, uptime: process.uptime() });
});

// Routes (router central)
(function mountRoutes() {
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
      return;
    }
  }
  console.warn("[ROUTES] No central router found. /api no montado.");
})();

// 404 API
app.use((req, res, next) => {
  if (req.path && req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  return next();
});

// Error handler
app.use((err, req, res, next) => {
  const isApi = req.path && req.path.startsWith("/api/");
  const prod = String(config.NODE_ENV || "").toLowerCase() === "production";
  const msg = err && err.message ? err.message : "Server error";
  console.error("[ERROR]", msg);

  if (isApi) return res.status(500).json({ ok: false, error: prod ? "Internal server error" : msg });
  return res.status(500).send(prod ? "Internal server error" : msg);
});

// START: PORT=0 => libre
const requestedPort = Number(process.env.PORT ?? config.PORT ?? 0);
const portToUse = Number.isFinite(requestedPort) ? requestedPort : 0;

const server = app.listen(portToUse, () => {
  const actualPort = server.address().port;

  console.log(`[SERVER] Running on http://localhost:${actualPort}`);
  console.log(`[SERVER] Public dir: ${config.PUBLIC_DIR}`);
  console.log(`[SERVER] DB: ${config.DB_PATH}`);

  // Write port for Electron
  try {
    const userData = process.env.APP_USER_DATA;
    if (userData) {
      ensureDir(userData);
      fs.writeFileSync(path.join(userData, "server-port.txt"), String(actualPort), "utf8");
    }
  } catch (e) {
    console.error("[SERVER] cannot write server-port.txt:", e.message);
  }
});

module.exports = app;

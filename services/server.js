// services/server.js
// Express + SQLite para Electron (packaged) y Dev.
// - DB desde src/db.js
// - Puerto dinámico si PORT=0
// - Si corre como child_process.fork(), avisa el puerto con process.send()

const express = require("express");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const https = require("https");
const pkg = require("../package.json");

function tryRequire(p) {
  try { return require(p); } catch (_) { return null; }
}

// ✅ DB: tu conexión está en src/db.js
const db =
  tryRequire(path.join(__dirname, "..", "src", "db.js")) ||
  tryRequire(path.join(__dirname, "..", "src", "db")) ||
  tryRequire(path.join(__dirname, "..", "db.js")) ||
  tryRequire(path.join(__dirname, "..", "db"));

if (!db) {
  throw new Error("[DB] No se pudo cargar la conexión DB. Verifica src/db.js o db.js");
}


(async () => {
  await ensureInventarioMigration(db);
})();


// ---------------- helpers ----------------
function ensureDir(dirPath) {
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) {}
}

function existsFile(p) {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (_) { return false; }
}

function dbGet(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function dbExec(dbConn, sql) {
  return new Promise((resolve, reject) => {
    dbConn.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function ensureInventarioMigration(dbConn) {
  try {
    // ── PASO 0: Limpiar triggers huérfanos que apunten a inventario_movimientos_old ──
    // Esto ocurre cuando SQLite hace RENAME TABLE con FK activos y la migración
    // fue interrumpida. Los triggers quedan apuntando a la tabla vieja ya inexistente.
    try {
      const orphanTriggers = await dbAll(
        dbConn,
        `SELECT name FROM sqlite_master WHERE type='trigger'
         AND (sql LIKE '%inventario_movimientos_old%' OR tbl_name='inventario_movimientos_old')`
      );
      for (const t of orphanTriggers) {
        await new Promise((res, rej) =>
          dbConn.run(`DROP TRIGGER IF EXISTS "${t.name}"`, (err) => err ? rej(err) : res())
        );
        console.log("[MIGRATION] Trigger huérfano eliminado:", t.name);
      }
    } catch (e) {
      console.warn("[MIGRATION] No se pudieron limpiar triggers huérfanos:", e.message);
    }

    // ── PASO 1: Recuperar migración interrumpida ──
    // Si inventario_movimientos_old existe, la migración anterior fue interrumpida.
    // Completamos manualmente: copiar datos y eliminar la tabla vieja.
    const oldExists = await dbGet(
      dbConn,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='inventario_movimientos_old'"
    );
    if (oldExists) {
      console.log("[MIGRATION] ⚠️  Detectada migración interrumpida (inventario_movimientos_old existe). Completando...");
      const newExists = await dbGet(
        dbConn,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inventario_movimientos'"
      );
      if (newExists) {
        // La nueva tabla ya existe: copiar los datos que falten y eliminar la vieja
        try {
          await new Promise((res, rej) => dbConn.run(`
            INSERT OR IGNORE INTO inventario_movimientos
              (id, item_id, fecha, tipo, cantidad, costo_unitario, motivo, curso_id, instructor_id, created_at, updated_at)
            SELECT
              id, item_id,
              COALESCE(fecha, date('now')),
              tipo,
              COALESCE(cantidad, 0),
              COALESCE(costo_unitario, 0),
              motivo, curso_id, instructor_id,
              COALESCE(created_at, datetime('now')),
              COALESCE(updated_at, datetime('now'))
            FROM inventario_movimientos_old
            WHERE NOT EXISTS (SELECT 1 FROM inventario_movimientos m WHERE m.id = inventario_movimientos_old.id)
          `, (err) => err ? rej(err) : res()));
        } catch (e) {
          console.warn("[MIGRATION] Advertencia copiando datos desde _old:", e.message);
        }
      }
      // Eliminar la tabla vieja pase lo que pase
      try {
        await new Promise((res, rej) =>
          dbConn.run("DROP TABLE IF EXISTS inventario_movimientos_old", (err) => err ? rej(err) : res())
        );
        console.log("[MIGRATION] ✅ inventario_movimientos_old eliminada");
      } catch (e) {
        console.warn("[MIGRATION] No se pudo eliminar inventario_movimientos_old:", e.message);
      }
    }

    // ── PASO 2: Verificar si la migración principal ya fue aplicada ──
    const movDef = await dbGet(
      dbConn,
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='inventario_movimientos'"
    );
    const movSql = String(movDef?.sql || "");
    const movOk = movSql.includes("Prestamo") && movSql.includes("Devolucion") && movSql.includes("Venta");

    const prestDef = await dbGet(
      dbConn,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='inventario_prestamos'"
    );
    let prestOk = false;
    if (prestDef) {
      const cols = await dbAll(dbConn, "PRAGMA table_info(inventario_prestamos)");
      prestOk = cols.some(c => c && c.name === "nota");
    }

    if (movOk && prestOk) {
      console.log("[MIGRATION] Inventario ya está actualizado, nada que hacer.");
      return;
    }

    // ── PASO 3: Ejecutar el archivo SQL de migración ──
    const sqlPath = path.join(__dirname, "migrations", "2026_02_inventario_prestamo_venta.sql");
    if (!existsFile(sqlPath)) {
      console.warn("[MIGRATION] Archivo SQL no encontrado:", sqlPath);
      return;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log("[MIGRATION] Ejecutando migración de inventario...");

    if (!prestDef) {
      await dbExec(dbConn, `
        CREATE TABLE IF NOT EXISTS inventario_prestamos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          cantidad INTEGER NOT NULL DEFAULT 0,
          instructor_id INTEGER NOT NULL,
          curso_id INTEGER,
          fecha TEXT NOT NULL DEFAULT (date('now')),
          nota TEXT,
          estado TEXT NOT NULL DEFAULT 'Pendiente',
          cantidad_devuelta INTEGER NOT NULL DEFAULT 0,
          fecha_devolucion TEXT,
          mov_salida_id INTEGER,
          mov_devolucion_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }

    await dbExec(dbConn, sql);
    console.log("[MIGRATION] ✅ Migración de inventario completada");
  } catch (e) {
    console.error("[MIGRATION] Error:", e.message || e);
  }
}


// ---------------- app ----------------
const app = express();
app.disable("x-powered-by");

// ─── Security Headers ───
app.use((req, res, next) => {
  // Content-Security-Policy: solo recursos locales
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",        // unsafe-inline necesario para scripts inline actuales
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));



// Frontend estático
// ⚠️ OJO: en packaged, PUBLIC_DIR puede estar dentro del asar (solo lectura).
// No intentamos crear PUBLIC_DIR si es read-only (igual express.static lee).
try { ensureDir(config.PUBLIC_DIR); } catch (_) {}
app.use(express.static(config.PUBLIC_DIR));

// Home
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

function httpsGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "CHINO_BARBER-update-check", Accept: "application/vnd.github+json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function compareSemver(a, b) {
  const pa = String(a || "").replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const dbv = pb[i] || 0;
    if (da > dbv) return 1;
    if (da < dbv) return -1;
  }
  return 0;
}

app.get("/api/app/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, version: pkg.version, name: pkg.name });
});

app.get("/api/app/update-check", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const localVersion = String(pkg.version || "0.0.0");
  const repo = process.env.UPDATE_CHECK_REPO || "Diego-Dell/CHINO_BARBER";
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const rel = await httpsGetJson(url);
    const tag = String(rel.tag_name || rel.name || "").trim();
    const latestVersion = tag.replace(/^v/i, "");
    const cmp = compareSemver(latestVersion, localVersion);
    try {
      const { writeLog } = require("../src/lib/auditLog");
      await writeLog(
        "update_check",
        JSON.stringify({ localVersion, latestVersion, updateAvailable: cmp > 0 }),
        "sistema"
      );
    } catch (_) {}
    return res.json({
      ok: true,
      localVersion,
      latestVersion,
      latestTag: tag,
      updateAvailable: cmp > 0,
      published_at: rel.published_at || null,
      html_url: rel.html_url || null,
    });
  } catch (e) {
    console.warn("[UPDATE-CHECK]", e.message);
    try {
      const { writeLog } = require("../src/lib/auditLog");
      await writeLog("update_check_error", String(e.message || e), "sistema");
    } catch (_) {}
    return res.json({
      ok: false,
      localVersion,
      updateAvailable: false,
      error: "No se pudo consultar la versión remota",
    });
  }
});


// ── Licencia ─────────────────────────────────────────────────────────────────
let licMod = null;
try { licMod = require("../src/security/license"); } catch (_) {}

app.get("/api/license/status", (req, res) => {
  const activated = licMod ? licMod.isActivated() : true;
  res.json({ ok: true, activated });
});

app.get("/api/license/machine-code", (req, res) => {
  const code = licMod ? licMod.getMachineCode() : "N/A";
  res.json({ ok: true, code });
});

app.post("/api/license/activate", (req, res) => {
  if (!licMod) return res.json({ ok: true }); // sin módulo = skip
  const key = String(req.body && req.body.key || "").trim();
  const result = licMod.activate(key);
  res.json(result);
});

// ── Guard: redirigir a activation.html si no está activado ───────────────────
app.use((req, res, next) => {
  if (!licMod) return next();
  if (req.path.startsWith("/api/")) return next();
  if (req.path === "/activation.html" || req.path === "/") return next();
  if ([".js",".css",".png",".ico",".woff",".woff2",".svg"].some(ext => req.path.endsWith(ext))) return next();
  if (!licMod.isActivated()) {
    return res.redirect("/activation.html");
  }
  next();
});


// Montar router central
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
try {
  const { apiNotFound, apiErrorMiddleware } = require("../src/middleware/apiErrorMiddleware");
  app.use(apiNotFound);
  app.use(apiErrorMiddleware);
} catch (_) {
  // Fallback mínimo si el módulo no está disponible
  app.use((req, res, next) => {
    if (req.path && req.path.startsWith("/api/")) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    return next();
  });
  app.use((err, req, res, next) => {
    const isApi = req.path && req.path.startsWith("/api/");
    const prod = String(config.NODE_ENV || "").toLowerCase() === "production";
    const msg = err && err.message ? err.message : "Server error";
    console.error("[ERROR]", msg);
    if (isApi) return res.status(500).json({ ok: false, error: prod ? "Internal server error" : msg });
    return res.status(500).send(prod ? "Internal server error" : msg);
  });
}


// ── Asegurar que backup va a AppData (no al directorio del proyecto) ─────────
if (process.env.APP_USER_DATA && !process.env.BACKUP_DIR) {
  const _bdir = require("path").join(process.env.APP_USER_DATA, "backups");
  require("fs").mkdirSync(_bdir, { recursive: true });
  process.env.BACKUP_DIR = _bdir;
}

// ── Auto-backup silencioso cada 6 horas ──────────────────────────────────────
(function startAutoBackup() {
  try {
    const backup = require("./backup");
    const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas
    const MAX_BACKUPS = 10;
    const OLDER_THAN_DAYS = 30;

    async function doBackup() {
      try {
        const r = await backup.createBackup();
        if (r.ok) {
          await backup.purgeOldBackups({ keepLast: MAX_BACKUPS, olderThanDays: OLDER_THAN_DAYS });
          try {
            const { writeLog } = require("../src/lib/auditLog");
            await writeLog("backup_ok", JSON.stringify({ file: r.file, size: r.size }), "sistema");
          } catch (e) {
            console.warn("[BACKUP] log:", e.message);
          }
        } else if (r.error) {
          try {
            const { writeLog } = require("../src/lib/auditLog");
            await writeLog("backup_error", String(r.error), "sistema");
          } catch (e) {
            console.warn("[BACKUP] log:", e.message);
          }
        }
      } catch (e) {
        console.error("[BACKUP]", e.message || e);
        try {
          const { writeLog } = require("../src/lib/auditLog");
          await writeLog("backup_error", String(e.message || e), "sistema");
        } catch (_) {}
      }
    }

    setImmediate(doBackup);
    setInterval(doBackup, INTERVAL_MS);
  } catch (_) {}
})();

// Start (127.0.0.1: evita exposición accidental en LAN)
const requestedPort = Number(process.env.PORT ?? config.PORT ?? 0) || 0;
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";

let whenReadyResolve;
const whenReady = new Promise((resolve) => {
  whenReadyResolve = resolve;
});

const server = app.listen(requestedPort, BIND_HOST, () => {
  const addr = server.address();
  const actualPort = addr && addr.port;

  console.log(`[SERVER] Running on http://${BIND_HOST}:${actualPort}`);
  console.log(`[SERVER] Public dir: ${config.PUBLIC_DIR}`);
  console.log(`[SERVER] DB: ${config.DB_PATH}`);

  if (typeof process.send === "function") {
    try { process.send({ type: "ready", port: actualPort }); } catch (_) {}
  }
  whenReadyResolve();
});

function getPort() {
  const a = server.address();
  return a && a.port ? a.port : null;
}

// logs de crashes reales
process.on("uncaughtException", (e) => console.error("[FATAL] uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("[FATAL] unhandledRejection:", e));

module.exports = { app, server, getPort, whenReady };
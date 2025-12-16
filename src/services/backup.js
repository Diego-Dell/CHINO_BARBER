// services/backup.js
// Servicio reutilizable para backup/restore de SQLite (sin servidor, sin dependencias externas).

const fs = require("fs");
const path = require("path");
let sqlite3 = null;
try {
  // Opcional: si está instalado en tu proyecto, lo usamos para VACUUM INTO.
  sqlite3 = require("sqlite3");
} catch (_) {
  sqlite3 = null;
}

// ===============================
// Config + Paths
// ===============================
function safeRequireConfig() {
  try {
    // Desde services/backup.js => services/config.js
    return require("./config");
  } catch (_) {
    return null;
  }
}

const config = safeRequireConfig();

function resolveDBPath() {
  const env = process.env.DB_PATH && String(process.env.DB_PATH).trim();
  if (env) return path.resolve(env);

  const cfg = config && config.DB_PATH ? String(config.DB_PATH).trim() : "";
  if (cfg) return path.resolve(cfg);

  return path.resolve("./db/database.sqlite");
}

function resolveBackupDir() {
  const env = process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim();
  if (env) return path.resolve(env);

  const cfg = config && config.BACKUP_DIR ? String(config.BACKUP_DIR).trim() : "";
  if (cfg) return path.resolve(cfg);

  return path.resolve("./backups");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getLockPath(backupDir) {
  return path.join(backupDir, ".backup.lock");
}

// ===============================
// Helpers
// ===============================
function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestampForName(d = new Date()) {
  // backup_YYYY-MM-DD_HH-mm-ss.sqlite
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  );
}

function parseTimestampFromName(filename) {
  // Extrae YYYY-MM-DD_HH-mm-ss de backup_... o pre_restore_...
  const m = String(filename).match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
  if (!m) return null;
  const [datePart, timePart] = [m[1], m[2]];
  const iso = `${datePart}T${timePart.replace(/-/g, ":")}`;
  const dt = new Date(iso);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function fileStatSafe(p) {
  try {
    return fs.statSync(p);
  } catch (_) {
    return null;
  }
}

function existsFile(p) {
  const st = fileStatSafe(p);
  return !!st && st.isFile();
}

function ensureDbExists(dbPath) {
  if (!existsFile(dbPath)) {
    const err = new Error("DB file not found");
    err.code = "DB_NOT_FOUND";
    throw err;
  }
}

function isSafeFilename(name) {
  // Bloquea path traversal y separadores
  if (!name) return false;
  const s = String(name);
  if (s.includes("..")) return false;
  if (s.includes("/") || s.includes("\\") || s.includes("\0")) return false;
  // Solo nombre simple
  return path.basename(s) === s;
}

function ensureInBackupDir(backupDir, filename) {
  if (!isSafeFilename(filename)) {
    const err = new Error("Invalid backup filename");
    err.code = "INVALID_FILENAME";
    throw err;
  }
  const full = path.join(backupDir, filename);
  const resolvedDir = path.resolve(backupDir);
  const resolvedFile = path.resolve(full);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
    const err = new Error("Invalid backup filename");
    err.code = "INVALID_FILENAME";
    throw err;
  }
  return resolvedFile;
}

function ensureSqliteExt(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".sqlite" && ext !== ".db") {
    const err = new Error("Backup file not found");
    err.code = "BACKUP_NOT_FOUND";
    throw err;
  }
}

function withLock(backupDir, fn) {
  const lockPath = getLockPath(backupDir);

  // Si lock existe, bloquear
  if (existsFile(lockPath)) {
    const err = new Error("Restore blocked: lock active");
    err.code = "LOCK_ACTIVE";
    throw err;
  }

  // Crear lock atómico
  let fd = null;
  try {
    fd = fs.openSync(lockPath, "wx"); // falla si existe
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    fs.closeSync(fd);
    fd = null;

    return fn();
  } finally {
    try {
      if (fd) fs.closeSync(fd);
    } catch (_) {}
    try {
      if (existsFile(lockPath)) fs.unlinkSync(lockPath);
    } catch (_) {}
  }
}

function copyFileAtomic(src, dest) {
  // Copia a temp y luego rename (rename es atómico en mismo filesystem)
  const dir = path.dirname(dest);
  const base = path.basename(dest);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  fs.copyFileSync(src, tmp);
  // Intento de "flush" básico: stat para asegurar que está escrito
  fs.statSync(tmp);
  fs.renameSync(tmp, dest);
}

function copyByStreamAtomic(src, dest) {
  // Si quieres stream (archivos enormes), pero aquí usamos copyFileSync por simplicidad y confiabilidad.
  // Dejamos función por si luego cambias.
  copyFileAtomic(src, dest);
}

function openSqlite(dbPath) {
  if (!sqlite3) return null;
  const { Database } = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
  return new Database(dbPath);
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function closeSql(db) {
  return new Promise((resolve) => {
    if (!db) return resolve();
    db.close(() => resolve());
  });
}

async function vacuumInto(dbPath, outPath) {
  // VACUUM INTO requiere SQLite >= 3.27 (depende del binario/lib enlazada)
  const db = openSqlite(dbPath);
  if (!db) return { ok: false, reason: "sqlite3_not_available" };

  try {
    // Minimiza riesgo de journaling: WAL checkpoint si aplica
    try {
      await runSql(db, "PRAGMA wal_checkpoint(FULL)");
    } catch (_) {
      // no pasa nada si no está en WAL
    }
    await runSql(db, `VACUUM INTO ?`, [outPath]);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  } finally {
    await closeSql(db);
  }
}

function fileMeta(fullPath) {
  const st = fs.statSync(fullPath);
  return {
    size: st.size,
    createdAt: st.birthtime ? st.birthtime.toISOString() : st.mtime.toISOString(),
  };
}

// ===============================
// API
// ===============================

async function createBackup(options = {}) {
  try {
    const DB_PATH = resolveDBPath();
    const BACKUP_DIR = resolveBackupDir();
    ensureDir(BACKUP_DIR);
    ensureDbExists(DB_PATH);

    return await withLock(BACKUP_DIR, async () => {
      const now = new Date();
      const file = `backup_${timestampForName(now)}.sqlite`;
      const outPath = path.join(BACKUP_DIR, file);

      if (existsFile(outPath)) {
        const err = new Error("Backup file already exists");
        err.code = "BACKUP_EXISTS";
        throw err;
      }

      // Preferir VACUUM INTO si es posible
      const tryVacuum = options.preferVacuumInto !== false; // default true
      if (tryVacuum && sqlite3) {
        const r = await vacuumInto(DB_PATH, outPath);
        if (r.ok) {
          const meta = fileMeta(outPath);
          return { ok: true, file, size: meta.size, createdAt: meta.createdAt };
        }
        // Si falla, seguimos con copia atómica
      }

      // Fallback: copia atómica simple (se usa lock para evitar restore concurrente)
      copyByStreamAtomic(DB_PATH, outPath);

      const meta = fileMeta(outPath);
      return { ok: true, file, size: meta.size, createdAt: meta.createdAt };
    });
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "Backup failed" };
  }
}

async function listBackups() {
  try {
    const BACKUP_DIR = resolveBackupDir();
    ensureDir(BACKUP_DIR);

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => isSafeFilename(f))
      .filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return ext === ".sqlite" || ext === ".db";
      });

    const items = files
      .map((file) => {
        const fullPath = path.join(BACKUP_DIR, file);
        const st = fileStatSafe(fullPath);
        if (!st || !st.isFile()) return null;

        const inferred = parseTimestampFromName(file);
        const createdAt = inferred
          ? inferred.toISOString()
          : (st.birthtime ? st.birthtime.toISOString() : st.mtime.toISOString());

        return {
          file,
          path: fullPath,
          size: st.size,
          createdAt,
        };
      })
      .filter(Boolean);

    // Orden DESC (más nuevo primero) por createdAt, fallback por nombre
    items.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (tb !== ta) return tb - ta;
      return String(b.file).localeCompare(String(a.file));
    });

    return { ok: true, data: items };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "List backups failed" };
  }
}

async function getBackupInfo(filename) {
  try {
    const BACKUP_DIR = resolveBackupDir();
    ensureDir(BACKUP_DIR);

    const fullPath = ensureInBackupDir(BACKUP_DIR, filename);

    if (!existsFile(fullPath)) {
      const err = new Error("Backup file not found");
      err.code = "BACKUP_NOT_FOUND";
      throw err;
    }

    const st = fs.statSync(fullPath);
    const inferred = parseTimestampFromName(filename);
    const createdAt = inferred
      ? inferred.toISOString()
      : (st.birthtime ? st.birthtime.toISOString() : st.mtime.toISOString());

    return {
      ok: true,
      data: {
        file: path.basename(fullPath),
        path: fullPath,
        size: st.size,
        createdAt,
      },
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "Get backup info failed" };
  }
}

async function restoreBackup(filename, options = {}) {
  try {
    const DB_PATH = resolveDBPath();
    const BACKUP_DIR = resolveBackupDir();
    ensureDir(BACKUP_DIR);
    ensureDbExists(DB_PATH);

    // Seguridad filename + extensión
    ensureSqliteExt(filename);

    const backupPath = ensureInBackupDir(BACKUP_DIR, filename);
    if (!existsFile(backupPath)) {
      const err = new Error("Backup file not found");
      err.code = "BACKUP_NOT_FOUND";
      throw err;
    }

    return await withLock(BACKUP_DIR, async () => {
      // pre-backup automático
      const now = new Date();
      const preBackup = `pre_restore_${timestampForName(now)}.sqlite`;
      const prePath = path.join(BACKUP_DIR, preBackup);

      if (existsFile(prePath)) {
        const err = new Error("Backup file already exists");
        err.code = "BACKUP_EXISTS";
        throw err;
      }

      // Copiar DB actual a pre-backup (atómico)
      copyFileAtomic(DB_PATH, prePath);

      // Restaurar: copiar backup seleccionado sobre DB_PATH de forma atómica
      // (copiamos a temp en el mismo dir de la DB para que rename sea atómico)
      const dbDir = path.dirname(DB_PATH);
      const dbBase = path.basename(DB_PATH);
      const tmpRestore = path.join(dbDir, `.${dbBase}.restore.tmp.${process.pid}.${Date.now()}`);

      fs.copyFileSync(backupPath, tmpRestore);
      fs.statSync(tmpRestore);

      // Opcional: intentar "checkpoint" luego de restore no aplica (es archivo ya)
      fs.renameSync(tmpRestore, DB_PATH);

      return { ok: true, restoredFrom: filename, preBackup };
    });
  } catch (err) {
    // Mensajes claros requeridos
    const msg = err && err.message ? err.message : "Restore failed";
    return { ok: false, error: msg };
  }
}

async function purgeOldBackups({ keepLast = 20, olderThanDays = 30 } = {}) {
  try {
    const BACKUP_DIR = resolveBackupDir();
    ensureDir(BACKUP_DIR);

    const listRes = await listBackups();
    if (!listRes.ok) throw new Error(listRes.error || "List backups failed");

    const items = listRes.data || [];
    // Ya viene DESC (más nuevo primero)
    const keep = Math.max(0, Number(keepLast) || 0);
    const days = Math.max(0, Number(olderThanDays) || 0);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const kept = [];
    const deleted = [];

    // Mantener siempre los keep primeros
    const mustKeepSet = new Set(items.slice(0, keep).map((x) => x.file));

    for (const it of items) {
      const fullPath = it.path;
      if (mustKeepSet.has(it.file)) {
        kept.push(it.file);
        continue;
      }

      const t = new Date(it.createdAt).getTime();
      const isOld = Number.isFinite(t) ? t < cutoff : false;

      // Solo borrar si excede criterios de antigüedad o si hay demasiados
      // Regla: además de olderThanDays, si hay más de keep, se puede borrar los más viejos.
      // (Aquí: borra si esOld; si days=0, no borra por edad, solo por exceso no aplica por requisito)
      if (days > 0 && isOld) {
        try {
          fs.unlinkSync(fullPath);
          deleted.push(it.file);
        } catch (_) {
          // si no se puede borrar, lo mantenemos
          kept.push(it.file);
        }
      } else {
        kept.push(it.file);
      }
    }

    // Si aún quedan demasiados (mayor a keep) y days=0, por requisito no borramos por edad.
    // Si quieres purga por exceso siempre, cámbialo aquí.

    return { ok: true, deleted, kept };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "Purge backups failed" };
  }
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  purgeOldBackups,
  getBackupInfo,
};

/*
USO (desde server.js o desde una ruta):
  const backup = require("./services/backup");

  // Crear backup
  const r = await backup.createBackup();
  console.log(r);

  // Listar
  const list = await backup.listBackups();

  // Restaurar
  const restore = await backup.restoreBackup("backup_2025-12-16_18-30-00.sqlite");
*/

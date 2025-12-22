// services/config.js
// Configuración central del backend (server + routes + backup). Compatible Windows/Linux.
// Sin dependencias externas: solo fs/path. Lee process.env (si .env ya fue cargado, lo usa).

const fs = require("fs");
const path = require("path");

// ===============================
// Base dirs (robusto si se ejecuta desde otra carpeta)
// ===============================
const SERVICES_DIR = __dirname;

// Intento 1: asumir que /services está dentro del root del proyecto
const ROOT_DIR_FROM_SERVICES = path.resolve(SERVICES_DIR, "..");

// Intento 2: process.cwd() (cuando inicias node desde el root suele coincidir)
const ROOT_DIR_FROM_CWD = path.resolve(process.cwd());

// Heurística: si en ROOT_DIR_FROM_CWD existe "services", usar CWD como ROOT.
// Caso contrario, usar el root derivado desde __dirname.
function pickRootDir() {
  try {
    const cand1 = path.join(ROOT_DIR_FROM_CWD, "services");
      const cand2 = path.join(ROOT_DIR_FROM_CWD, "src", "services");
      if ((fs.existsSync(cand1) && fs.statSync(cand1).isDirectory()) ||
          (fs.existsSync(cand2) && fs.statSync(cand2).isDirectory())) {
        return ROOT_DIR_FROM_CWD;
      }
  } catch (_) {}
  return ROOT_DIR_FROM_SERVICES;
}

const ROOT_DIR = pickRootDir();

// ===============================
// Helpers (exportados)
// ===============================
function resolvePath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowTimestamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  );
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function isValidPath(p) {
  if (!p) return false;
  if (typeof p !== "string") return false;
  const s = p.trim();
  if (!s) return false;
  // bloquea null bytes
  if (s.includes("\0")) return false;
  return true;
}

// ===============================
// Directories (con override por env)
// ===============================
const PUBLIC_DIR = process.env.PUBLIC_DIR && isValidPath(process.env.PUBLIC_DIR)
  ? path.resolve(process.env.PUBLIC_DIR)
  : resolvePath("public");

// Puedes usar db/ o database/. Elegimos db/ por ser lo más común en tus mensajes.
const DB_DIR = process.env.DB_DIR && isValidPath(process.env.DB_DIR)
  ? path.resolve(process.env.DB_DIR)
  : resolvePath("db");

// ===============================
// DB_PATH (CRÍTICO)
// Prioridad: DB_PATH -> SQLITE_PATH -> default ROOT/db/database.sqlite
// ===============================
let DB_PATH = null;
if (isValidPath(process.env.DB_PATH)) DB_PATH = path.resolve(process.env.DB_PATH.trim());
else if (isValidPath(process.env.SQLITE_PATH)) DB_PATH = path.resolve(process.env.SQLITE_PATH.trim());
else DB_PATH = path.join(DB_DIR, "database.sqlite");

// Asegurar que existe la carpeta contenedora
ensureDir(path.dirname(DB_PATH));

// ===============================
// BACKUP_DIR
// ===============================
let BACKUP_DIR = null;
if (isValidPath(process.env.BACKUP_DIR)) BACKUP_DIR = path.resolve(process.env.BACKUP_DIR.trim());
else BACKUP_DIR = resolvePath("backups");

ensureDir(BACKUP_DIR);

// ===============================
// Server settings
// ===============================
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const NODE_ENV = process.env.NODE_ENV ? String(process.env.NODE_ENV) : "development";
const BASE_URL = process.env.BASE_URL && isValidPath(process.env.BASE_URL)
  ? String(process.env.BASE_URL).trim()
  : `http://localhost:${PORT}`;

// ===============================
// Session / Cookies
// ===============================
const SESSION_SECRET = (process.env.SESSION_SECRET && String(process.env.SESSION_SECRET).trim()) ||
  "CHINO_BARBER_SECRET_CHANGE_ME";

const COOKIE_NAME = (process.env.COOKIE_NAME && String(process.env.COOKIE_NAME).trim()) ||
  "CHINO_BARBER_SESSION";

const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS) > 0
  ? Number(process.env.SESSION_TTL_HOURS)
  : 12;

const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE && String(process.env.COOKIE_SAMESITE).trim()) || "lax";
const COOKIE_SECURE = isProduction(); // true solo en producción (recomendado)
const COOKIE_HTTPONLY = true;

// ===============================
// Logs flags
// ===============================
const LOG_LEVEL = (process.env.LOG_LEVEL && String(process.env.LOG_LEVEL).trim()) || "info";
const DEBUG = String(process.env.DEBUG || "").toLowerCase() === "true";

// ===============================
// Config object
// ===============================
const config = {
  // dirs
  SERVICES_DIR,
  ROOT_DIR,
  PUBLIC_DIR,
  DB_DIR,

  // paths
  DB_PATH,
  BACKUP_DIR,

  // server
  PORT,
  NODE_ENV,
  BASE_URL,

  // session/cookies
  SESSION_SECRET,
  COOKIE_NAME,
  SESSION_TTL_HOURS,
  COOKIE_SAMESITE,
  COOKIE_SECURE,
  COOKIE_HTTPONLY,

  // logs
  LOG_LEVEL,
  DEBUG,

  // helpers
  resolvePath,
  ensureDir,
  nowISODate,
  nowTimestamp,
  isProduction,
};

// Validación ligera final (sin loguear secrets)
if (!isValidPath(config.DB_PATH)) {
  // No tiramos error para no romper arranque; dejamos un valor seguro.
  config.DB_PATH = path.join(config.DB_DIR, "database.sqlite");
  ensureDir(path.dirname(config.DB_PATH));
}

module.exports = config;

/*
Ejemplo de uso:
  const config = require("./services/config");
  console.log(config.DB_PATH);
*/

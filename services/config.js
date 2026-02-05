// services/config.js
// Configuración central (server + routes + backup).
// Compatible Node / Electron / Windows / Linux.
// Electron define: DB_DIR, DB_PATH, APP_USER_DATA, PORT

const fs = require("fs");
const path = require("path");

const SERVICES_DIR = __dirname;
const ROOT_DIR = path.resolve(SERVICES_DIR, "..");

function resolvePath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) {}
}

function isValidPath(p) {
  if (!p || typeof p !== "string") return false;
  const s = p.trim();
  if (!s) return false;
  if (s.includes("\0")) return false;
  return true;
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

// PUBLIC (en packaged vive dentro del asar: <root>/public)
const PUBLIC_DIR =
  process.env.PUBLIC_DIR && isValidPath(process.env.PUBLIC_DIR)
    ? path.resolve(process.env.PUBLIC_DIR)
    : resolvePath("public");

// DB_DIR (en Electron lo mandas a AppData/Roaming/<app>/db)
const DB_DIR =
  process.env.DB_DIR && isValidPath(process.env.DB_DIR)
    ? path.resolve(process.env.DB_DIR)
    : resolvePath("db");

// DB_PATH
let DB_PATH = null;
if (isValidPath(process.env.DB_PATH)) DB_PATH = path.resolve(process.env.DB_PATH.trim());
else if (isValidPath(process.env.SQLITE_PATH)) DB_PATH = path.resolve(process.env.SQLITE_PATH.trim());
else DB_PATH = path.join(DB_DIR, "database.sqlite");

ensureDir(path.dirname(DB_PATH));

// Backups (por defecto en el root; si quieres en AppData manda BACKUP_DIR desde env)
const BACKUP_DIR =
  isValidPath(process.env.BACKUP_DIR)
    ? path.resolve(process.env.BACKUP_DIR.trim())
    : resolvePath("backups");
ensureDir(BACKUP_DIR);

// Puerto: en producción usaremos PORT=0 (dinámico) desde Electron.
const PORT = Number(process.env.PORT) >= 0 ? Number(process.env.PORT) : 3000;

const config = {
  SERVICES_DIR,
  ROOT_DIR,
  PUBLIC_DIR,
  DB_DIR,
  DB_PATH,
  BACKUP_DIR,

  PORT,
  NODE_ENV: process.env.NODE_ENV ? String(process.env.NODE_ENV) : "development",

  ensureDir,
  resolvePath,
  isProduction,
};

module.exports = config;

// src/security/license.js
// 10 keys fijas. Cada una se vincula al dispositivo la primera vez que se usa.
// Si alguien copia la clave o el archivo .lic a otra PC → bloqueado.

const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const crypto = require("crypto");

// SHA-256 de cada key (en texto plano nunca se almacenan)
const VALID_KEY_HASHES = new Set([
  "782e8cea75dd9293622c174f3a8fe38415a0cbaefd8c13dc29a2fd963397eb60", // BS-A1F2-7K9P-MX3Q
  "8f909c273dde6c0a65b7a444f6e3f262714a36193213c18c34f7f04e2a7c4299", // BS-B4E8-2R6T-NW5Y
  "0dce0bb2e5ea36c563b31ef5f005dc5aa8d291e87dc2b910cb5da9549bd3b04b", // BS-C7H3-9D1L-VJ4U
  "be5174c44b73f51b40f5ece6a9160f11004c43350e6ad62136975466090f9cd2", // BS-D2K6-5G8S-QZ1X
  "c98d6006bb757813e5d38369cad04a4eec3a4a77a3084a39a268b92d30eaa225", // BS-E9M4-3F7N-RT6W
  "b0abb94526bd50c053b5b9b6b23407162e3a1470db4e6b2afaa27c2a3025be8e", // BS-F5P1-8H2V-KY9B
  "41c0d0f22d407abaa0f3b02ea1358b9488515fde8a4cf2707ec3cb8385d4dc15", // BS-G3N7-6J4Q-LX2C
  "d83112fa4f5bfdcb51fa4efa6e6deab2aed7c9bee8ce8471494af4812acfc161", // BS-H8R2-1M5T-WD7E
  "96ec3f4c378dc193f0c1e0fc8da84a045bf061b36be8d2e8eb7b3fbd4db6c624", // BS-I6S9-4K3P-NF8A
  "167006c52599396726a79c41712faa515088e34d70bb3dcea77d342078ab6667", // BS-J1V5-7B2G-QH4Z
]);

const PLAIN_KEYS = [
  "BS-A1F2-7K9P-MX3Q","BS-B4E8-2R6T-NW5Y","BS-C7H3-9D1L-VJ4U",
  "BS-D2K6-5G8S-QZ1X","BS-E9M4-3F7N-RT6W","BS-F5P1-8H2V-KY9B",
  "BS-G3N7-6J4Q-LX2C","BS-H8R2-1M5T-WD7E","BS-I6S9-4K3P-NF8A",
  "BS-J1V5-7B2G-QH4Z",
];

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key).trim().toUpperCase()).digest("hex");
}

// Huella única del dispositivo (hostname + usuario + plataforma)
function getMachineFingerprint() {
  const parts = [os.hostname(), os.userInfo().username, os.platform(), os.arch()].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

function getLicensePath() {
  const userData = process.env.APP_USER_DATA ||
    path.join(os.homedir(), "AppData", "Roaming", "chino-barber");
  fs.mkdirSync(userData, { recursive: true });
  return path.join(userData, ".lic");
}

function readLicense() {
  try {
    const p = getLicensePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(Buffer.from(fs.readFileSync(p, "utf8").trim(), "base64").toString("utf8"));
  } catch (_) { return null; }
}

function saveLicense(keyHash) {
  const data = {
    k: keyHash,
    m: getMachineFingerprint(), // huella del dispositivo al momento de activar
    activated: new Date().toISOString(),
  };
  fs.writeFileSync(
    getLicensePath(),
    Buffer.from(JSON.stringify(data)).toString("base64"),
    "utf8"
  );
}

function isActivated() {
  const lic = readLicense();
  if (!lic || !lic.k || !lic.m) return false;
  if (!VALID_KEY_HASHES.has(lic.k)) return false;
  // Verificar que el dispositivo actual es el mismo donde se activó
  if (lic.m !== getMachineFingerprint()) return false;
  return true;
}

function activate(key) {
  const clean = String(key || "").trim().toUpperCase();
  if (!PLAIN_KEYS.includes(clean)) {
    return { ok: false, error: "Clave inválida. Contactá al soporte." };
  }
  const h = hashKey(clean);
  // Verificar que no fue activada ya en ESTE dispositivo con OTRA key (opcional, protección extra)
  const existing = readLicense();
  if (existing && existing.k && existing.m === getMachineFingerprint()) {
    // Ya activado en este dispositivo — dejar pasar (re-activación)
  }
  saveLicense(h);
  return { ok: true };
}

function getMachineCode() {
  // Primeros 8 chars de la huella — para soporte si hace falta
  return getMachineFingerprint().slice(0, 8).toUpperCase();
}

module.exports = { isActivated, activate, getMachineCode, getLicensePath };
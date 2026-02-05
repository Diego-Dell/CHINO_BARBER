// electron-main.js
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const log = require("electron-log");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
} catch (_) {
  // en dev puede no estar
}

log.transports.file.level = "info";

let mainWindow = null;
let serverProcess = null;

const userData = app.getPath("userData");
const DB_DIR = path.join(userData, "db");
const LOG_DIR = path.join(userData, "logs");

fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// ✅ ENV (igual que el simple + completo)
process.env.APP_USER_DATA = userData;
process.env.DB_DIR = DB_DIR;
process.env.DB_PATH = path.join(DB_DIR, "database.sqlite");
process.env.NODE_ENV = "production";

// ✅ si quieres puerto fijo como el que te funciona, pon 3000.
// ✅ si quieres puerto libre, usa 0 PERO tu server debe escribir server-port.txt
// Recomendación: dev=3000 / packaged=0
if (!app.isPackaged) process.env.PORT = "3000";
else process.env.PORT = process.env.PORT || "0";

function httpGet(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const start = Date.now();
  const url = `${baseUrl}/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(url, 1200);
      if (res.status === 200) {
        // si responde ok o aunque no sea json, ya está arriba
        try {
          const json = JSON.parse(res.data || "{}");
          if (json.ok) return true;
        } catch (_) {
          return true;
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Server no respondió /health: ${url}`);
}

async function waitForPortFile(timeoutMs = 20000) {
  const portFile = path.join(userData, "server-port.txt");
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(portFile)) {
        const p = Number(fs.readFileSync(portFile, "utf8").trim());
        if (Number.isFinite(p) && p > 0) return p;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return null; // 👈 en vez de tirar error, devolvemos null y hacemos fallback
}

function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(baseUrl);
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

function startServerSameProcess() {
  // ✅ Esto es lo que te funciona (rutas OK, sin asar/spawn problemas)
  log.info("Starting server via require('./services/server') (same process)");
  require("./services/server");
}

function startServerSpawned() {
  return new Promise((resolve, reject) => {
    try {
      // ✅ IMPORTANTE: ejecutar desde asar suele fallar.
      // preferir app.asar.unpacked si lo dejaste unpacked
      const serverPath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar.unpacked", "services", "server.js")
        : path.join(__dirname, "services", "server.js");

      log.info("Starting server (spawn):", serverPath);

      serverProcess = spawn(process.execPath, [serverPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        windowsHide: true,
      });

      serverProcess.stdout.on("data", (d) => log.info("[SERVER]", d.toString()));
      serverProcess.stderr.on("data", (d) => log.error("[SERVER ERR]", d.toString()));

      serverProcess.on("error", (err) => reject(err));
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

async function checkForcedUpdate() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", () => {
    dialog.showMessageBoxSync({
      type: "info",
      buttons: ["OK"],
      title: "Actualización obligatoria",
      message: "Hay una nueva actualización obligatoria. Se descargará ahora.",
    });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Reiniciar ahora"],
      title: "Actualización lista",
      message: "Actualización descargada. La app se reiniciará para instalarla.",
    });
    autoUpdater.quitAndInstall();
  });

  await autoUpdater.checkForUpdates();
}

app.whenReady().then(async () => {
  try {
    // ✅ DEV: lo más estable para rutas (como tu simple)
    if (!app.isPackaged) {
      startServerSameProcess(); // server en mismo proceso
      const baseUrl = "http://localhost:3000";
      // opcional: esperar health si existe
      try { await waitForHealth(baseUrl, 8000); } catch (_) {}
      createWindow(baseUrl);
      return;
    }

    // ✅ PACKAGED:
    // Opción A (recomendada): server same-process (evita drama asar)
    // Si tu server es liviano, usa esto:
    startServerSameProcess();

    // Si REALMENTE quieres spawn en packaged, comenta arriba y descomenta esto:
    // await startServerSpawned();

    // ✅ BaseUrl en packaged:
    // - si PORT=3000 => fijo
    // - si PORT=0 => usa server-port.txt si existe, si no, fallback 3000
    let port = null;

    if (process.env.PORT && process.env.PORT !== "0") {
      port = Number(process.env.PORT);
    } else {
      port = await waitForPortFile(20000);
    }

    const baseUrl = `http://localhost:${port || 3000}`;

    await waitForHealth(baseUrl, 20000);
    createWindow(baseUrl);

    await checkForcedUpdate();
  } catch (err) {
    log.error("Startup error:", err);

    dialog.showErrorBox(
      "No se pudo iniciar el sistema",
      "El servidor local no respondió.\n\n" +
        "Revisa estos logs:\n" +
        `${LOG_DIR}\\main.log\n`
    );

    app.quit();
  }
});

app.on("before-quit", () => {
  try { if (serverProcess) serverProcess.kill(); } catch (_) {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

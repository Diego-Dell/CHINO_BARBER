// electron-main.js
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs   = require("fs");
const http = require("http");

const log = require("electron-log");
log.transports.file.level = "info";

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
  autoUpdater.autoDownload         = false; // controlamos manualmente
  autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
  log.warn("[UPDATER] electron-updater no disponible:", e.message);
}

let mainWindow  = null;
let updateReady = false; // true cuando la descarga está completa

// ─── Rutas de usuario ───────────────────────────────────────────
const userData = app.getPath("userData");
const DB_DIR   = path.join(userData, "db");
const LOG_DIR  = path.join(userData, "logs");
fs.mkdirSync(DB_DIR,  { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

process.env.APP_USER_DATA = userData;
process.env.DB_DIR        = DB_DIR;
process.env.DB_PATH       = path.join(DB_DIR, "database.sqlite");
process.env.NODE_ENV      = "production";
process.env.PORT          = app.isPackaged ? "0" : "3000";

// ─── Helper HTTP ─────────────────────────────────────────────────
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
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(`${baseUrl}/health`, 1200);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Server no respondió /health: ${baseUrl}`);
}

// ─── IPC → renderer ──────────────────────────────────────────────
function sendUpdate(event, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send("updater:event", { event, ...payload }); } catch (_) {}
  }
}

// ─── Configurar listeners del auto-updater ───────────────────────
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.removeAllListeners();

  autoUpdater.on("checking-for-update", () => {
    log.info("[UPDATER] Verificando...");
    sendUpdate("checking");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("[UPDATER] Disponible:", info.version);
    sendUpdate("available", { version: info.version, releaseDate: info.releaseDate });
    // Iniciar descarga automática en background
    autoUpdater.downloadUpdate().catch((e) => {
      log.error("[UPDATER] Error en descarga:", e);
      sendUpdate("error", { message: e.message });
    });
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[UPDATER] App actualizada.");
    sendUpdate("not-available", { currentVersion: app.getVersion() });
  });

  autoUpdater.on("download-progress", (p) => {
    const pct = Math.round(p.percent || 0);
    sendUpdate("progress", { percent: pct, bytesPerSecond: p.bytesPerSecond, total: p.total });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    log.info("[UPDATER] Descarga completa:", info.version);
    sendUpdate("downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    log.error("[UPDATER] Error:", err);
    sendUpdate("error", { message: err.message || "Error desconocido" });
  });
}

function startUpdateCheck() {
  if (!autoUpdater || !app.isPackaged) return;
  // Delay para no competir con la carga inicial
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      log.warn("[UPDATER] checkForUpdates falló:", e.message);
      // No molestar al usuario si no hay internet
    });
  }, 6000);
}

// ─── IPC handlers (renderer → main) ─────────────────────────────
ipcMain.on("updater:check", () => {
  if (!autoUpdater || !app.isPackaged) {
    sendUpdate("not-available", { currentVersion: app.getVersion(), dev: true });
    return;
  }
  autoUpdater.checkForUpdates().catch((e) => sendUpdate("error", { message: e.message }));
});

ipcMain.on("updater:install", () => {
  if (updateReady && autoUpdater) {
    log.info("[UPDATER] Instalando por solicitud del usuario...");
    autoUpdater.quitAndInstall(false, true);
  }
});

ipcMain.handle("updater:version", () => app.getVersion());

// ─── Ventana principal ──────────────────────────────────────────
function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation:            true,
      nodeIntegration:             false,
      sandbox:                     true,
      allowRunningInsecureContent: false,
      webSecurity:                 true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const { hostname } = new URL(url);
      if (hostname !== "localhost" && hostname !== "127.0.0.1") {
        log.warn("[SECURITY] Blocked:", url);
        event.preventDefault();
      }
    } catch (_) { event.preventDefault(); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.warn("[SECURITY] Blocked window.open:", url);
    return { action: "deny" };
  });

  mainWindow.loadURL(baseUrl);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    setupUpdater();
    startUpdateCheck();
  });
}

// ─── Arranque ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    log.info("[MAIN] Iniciando servidor...");
    const srv     = require("./services/server");
    const port    = srv?.getPort?.() || Number(process.env.PORT) || 3000;
    const baseUrl = `http://localhost:${port}`;

    await waitForHealth(baseUrl, 20000);
    log.info("[MAIN] Servidor OK →", baseUrl);
    createWindow(baseUrl);
  } catch (err) {
    log.error("[MAIN] Error de arranque:", err);
    dialog.showErrorBox(
      "No se pudo iniciar el sistema",
      "El servidor local no respondió.\n\nLogs en:\n" + LOG_DIR
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

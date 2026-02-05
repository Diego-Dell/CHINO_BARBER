const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const log = require("electron-log");
const { autoUpdater } = require("electron-updater");

log.transports.file.level = "info";
autoUpdater.logger = log;

// ✅ IMPORTANTE
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
let serverProcess = null;

const userData = app.getPath("userData");
const DB_DIR = path.join(userData, "db");
const LOG_DIR = path.join(userData, "logs");

process.env.DB_DIR = DB_DIR;
process.env.DB_PATH = path.join(DB_DIR, "database.sqlite");
process.env.APP_USER_DATA = userData;          // ✅ para server-port.txt
process.env.NODE_ENV = "production";

fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function httpGet(url, timeoutMs = 1000) {
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

function getServerPort() {
  // si usas puerto fijo 3000, dejalo fijo
  // si usas dinámico, leemos server-port.txt
  const portFile = path.join(userData, "server-port.txt");
  try {
    if (fs.existsSync(portFile)) {
      const p = Number(String(fs.readFileSync(portFile, "utf8")).trim());
      if (p > 0) return p;
    }
  } catch (_) {}
  return 3000; // fallback
}

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      const serverPath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar", "services", "server.js")
        : path.join(__dirname, "services", "server.js");

      log.info("Starting server:", serverPath);

      serverProcess = spawn(process.execPath, [serverPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        windowsHide: true,
      });

      serverProcess.stdout.on("data", (d) => log.info("[SERVER]", d.toString()));
      serverProcess.stderr.on("data", (d) => log.error("[SERVER ERROR]", d.toString()));

      serverProcess.on("error", (err) => {
        log.error("Server spawn error:", err);
        reject(err);
      });

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const port = getServerPort();
      const HEALTH_URL = `http://localhost:${port}/health`;
      const res = await httpGet(HEALTH_URL, 1200);
      if (res.status === 200) {
        try {
          const json = JSON.parse(res.data || "{}");
          if (json.ok) return true;
        } catch (_) {
          return true;
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Server did not respond in time");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });

  const port = getServerPort();
  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

// =====================
// ✅ UPDATE OBLIGATORIO
// =====================
function setupAutoUpdateMandatory() {
  autoUpdater.on("error", (err) => {
    log.error("Updater error:", err);
    // si falla el update, podés dejar entrar o cortar.
    // Para obligatorio estricto:
    // dialog.showErrorBox("Actualización", "No se pudo verificar actualización. Intenta más tarde.");
    // app.quit();
  });

  autoUpdater.on("update-available", async () => {
    log.info("Update available - mandatory");
    const r = dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Aceptar"],
      defaultId: 0,
      title: "Actualización obligatoria",
      message: "Hay una nueva versión disponible.",
      detail: "Se descargará e instalará automáticamente. La app se reiniciará.",
    });
    // no hay “cancelar”, es obligatorio
  });

  autoUpdater.on("download-progress", (p) => {
    log.info(`Download ${p.percent}%`);
  });

  autoUpdater.on("update-downloaded", async () => {
    log.info("Update downloaded - installing");
    dialog.showMessageBoxSync({
      type: "info",
      buttons: ["Reiniciar ahora"],
      defaultId: 0,
      title: "Actualización lista",
      message: "La actualización está lista.",
      detail: "Se reiniciará para instalarla.",
    });

    // ✅ instala y reinicia
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
}

// =====================
// START
// =====================
app.whenReady().then(async () => {
  try {
    setupAutoUpdateMandatory();

    // 1) Verifica update al abrir (ANTES de abrir tu app)
    // si querés que sea súper estricto:
    // - si hay update, se descargará y reiniciará, y tu app ni siquiera se abre
    await autoUpdater.checkForUpdates();

    // 2) Arranca backend y UI
    await startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    log.error("Startup error:", err);

    dialog.showErrorBox(
      "No se pudo iniciar el sistema",
      "El servidor local no respondió.\n\nRevisa estos logs:\n" +
        `${LOG_DIR}\\main.log\n${LOG_DIR}\\server.out.log\n${LOG_DIR}\\server.err.log\n`
    );
    app.quit();
  }
});

app.on("before-quit", () => {
  try {
    if (serverProcess) serverProcess.kill();
  } catch (_) {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

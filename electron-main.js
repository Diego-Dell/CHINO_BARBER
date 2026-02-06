// electron-main.js
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

const log = require("electron-log");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
} catch (_) {}

log.transports.file.level = "info";

let mainWindow = null;

const userData = app.getPath("userData");
const DB_DIR = path.join(userData, "db");
const LOG_DIR = path.join(userData, "logs");

fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// ENV para backend
process.env.APP_USER_DATA = userData;
process.env.DB_DIR = DB_DIR;
process.env.DB_PATH = path.join(DB_DIR, "database.sqlite");
process.env.NODE_ENV = "production";

// En dev usamos 3000 fijo
process.env.PORT = app.isPackaged ? "0" : "3000";

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
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Server no respondió /health: ${url}`);
}

function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });

  mainWindow.loadURL(baseUrl);
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

async function checkUpdateOnStart() {
  // ✅ ACTUALIZACIÓN OBLIGATORIA AL INICIAR
  // - Verifica si existe una versión más nueva.
  // - Si hay, AVISA al usuario (pero NO es opcional).
  // - Descarga automáticamente y luego pide reiniciar para instalar.
  // - Si el usuario no reinicia, se cierra la app (para forzar la actualización).
  if (!autoUpdater) return;

  // Clave: descarga automática (obligatoria)
  autoUpdater.autoDownload = true;

  // Evita listeners duplicados si se llama más de una vez
  autoUpdater.removeAllListeners();

  // Promesa para bloquear el arranque normal hasta confirmar "no hay update"
  // o hasta que la app se reinicie por instalación.
  const gate = new Promise((resolve, reject) => {
    autoUpdater.on("error", (err) => {
      log.error("Updater error:", err);
      // Si falla el updater, dejamos usar la app (no brickeamos por un error de red)
      resolve();
    });

    autoUpdater.on("update-not-available", () => {
      resolve();
    });

    autoUpdater.on("update-available", (info) => {
      const current = app.getVersion();
      const available = info?.version || "(desconocida)";

      dialog.showMessageBoxSync({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Actualización obligatoria",
        message: `Tu versión: ${current}\nNueva versión: ${available}`,
        detail:
          "Se descargará la actualización ahora. Al terminar, tendrás que reiniciar para instalarla.",
      });
      // La descarga empieza sola por autoDownload=true
    });

    autoUpdater.on("update-downloaded", () => {
      dialog.showMessageBoxSync({
        type: "info",
        buttons: ["Reiniciar e instalar"],
        defaultId: 0,
        title: "Actualización lista",
        message: "La actualización ya se descargó.",
        detail: "La aplicación se reiniciará para instalar la nueva versión.",
      });

      // Instalación obligatoria
      autoUpdater.quitAndInstall();

      // Por si algo raro impide el reinicio, no seguimos con el arranque normal
      // (aunque normalmente aquí la app ya se está cerrando).
      setTimeout(() => {
        try {
          app.quit();
        } catch (_) {}
      }, 1500);
    });
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    log.error("checkForUpdates failed:", e);
  }

  await gate;
}

app.whenReady().then(async () => {
  try {
    // ✅ 1) Revisar actualización al iniciar (antes de abrir la app)
    // Si hay una nueva versión, se fuerza la descarga e instalación.
    if (app.isPackaged) {
      await checkUpdateOnStart();
    }

    // ✅ Iniciar server en el MISMO proceso (evita líos de asar/spawn/rutas)
    log.info("Starting server (same process)...");
    const srv = require("./services/server"); // <- server.js debe estar en /services

    const port = (srv && typeof srv.getPort === "function") ? srv.getPort() : (Number(process.env.PORT)||3000);

    const baseUrl = `http://localhost:${port}`;
    await waitForHealth(baseUrl, 20000);
    createWindow(baseUrl);
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
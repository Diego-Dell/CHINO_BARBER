const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");

log.transports.file.level = "info";

process.env.NODE_ENV = "production";

const userData = app.getPath("userData");
process.env.DB_DIR = path.join(userData, "db");
process.env.DB_PATH = path.join(process.env.DB_DIR, "database.sqlite");

fs.mkdirSync(process.env.DB_DIR, { recursive: true });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true
  });

  mainWindow.loadURL("http://localhost:3000");
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

app.whenReady().then(() => {
  try {
    require("./services/server"); // 👈 CLAVE
    createWindow();
  } catch (err) {
    log.error(err);
    dialog.showErrorBox("Error", err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

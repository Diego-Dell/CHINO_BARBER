// preload.js — Con contextIsolation=true, sandbox=true
// Este archivo corre en un contexto privilegiado ANTES de la página.
// Expone APIs seguras al renderer vía contextBridge.

const { contextBridge, ipcRenderer } = require("electron");

// ─── Info de la app ─────────────────────────────────────────────
contextBridge.exposeInMainWorld("appInfo", {
  platform: process.platform,
  // Versión se obtiene vía IPC para no hardcodear
  getVersion: () => ipcRenderer.invoke("updater:version"),
});

// ─── API de auto-update ─────────────────────────────────────────
// El renderer llama estos métodos; el main process gestiona todo.
contextBridge.exposeInMainWorld("updater", {
  /**
   * Registra un callback que recibe eventos de actualización.
   * El callback recibe: { event, ...payload }
   * Eventos posibles:
   *   "checking"      — buscando actualización
   *   "available"     — { version, releaseDate }
   *   "not-available" — { currentVersion }
   *   "progress"      — { percent, bytesPerSecond, total }
   *   "downloaded"    — { version }
   *   "error"         — { message }
   */
  onStatus(callback) {
    // Limpiamos listener anterior para evitar duplicados
    ipcRenderer.removeAllListeners("updater:event");
    ipcRenderer.on("updater:event", (_event, data) => {
      try { callback(data); } catch (e) { console.error("[UPDATER UI]", e); }
    });
  },

  /** Pide al main que verifique actualizaciones ahora */
  checkNow() {
    ipcRenderer.send("updater:check");
  },

  /** Pide al main que reinicie e instale la actualización descargada */
  quitAndInstall() {
    ipcRenderer.send("updater:install");
  },
});

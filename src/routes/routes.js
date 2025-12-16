// src/routes/routes.js
// Router central de la API. Se monta en el server como: app.use("/api", router)

const express = require("express");
const router = express.Router();

// ===============================
// Middleware base API
// ===============================
router.use((req, res, next) => {
  // Evita cache raro del navegador en endpoints API
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ===============================
// Diagnóstico
// ===============================
router.get("/health", (req, res) => {
  return res.json({
    ok: true,
    service: "api",
    time: new Date().toISOString(),
  });
});

router.get("/whoami", (req, res) => {
  const user = req.session && req.session.user ? req.session.user : null;
  return res.json({ ok: true, data: { user } });
});

// ===============================
// Montaje de módulos (CRÍTICO)
// Cada módulo exporta un router con rutas relativas ("/").
// Aquí definimos los prefijos.
// ===============================
function loadModule(file, envFlag) {
  // Permite desactivar módulos por env (opcional):
  // DISABLE_MODULE_ALUMNOS=true, DISABLE_MODULE_PAGOS=true, etc.
  if (envFlag && String(process.env[envFlag] || "").toLowerCase() === "true") {
    console.warn(`[API] Module disabled by env: ${file} (${envFlag}=true)`);
    return null;
  }

  try {
    return require(file);
  } catch (err) {
    // Error claro al iniciar (por defecto)
    const allowMissing = String(process.env.ALLOW_MISSING_MODULES || "").toLowerCase() === "true";
    const msg = `[API] Failed to load module: ${file} -> ${err.message}`;
    if (allowMissing) {
      console.error(msg);
      return null;
    }
    throw new Error(msg);
  }
}

// auth primero (para login/me/logout)
const authRouter = loadModule("./auth.routes.js", "DISABLE_MODULE_AUTH");
if (authRouter) router.use("/auth", authRouter);

const alumnosRouter = loadModule("./alumnos.routes.js", "DISABLE_MODULE_ALUMNOS");
if (alumnosRouter) router.use("/alumnos", alumnosRouter);

const instructoresRouter = loadModule("./instructores.routes.js", "DISABLE_MODULE_INSTRUCTORES");
if (instructoresRouter) router.use("/instructores", instructoresRouter);

const cursosRouter = loadModule("./cursos.routes.js", "DISABLE_MODULE_CURSOS");
if (cursosRouter) router.use("/cursos", cursosRouter);

const inscripcionesRouter = loadModule("./inscripciones.routes.js", "DISABLE_MODULE_INSCRIPCIONES");
if (inscripcionesRouter) router.use("/inscripciones", inscripcionesRouter);

const asistenciaRouter = loadModule("./asistencia.routes.js", "DISABLE_MODULE_ASISTENCIA");
if (asistenciaRouter) router.use("/asistencia", asistenciaRouter);

const pagosRouter = loadModule("./pagos.routes.js", "DISABLE_MODULE_PAGOS");
if (pagosRouter) router.use("/pagos", pagosRouter);

const egresosRouter = loadModule("./egresos.routes.js", "DISABLE_MODULE_EGRESOS");
if (egresosRouter) router.use("/egresos", egresosRouter);

const inventarioRouter = loadModule("./inventario.routes.js", "DISABLE_MODULE_INVENTARIO");
if (inventarioRouter) router.use("/inventario", inventarioRouter);

const agendaRouter = loadModule("./agenda.routes.js", "DISABLE_MODULE_AGENDA");
if (agendaRouter) router.use("/agenda", agendaRouter);

const reportesRouter = loadModule("./reportes.routes.js", "DISABLE_MODULE_REPORTES");
if (reportesRouter) router.use("/reportes", reportesRouter);

const settingsRouter = loadModule("./settings.routes.js", "DISABLE_MODULE_SETTINGS");
if (settingsRouter) router.use("/settings", settingsRouter);

// ===============================
// 404 API (solo dentro de /api)
// ===============================
router.use((req, res) => {
  return res.status(404).json({ ok: false, error: "API route not found" });
});

// Nota: NO ponemos error-handler (4 args) aquí porque ya existe uno global en services/server.js.
// Si quisieras tener uno aquí, asegúrate de no duplicar la lógica (para evitar doble respuesta).

module.exports = router;

/*
Uso en services/server.js:
  app.use("/api", require("./src/routes/routes"));

Cada módulo (*.routes.js) define rutas relativas (ej: router.get("/")),
por eso aquí se define el prefijo (/alumnos, /cursos, etc.).

Diagnóstico:
- GET /api/health  -> verifica que la API responde
- GET /api/whoami  -> verifica sesión (req.session.user) sin fallar si no hay login
*/

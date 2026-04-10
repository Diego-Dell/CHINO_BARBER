const { logError } = require("./apiError");

async function writeAuditError(req, err) {
  try {
    const { writeLog } = require("../lib/auditLog");
    await writeLog(
      "api_error",
      JSON.stringify({
        method: req.method,
        path: req.path,
        query: req.query || {},
        message: err && err.message ? err.message : String(err),
      }),
      "sistema"
    );
  } catch (_) {}
}

function apiNotFound(req, res, next) {
  if (req.path && req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  return next();
}

function apiErrorMiddleware(err, req, res, next) {
  const isApi = req.path && req.path.startsWith("/api/");
  const prod = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const msg = err && err.message ? err.message : "Server error";

  try { logError(req, err, 500); } catch (_) {}
  writeAuditError(req, err).catch(() => {});

  if (isApi) {
    return res.status(500).json({ ok: false, error: prod ? "Error interno del servidor" : msg });
  }
  return res.status(500).send(prod ? "Internal server error" : msg);
}

module.exports = { apiNotFound, apiErrorMiddleware };


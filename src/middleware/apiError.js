/**
 * Respuestas JSON uniformes y logging de errores API.
 */
function logError(req, err, status = 500) {
  const msg = err && err.message ? err.message : String(err);
  console.error(`[API][${status}] ${req.method} ${req.path}:`, msg);
  if (err && err.stack && status >= 500) console.error(err.stack);
}

function sendError(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      logError(req, err, 500);
      const prod = String(process.env.NODE_ENV || "").toLowerCase() === "production";
      return res.status(500).json({
        ok: false,
        error: prod ? "Error interno del servidor" : (err && err.message) || "Error",
      });
    });
  };
}

module.exports = { logError, sendError, asyncHandler };

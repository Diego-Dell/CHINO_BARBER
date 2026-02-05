// src/routes/pagos.routes.js
// Pagos (SIN LOGIN / SIN SESIONES)
// IMPORTANTE: NO destructurar db.all/get/run (causa "Database object expected")

const express = require("express");
const db = require("../db");
const router = express.Router();

// ===== helpers sqlite (promesas) =====
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function normStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

// ===== esquema dinámico pagos =====
let _PAGOS_COLS = null;

async function getPagosCols() {
  if (_PAGOS_COLS) return _PAGOS_COLS;
  const rows = await dbAll("PRAGMA table_info(pagos)");
  _PAGOS_COLS = new Set(rows.map((r) => String(r.name || "").toLowerCase()));
  return _PAGOS_COLS;
}

function pickFechaCol(cols) {
  // prioridad: fecha -> fecha_pago -> fechaPago -> created_at
  const candidates = ["fecha", "fecha_pago", "fechapago", "created_at", "createdat"];
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}

// util: alumno documento puede variar (documento / ci)
let _ALUMNOS_COLS = null;
async function getAlumnosCols() {
  if (_ALUMNOS_COLS) return _ALUMNOS_COLS;
  const rows = await dbAll("PRAGMA table_info(alumnos)");
  _ALUMNOS_COLS = new Set(rows.map((r) => String(r.name || "").toLowerCase()));
  return _ALUMNOS_COLS;
}
function pickAlumnoDocCol(cols) {
  const candidates = ["documento", "ci", "cedula", "dni"];
  for (const c of candidates) if (cols.has(c)) return c;
  return "documento";
}

// ===============================
// GET /api/pagos?buscar=&estado=&mes=YYYY-MM
// ===============================
router.get("/", async (req, res) => {
  try {
    const buscar = normStr(req.query.buscar || req.query.q);
    const estado = normStr(req.query.estado);
    const mes = normStr(req.query.mes); // YYYY-MM

    const pagosCols = await getPagosCols();
    const fechaCol = pickFechaCol(pagosCols);
    if (!fechaCol) {
      // si no hay ninguna columna tipo fecha, devolvemos igual pero sin filtro por mes
      console.warn("[PAGOS] No se encontró columna fecha en tabla pagos.");
    }

    const alumnosCols = await getAlumnosCols();
    const alumnoDocCol = pickAlumnoDocCol(alumnosCols);

    const where = [];
    const params = [];

    if (buscar) {
      where.push(`(
        lower(a.nombre) LIKE lower(?) OR
        lower(a.${alumnoDocCol}) LIKE lower(?) OR
        lower(c.nombre) LIKE lower(?)
      )`);
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    if (estado) {
      where.push(`p.estado = ?`);
      params.push(estado);
    }

    if (mes && fechaCol) {
      // filtra por mes: YYYY-MM
      where.push(`substr(p.${fechaCol}, 1, 7) = ?`);
      params.push(mes);
    }

    // SELECT fecha "normalizada" como p_fecha para front
    const fechaSelect = fechaCol ? `p.${fechaCol} AS fecha` : `NULL AS fecha`;
    const orderBy = fechaCol ? `p.${fechaCol} DESC, p.id DESC` : `p.id DESC`;

    // Observaciones puede variar (observaciones / obs)
    const obsCol = pagosCols.has("observaciones")
      ? "observaciones"
      : pagosCols.has("obs")
        ? "obs"
        : null;

    const obsSelect = obsCol ? `p.${obsCol} AS observaciones` : `NULL AS observaciones`;

    const sql = `
      SELECT
        p.id,
        p.inscripcion_id,
        ${fechaSelect},
        p.monto,
        p.estado,
        p.metodo,
        ${obsSelect},
        ${pagosCols.has("created_at") ? "p.created_at" : "NULL AS created_at"},

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.${alumnoDocCol} AS alumno_documento,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        ${(() => {
          // por si cursos no tiene precio, no rompe
          return "c.precio AS curso_precio";
        })()}

      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos c ON c.id = i.curso_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${orderBy}
      LIMIT 500
    `;

    const rows = await dbAll(sql, params);
    return res.json(rows); // 👈 mantiene tu formato (array)
  } catch (err) {
    console.error("[/api/pagos] GET error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error" });
  }
});

// ===============================
// POST /api/pagos
// body: { inscripcion_id, fecha, monto, estado, metodo, observaciones }
// ===============================
router.post("/", async (req, res) => {
  try {
    const pagosCols = await getPagosCols();
    const fechaCol = pickFechaCol(pagosCols);

    const inscripcion_id = toNum(req.body.inscripcion_id, 0);

    // acepta fecha o fecha_pago desde el front
    const fechaIn = normStr(req.body.fecha || req.body.fecha_pago || req.body.fechaPago);

    const monto = toNum(req.body.monto, NaN);
    const estado = normStr(req.body.estado) || "Pagado";
    const metodo = normStr(req.body.metodo) || "Efectivo";
    const observaciones = normStr(req.body.observaciones || req.body.obs);

    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id es requerido" });
    }
    if (!Number.isFinite(monto)) {
      return res.status(400).json({ ok: false, error: "Monto inválido" });
    }

    // Si existe columna fecha, debe venir en ISO. Si NO existe, seguimos (se guardará en created_at o no se guardará).
    if (fechaCol && fechaCol !== "created_at" && !isISODate(fechaIn)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida (usa YYYY-MM-DD)" });
    }

    // validar que exista la inscripción
    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }

    // observaciones/obs según columna existente
    const obsCol = pagosCols.has("observaciones")
      ? "observaciones"
      : pagosCols.has("obs")
        ? "obs"
        : null;

    // INSERT dinámico según columnas reales
    const fields = ["inscripcion_id"];
    const qs = ["?"];
    const vals = [inscripcion_id];

    if (fechaCol && fechaCol !== "created_at") {
      fields.push(fechaCol);
      qs.push("?");
      vals.push(fechaIn);
    } else if (pagosCols.has("fecha")) {
      // fallback por si pick falló raro
      fields.push("fecha");
      qs.push("?");
      vals.push(fechaIn);
    }

    fields.push("monto");
    qs.push("?");
    vals.push(monto);

    if (pagosCols.has("estado")) {
      fields.push("estado");
      qs.push("?");
      vals.push(estado);
    }
    if (pagosCols.has("metodo")) {
      fields.push("metodo");
      qs.push("?");
      vals.push(metodo);
    }
    if (obsCol) {
      fields.push(obsCol);
      qs.push("?");
      vals.push(observaciones || null);
    }

    const sqlIns = `INSERT INTO pagos (${fields.join(", ")}) VALUES (${qs.join(", ")})`;

    const r = await dbRun(sqlIns, vals);

    const created = await dbGet(`SELECT * FROM pagos WHERE id = ?`, [r.lastID]);
    return res.json({ ok: true, pago: created });
  } catch (err) {
    console.error("[/api/pagos] POST error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error" });
  }
});

// ===============================
// DELETE /api/pagos/:id
// ===============================
router.delete("/:id", async (req, res) => {
  try {
    const id = toNum(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const r = await dbRun(`DELETE FROM pagos WHERE id = ?`, [id]);
    return res.json({ ok: true, changes: r.changes });
  } catch (err) {
    console.error("[/api/pagos] DELETE error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error" });
  }
});

module.exports = router;

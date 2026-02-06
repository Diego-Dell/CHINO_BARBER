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

// ===============================
// GET /api/pagos?buscar=&estado=&mes=YYYY-MM
// ===============================
router.get("/", async (req, res) => {
  try {
    const buscar = normStr(req.query.buscar || req.query.q);
    const estado = normStr(req.query.estado);
    const mes = normStr(req.query.mes); // YYYY-MM

    const where = [];
    const params = [];

    if (buscar) {
      where.push(`(
        lower(a.nombre) LIKE lower(?) OR
        lower(a.documento) LIKE lower(?) OR
        lower(c.nombre) LIKE lower(?)
      )`);
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    if (estado) {
      where.push(`p.estado = ?`);
      params.push(estado);
    }

    if (mes) {
      // filtra por mes de fecha_pago: YYYY-MM
      where.push(`substr(p.fecha_pago, 1, 7) = ?`);
      params.push(mes);
    }

    const sql = `
      SELECT
        p.id,
        p.inscripcion_id,
        p.fecha_pago AS fecha,
        p.monto,
        p.estado,
        p.metodo,
        p.observaciones,
        p.created_at,

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        c.precio AS curso_precio

      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos c ON c.id = i.curso_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY p.fecha_pago DESC, p.id DESC
      LIMIT 500
    `;

    const rows = await dbAll(sql, params);
    return res.json(rows);
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
    const inscripcion_id = toNum(req.body.inscripcion_id, 0);
    const fecha = normStr(req.body.fecha || req.body.fecha_pago);
    const monto = toNum(req.body.monto, NaN);
    const estado = normStr(req.body.estado) || "Pagado";
    const metodo = normStr(req.body.metodo) || "Efectivo";
    const observaciones = normStr(req.body.observaciones);

    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id es requerido" });
    }
    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida (usa YYYY-MM-DD)" });
    }
    if (!Number.isFinite(monto)) {
      return res.status(400).json({ ok: false, error: "Monto inválido" });
    }

    // validar que exista la inscripción
    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }

    const r = await dbRun(
      `INSERT INTO pagos (inscripcion_id, fecha_pago, monto, estado, metodo, observaciones)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [inscripcion_id, fecha, monto, estado, metodo, observaciones]
    );

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

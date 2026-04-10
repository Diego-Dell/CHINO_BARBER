// src/routes/pagos.routes.js — Pagos: sin DELETE físico; anulación = estado = 'anulado'.

const express = require("express");
const db = require("../db");
const { writeLog } = require("../lib/auditLog");
const { sqlPagoCuentaFinanciera } = require("../lib/pagosSql");
const { buildResumenQuery } = require("../services/pagosFinanceService");

const router = express.Router();

const FECHA_ANUL_BO = "date('now', '-4 hours')";

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
function isISOMonth(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}
function nextMonthStart(yyyyMm) {
  const [y, m] = String(yyyyMm).split("-").map((x) => Number(x));
  const year = y + (m >= 12 ? 1 : 0);
  const month = m >= 12 ? 1 : (m + 1);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

const COBRO_ESTADOS = new Set(["Pagado", "Pendiente"]);
const PAGO_METODOS = new Set(["Efectivo", "Transferencia", "QR", "Tarjeta", "Otro"]);

// GET /api/pagos/inscripcion/:inscripcion_id/resumen — saldo desde BD (centavos)
router.get("/inscripcion/:inscripcion_id/resumen", async (req, res) => {
  try {
    const inscripcion_id = toNum(req.params.inscripcion_id, 0);
    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id inválido" });
    }
    const row = await dbGet(buildResumenQuery(), [inscripcion_id]);
    if (!row) {
      return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    }
    const precio = Number(row.precio_centavos || 0);
    const pagado = Number(row.pagado_centavos || 0);
    const saldo = Math.max(0, precio - pagado);
    return res.json({
      ok: true,
      inscripcion_id,
      precio_centavos: precio,
      pagado_centavos: pagado,
      saldo_centavos: saldo,
      precio: precio / 100,
      pagado: pagado / 100,
      saldo: saldo / 100,
    });
  } catch (err) {
    console.error("[GET /api/pagos/.../resumen]", err);
    return res.status(500).json({ ok: false, error: err.message || "Error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const buscar = normStr(req.query.buscar || req.query.q);
    const cobro_estado = normStr(req.query.cobro_estado || req.query.cobro);
    const vida = normStr(req.query.vida || req.query.estado_vida);
    const mes = normStr(req.query.mes);

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

    if (cobro_estado) {
      if (!COBRO_ESTADOS.has(cobro_estado) && cobro_estado !== "Anulado") {
        return res.status(400).json({ ok: false, error: "cobro_estado inválido" });
      }
      where.push(`p.cobro_estado = ?`);
      params.push(cobro_estado);
    }

    if (vida) {
      if (vida !== "activo" && vida !== "anulado") {
        return res.status(400).json({ ok: false, error: "estado (vida) inválido" });
      }
      where.push(`p.estado = ?`);
      params.push(vida);
    }

    if (mes) {
      if (!isISOMonth(mes)) {
        return res.status(400).json({ ok: false, error: "Mes inválido (usa YYYY-MM)" });
      }
      const start = `${mes}-01`;
      const end = nextMonthStart(mes);
      where.push(`p.fecha_pago >= ? AND p.fecha_pago < ?`);
      params.push(start, end);
    }

    const sql = `
      SELECT
        p.id,
        p.inscripcion_id,
        p.fecha_pago AS fecha,
        p.monto_centavos,
        (COALESCE(p.monto_centavos, CAST(ROUND(p.monto * 100) AS INTEGER)) / 100.0) AS monto,
        p.cuota_nro,
        p.estado,
        p.cobro_estado,
        p.metodo,
        p.observaciones,
        p.motivo_anulacion,
        p.fecha_anulacion,
        p.created_at,

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        COALESCE(c.precio_centavos, CAST(ROUND(c.precio * 100) AS INTEGER)) AS curso_precio_centavos,
        (COALESCE(c.precio_centavos, CAST(ROUND(c.precio * 100) AS INTEGER)) / 100.0) AS curso_precio

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
    console.error("[GET /api/pagos] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al cargar pagos" });
  }
});

router.post("/", async (req, res) => {
  try {
    const inscripcion_id = toNum(req.body.inscripcion_id, 0);
    const fecha = normStr(req.body.fecha || req.body.fecha_pago);
    const monto = toNum(req.body.monto, NaN);
    const cobro_estado = normStr(req.body.cobro_estado || req.body.estado_cobro) || "Pagado";
    const metodo = normStr(req.body.metodo) || "Efectivo";
    const observaciones = normStr(req.body.observaciones);
    const cuota_nro_raw = req.body.cuota_nro;
    const cuota_nro =
      cuota_nro_raw === undefined || cuota_nro_raw === null || String(cuota_nro_raw).trim() === ""
        ? null
        : Math.trunc(toNum(cuota_nro_raw, NaN));

    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id es requerido" });
    }
    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida (usa YYYY-MM-DD)" });
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ ok: false, error: "Monto debe ser > 0" });
    }
    if (!COBRO_ESTADOS.has(cobro_estado)) {
      return res.status(400).json({ ok: false, error: "cobro_estado inválido (Pagado|Pendiente)" });
    }
    if (!PAGO_METODOS.has(metodo)) {
      return res.status(400).json({ ok: false, error: "Método inválido" });
    }
    if (cuota_nro !== null) {
      if (!Number.isFinite(cuota_nro) || cuota_nro < 1) {
        return res.status(400).json({ ok: false, error: "cuota_nro inválido" });
      }
    }

    const insc = await dbGet(
      `SELECT id, alumno_id, COALESCE(nro_cuotas, 1) AS nro_cuotas FROM inscripciones WHERE id = ?`,
      [inscripcion_id]
    );
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }
    const alumnoOk = await dbGet(`SELECT id FROM alumnos WHERE id = ?`, [insc.alumno_id]);
    if (!alumnoOk) {
      return res.status(400).json({ ok: false, error: "Alumno de la inscripción no existe" });
    }
    if (cuota_nro !== null && cuota_nro > Number(insc.nro_cuotas || 1)) {
      return res.status(400).json({ ok: false, error: "cuota_nro excede el plan de cuotas de la inscripción" });
    }

    const monto_centavos = Math.round(monto * 100);

    await dbRun("BEGIN IMMEDIATE");
    try {
      let dup = null;
      if (cuota_nro !== null && cobro_estado === "Pagado") {
        dup = await dbGet(
          `SELECT id FROM pagos
           WHERE inscripcion_id = ?
             AND cuota_nro = ?
             AND ${sqlPagoCuentaFinanciera("pagos")}
           LIMIT 1`,
          [inscripcion_id, cuota_nro]
        );
      } else if (cobro_estado === "Pagado") {
        dup = await dbGet(
          `SELECT id FROM pagos
           WHERE inscripcion_id = ?
             AND fecha_pago = ?
             AND monto = ?
             AND metodo = ?
             AND COALESCE(observaciones,'') = ?
             AND ${sqlPagoCuentaFinanciera("pagos")}
           LIMIT 1`,
          [inscripcion_id, fecha, monto, metodo, observaciones]
        );
      }
      if (dup) {
        await dbRun("ROLLBACK").catch(() => {});
        return res.status(409).json({ ok: false, error: "Pago duplicado detectado. Verifica la cuota/fecha." });
      }

      const r = await dbRun(
        `INSERT INTO pagos (inscripcion_id, fecha_pago, monto, monto_centavos, cuota_nro, estado, cobro_estado, metodo, observaciones)
         VALUES (?, ?, ?, ?, ?, 'activo', ?, ?, ?)`,
        [inscripcion_id, fecha, monto, monto_centavos, cuota_nro, cobro_estado, metodo, observaciones]
      );

      const created = await dbGet(`SELECT * FROM pagos WHERE id = ?`, [r.lastID]);
      await writeLog(
        "pago_creado",
        JSON.stringify({
          pago_id: r.lastID,
          inscripcion_id,
          monto_centavos,
          fecha_pago: fecha,
          cuota_nro,
        }),
        "admin"
      );
      await dbRun("COMMIT");
      return res.json({ ok: true, pago: created });
    } catch (e) {
      await dbRun("ROLLBACK").catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error("[POST /api/pagos] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al registrar pago" });
  }
});

router.post("/reset-plan", async (req, res) => {
  try {
    const inscripcion_id = toNum(req.body?.inscripcion_id, 0);
    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id requerido" });
    }

    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }

    await dbRun("BEGIN IMMEDIATE");
    try {
      const motivo = "Cambio de plan de cuotas";
      const r = await dbRun(
        `UPDATE pagos
         SET estado = 'anulado',
             motivo_anulacion = COALESCE(motivo_anulacion, ?),
             fecha_anulacion = COALESCE(fecha_anulacion, ${FECHA_ANUL_BO}),
             updated_at = datetime('now')
         WHERE inscripcion_id = ? AND estado = 'activo'`,
        [motivo, inscripcion_id]
      );
      await writeLog("pagos_plan_reset", JSON.stringify({ inscripcion_id, changes: r.changes || 0 }), "admin");
      await dbRun("COMMIT");
      return res.json({ ok: true, changes: r.changes || 0 });
    } catch (err) {
      await dbRun("ROLLBACK").catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("[POST /api/pagos/reset-plan] error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al resetear plan" });
  }
});

async function anularPagoHandler(req, res) {
  try {
    const id = toNum(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });
    const motivo = normStr(req.body?.motivo);
    if (motivo.length < 2) {
      return res.status(400).json({ ok: false, error: "Motivo de anulación requerido" });
    }

    await dbRun("BEGIN IMMEDIATE");
    try {
      const current = await dbGet(`SELECT id, estado FROM pagos WHERE id = ?`, [id]);
      if (!current) {
        await dbRun("ROLLBACK").catch(() => {});
        return res.status(404).json({ ok: false, error: "Pago no encontrado" });
      }
      if (String(current.estado) === "anulado") {
        await dbRun("ROLLBACK").catch(() => {});
        return res.json({ ok: true, changes: 0 });
      }

      const before = await dbGet(
        `SELECT id, inscripcion_id, estado, cobro_estado, monto_centavos, monto, fecha_pago, motivo_anulacion, fecha_anulacion
         FROM pagos WHERE id = ?`,
        [id]
      );

      await dbRun(
        `UPDATE pagos
         SET estado = 'anulado',
             motivo_anulacion = ?,
             fecha_anulacion = ${FECHA_ANUL_BO},
             updated_at = datetime('now')
         WHERE id = ?`,
        [motivo, id]
      );
      try {
        const after = await dbGet(
          `SELECT id, inscripcion_id, estado, cobro_estado, monto_centavos, monto, fecha_pago, motivo_anulacion, fecha_anulacion
           FROM pagos WHERE id = ?`,
          [id]
        );
        const { writeAudit } = require("../lib/auditLog");
        await writeAudit({
          accion: "pago_anulado",
          entidad: "pago",
          entidad_id: id,
          before,
          after,
          extra: { motivo },
          actor: "admin",
        });
      } catch (_) {
        await writeLog("pago_anulado", JSON.stringify({ pago_id: id, motivo }), "admin");
      }
      await dbRun("COMMIT");
      return res.json({ ok: true, changes: 1 });
    } catch (e) {
      await dbRun("ROLLBACK").catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error("[PUT/POST /api/pagos/:id/anular] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al anular pago" });
  }
}

router.put("/:id/anular", anularPagoHandler);
router.post("/:id/anular", anularPagoHandler);

// Política: NO se permite editar pagos. Solo crear o anular.
router.put("/:id", async (_req, res) => {
  return res.status(405).json({ ok: false, error: "Edición de pagos no permitida. Use crear o anular." });
});
router.patch("/:id", async (_req, res) => {
  return res.status(405).json({ ok: false, error: "Edición de pagos no permitida. Use crear o anular." });
});

module.exports = router;

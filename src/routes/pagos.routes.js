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

function isISOMonth(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function nextMonthStart(yyyyMm) {
  const [y, m] = String(yyyyMm).split("-").map((x) => Number(x));
  const year = y + (m >= 12 ? 1 : 0);
  const month = m >= 12 ? 1 : (m + 1);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

const PAGO_ESTADOS = new Set(["Pagado", "Pendiente", "Anulado"]);
const PAGO_METODOS = new Set(["Efectivo", "Transferencia", "QR", "Tarjeta", "Otro"]);

// ===============================
// GET /api/pagos?q=&estado=&mes=YYYY-MM
// Query params:
//   - q o buscar: búsqueda por nombre/CI del alumno o nombre del curso
//   - estado: filtrar por estado del pago (Pagado, Pendiente, Anulado, etc)
//   - mes: filtrar por mes (YYYY-MM format)
// ===============================
router.get("/", async (req, res) => {
  try {
    // Aceptamos q O buscar (para compatibilidad con frontend)
    const buscar = normStr(req.query.buscar || req.query.q);
    const estado = normStr(req.query.estado);
    const mes = normStr(req.query.mes); // YYYY-MM

    const where = [];
    const params = [];

    // FILTRO: búsqueda por nombre alumno, documento alumno, o nombre curso
    if (buscar) {
      where.push(`(
        lower(a.nombre) LIKE lower(?) OR
        lower(a.documento) LIKE lower(?) OR
        lower(c.nombre) LIKE lower(?)
      )`);
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    // FILTRO: estado del pago (Pagado, Pendiente, Anulado, etc)
    if (estado) {
      if (!PAGO_ESTADOS.has(estado)) {
        return res.status(400).json({ ok: false, error: "Estado inválido" });
      }
      where.push(`p.estado = ?`);
      params.push(estado);
    }

    // FILTRO: mes de fecha_pago (YYYY-MM)
    if (mes) {
      if (!isISOMonth(mes)) {
        return res.status(400).json({ ok: false, error: "Mes inválido (usa YYYY-MM)" });
      }
      const start = `${mes}-01`;
      const end = nextMonthStart(mes);
      where.push(`p.fecha_pago >= ? AND p.fecha_pago < ?`);
      params.push(start, end);
    }

    // SQL: JOIN pagos → inscripciones → alumnos y cursos
    // Devuelve información completa del pago con datos del alumno y curso
    const sql = `
      SELECT
        p.id,
        p.inscripcion_id,
        p.fecha_pago AS fecha,
        p.monto,
        p.cuota_nro,
        p.estado,
        p.metodo,
        p.observaciones,
        p.anulado_motivo,
        p.anulado_at,
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
    // ✅ Devolver array directo (frontend espera esto)
    return res.json(rows);
  } catch (err) {
    console.error("[GET /api/pagos] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al cargar pagos" });
  }
});

// ===============================
// POST /api/pagos
// Registra un nuevo pago
// Body:
//   {
//     inscripcion_id: number (requerido),
//     fecha: string "YYYY-MM-DD" (requerido),
//     monto: number > 0 (requerido),
//     estado: string (default: "Pagado"),
//     metodo: string (default: "Efectivo"),
//     observaciones: string (opcional)
//   }
// ===============================
router.post("/", async (req, res) => {
  try {
    const inscripcion_id = toNum(req.body.inscripcion_id, 0);
    const fecha = normStr(req.body.fecha || req.body.fecha_pago);
    const monto = toNum(req.body.monto, NaN);
    const estado = normStr(req.body.estado) || "Pagado";
    const metodo = normStr(req.body.metodo) || "Efectivo";
    const observaciones = normStr(req.body.observaciones);
    const cuota_nro_raw = req.body.cuota_nro;
    const cuota_nro = cuota_nro_raw === undefined || cuota_nro_raw === null || String(cuota_nro_raw).trim() === ""
      ? null
      : Math.trunc(toNum(cuota_nro_raw, NaN));

    // Validación: inscripcion_id requerido
    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id es requerido" });
    }

    // Validación: fecha válida
    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida (usa YYYY-MM-DD)" });
    }

    // Validación: monto válido
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ ok: false, error: "Monto debe ser > 0" });
    }

    if (!PAGO_ESTADOS.has(estado)) {
      return res.status(400).json({ ok: false, error: "Estado inválido" });
    }
    if (!PAGO_METODOS.has(metodo)) {
      return res.status(400).json({ ok: false, error: "Método inválido" });
    }

    if (cuota_nro !== null) {
      if (!Number.isFinite(cuota_nro) || cuota_nro < 1) {
        return res.status(400).json({ ok: false, error: "cuota_nro inválido" });
      }
    }

    // Validación: verificar que la inscripción existe
    const insc = await dbGet(`SELECT id, COALESCE(nro_cuotas, 1) AS nro_cuotas FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }

    if (cuota_nro !== null && cuota_nro > Number(insc.nro_cuotas || 1)) {
      return res.status(400).json({ ok: false, error: "cuota_nro excede el plan de cuotas de la inscripción" });
    }

    // Transacción: validación + inserción consistente
    await dbRun("BEGIN IMMEDIATE");
    try {
      // Anti-duplicado robusto:
      // - Si viene cuota_nro: una cuota pagada por inscripción (estado Pagado) no puede repetirse.
      // - Si no viene cuota_nro: evitamos duplicado exacto por (insc, fecha, monto, metodo, obs) solo cuando estado=Pagado.
      let dup = null;
      if (cuota_nro !== null && estado === "Pagado") {
        dup = await dbGet(
          `SELECT id FROM pagos
           WHERE inscripcion_id = ?
             AND cuota_nro = ?
             AND estado = 'Pagado'
           LIMIT 1`,
          [inscripcion_id, cuota_nro]
        );
      } else if (estado === "Pagado") {
        dup = await dbGet(
          `SELECT id FROM pagos
           WHERE inscripcion_id = ?
             AND fecha_pago = ?
             AND monto = ?
             AND metodo = ?
             AND COALESCE(observaciones,'') = ?
             AND estado = 'Pagado'
           LIMIT 1`,
          [inscripcion_id, fecha, monto, metodo, observaciones]
        );
      }
      if (dup) {
        await dbRun("ROLLBACK").catch(() => {});
        return res.status(409).json({ ok: false, error: "Pago duplicado detectado. Verifica la cuota/fecha." });
      }

      // Insertar el pago
      const r = await dbRun(
        `INSERT INTO pagos (inscripcion_id, fecha_pago, monto, cuota_nro, estado, metodo, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [inscripcion_id, fecha, monto, cuota_nro, estado, metodo, observaciones]
      );

      const created = await dbGet(`SELECT * FROM pagos WHERE id = ?`, [r.lastID]);
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

// ===============================
// POST /api/pagos/:id/anular
// Anula un pago (soft) por ID
// Body: { motivo?: string }
// ===============================
router.post("/:id/anular", async (req, res) => {
  try {
    const id = toNum(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });
    const motivo = normStr(req.body?.motivo);

    const current = await dbGet(`SELECT id, estado FROM pagos WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ ok: false, error: "Pago no encontrado" });
    if (String(current.estado) === "Anulado") return res.json({ ok: true, changes: 0 });

    await dbRun(
      `UPDATE pagos
       SET estado = 'Anulado',
           anulado_motivo = ?,
           anulado_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
      [motivo || null, id]
    );

    return res.json({ ok: true, changes: 1 });
  } catch (err) {
    console.error("[POST /api/pagos/:id/anular] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al anular pago" });
  }
});

// ===============================
// DELETE /api/pagos/:id
// Elimina un pago por ID
// ===============================
router.delete("/:id", async (req, res) => {
  try {
    // Hard delete deshabilitado por defecto (auditoría contable).
    if (String(process.env.ALLOW_HARD_DELETE_PAYMENTS || "").toLowerCase() !== "true") {
      return res.status(403).json({ ok: false, error: "Operación no permitida. Usa Anular." });
    }
    const id = toNum(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const r = await dbRun(`DELETE FROM pagos WHERE id = ?`, [id]);
    return res.json({ ok: true, changes: r.changes });
  } catch (err) {
    console.error("[DELETE /api/pagos/:id] Error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Error al eliminar pago" });
  }
});

// ===============================
// POST /api/pagos/reset-plan
// Anula todos los pagos de una inscripción (para reconfigurar el plan de cuotas sin perder auditoría)
// Body: { inscripcion_id: number }
// ===============================
router.post("/reset-plan", async (req, res) => {
  try {
    const inscripcion_id = toNum(req.body?.inscripcion_id, 0);
    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id requerido" });
    }

    // Verificar que la inscripción existe antes de borrar
    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) {
      return res.status(404).json({ ok: false, error: "Inscripción no existe" });
    }

    // Transacción usando async/await
    await dbRun("BEGIN IMMEDIATE");
    try {
      const r = await dbRun(
        `UPDATE pagos
         SET estado = 'Anulado',
             anulado_motivo = COALESCE(anulado_motivo, 'Cambio de plan de cuotas'),
             anulado_at = COALESCE(anulado_at, datetime('now')),
             updated_at = datetime('now')
         WHERE inscripcion_id = ? AND estado <> 'Anulado'`,
        [inscripcion_id]
      );
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

module.exports = router;
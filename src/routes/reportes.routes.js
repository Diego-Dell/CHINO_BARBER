
// src/routes/reportes.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta ruta según tu estructura
// ===============================
function authRequired(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  if (req.session.user.rol !== "Admin") {
    return res.status(403).json({ ok: false, error: "Solo Admin" });
  }
  next();
}

router.use(authRequired);

// ===============================
// Helpers SQLite promisificados (solo lectura)
// ===============================
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ===============================
// Utilidades
// ===============================
function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

function nextMonthStartISO(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1..12
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad2(nm)}-01`;
}

function isISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  const dt = new Date(`${s}T00:00:00Z`);
  return (
    Number.isFinite(y) &&
    Number.isFinite(m) &&
    Number.isFinite(d) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function rangeOrDefault(desde, hasta) {
  const d = desde || "0000-01-01";
  const h = hasta || "9999-12-31";
  return { d, h };
}

// ===============================
// 1) GET /api/reportes/dashboard
// Resumen general (requiere authRequired)
// ===============================
router.get("/dashboard", async (req, res) => {
  try {
    const now = new Date();
    const desdeMes = monthStartISO(now);
    const hastaMesExcl = nextMonthStartISO(now);

    const alumnos = await dbGet(
      `SELECT COUNT(*) AS n FROM alumnos WHERE estado = 'Activo'`
    );
    const instructores = await dbGet(
      `SELECT COUNT(*) AS n FROM instructores WHERE estado = 'Activo'`
    );
    const cursos = await dbGet(
      `SELECT COUNT(*) AS n FROM cursos WHERE estado = 'Activo'`
    );
    const inscActivas = await dbGet(
      `SELECT COUNT(*) AS n FROM inscripciones WHERE estado = 'Activa'`
    );

    const ingresosMes = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha >= ? AND fecha < ?
      `,
      [desdeMes, hastaMesExcl]
    );

    const egresosMes = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha >= ? AND fecha < ?
      `,
      [desdeMes, hastaMesExcl]
    );

    // Items stock bajo (solo activos)
    const stockBajo = await dbGet(
      `
      SELECT COUNT(*) AS n
      FROM inventario_items it
      LEFT JOIN (
        SELECT
          item_id,
          COALESCE(SUM(
            CASE
              WHEN tipo='Entrada' THEN cantidad
              WHEN tipo='Salida' THEN -cantidad
              WHEN tipo='Ajuste' THEN cantidad
              ELSE 0
            END
          ), 0) AS stock_actual
        FROM inventario_movimientos
        GROUP BY item_id
      ) m ON m.item_id = it.id
      WHERE it.estado = 'Activo'
        AND COALESCE(m.stock_actual, 0) <= COALESCE(it.stock_minimo, 0)
      `
    );

    const ingresos_mes_actual = Number(ingresosMes?.total || 0);
    const egresos_mes_actual = Number(egresosMes?.total || 0);

    return res.json({
      ok: true,
      data: {
        total_alumnos: Number(alumnos?.n || 0),
        total_instructores: Number(instructores?.n || 0),
        total_cursos: Number(cursos?.n || 0),
        total_inscripciones_activas: Number(inscActivas?.n || 0),

        ingresos_mes_actual,
        egresos_mes_actual,
        balance_mes_actual: ingresos_mes_actual - egresos_mes_actual,

        items_stock_bajo: Number(stockBajo?.n || 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar dashboard" });
  }
});

// ===============================
// REPORTES FINANCIEROS (sensibles -> adminOnly)
// ===============================

// 2) GET /api/reportes/ingresos (Admin)
router.get("/ingresos", adminOnly, async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    if (desde && !isISODate(desde)) return res.status(500).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(500).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    const { d, h } = rangeOrDefault(desde, hasta);

    const totalRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const porMetodo = await dbAll(
      `
      SELECT metodo, COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha BETWEEN ? AND ?
      GROUP BY metodo
      ORDER BY total DESC
      `,
      [d, h]
    );

    const porCurso = await dbAll(
      `
      SELECT
        c.id AS curso_id,
        c.nombre AS curso_nombre,
        COALESCE(SUM(p.monto), 0) AS total
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN cursos c ON c.id = i.curso_id
      WHERE p.estado = 'Pagado'
        AND p.fecha BETWEEN ? AND ?
      GROUP BY c.id
      ORDER BY total DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        desde: d,
        hasta: h,
        total_ingresos: Number(totalRow?.total || 0),
        ingresos_por_metodo: porMetodo.map((r) => ({ metodo: r.metodo, total: Number(r.total || 0) })),
        ingresos_por_curso: porCurso.map((r) => ({
          curso_id: r.curso_id,
          curso_nombre: r.curso_nombre,
          total: Number(r.total || 0),
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de ingresos" });
  }
});

// 3) GET /api/reportes/egresos (Admin)
router.get("/egresos", adminOnly, async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    if (desde && !isISODate(desde)) return res.status(500).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(500).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    const { d, h } = rangeOrDefault(desde, hasta);

    const totalRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const porCategoria = await dbAll(
      `
      SELECT categoria, COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
      GROUP BY categoria
      ORDER BY total DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        desde: d,
        hasta: h,
        total_egresos: Number(totalRow?.total || 0),
        egresos_por_categoria: porCategoria.map((r) => ({
          categoria: r.categoria,
          total: Number(r.total || 0),
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de egresos" });
  }
});

// 4) GET /api/reportes/balance (Admin)
router.get("/balance", adminOnly, async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    if (desde && !isISODate(desde)) return res.status(500).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(500).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    const { d, h } = rangeOrDefault(desde, hasta);

    const ingresosRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const egresosRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const ingresos = Number(ingresosRow?.total || 0);
    const egresos = Number(egresosRow?.total || 0);

    return res.json({
      ok: true,
      data: { ingresos, egresos, balance: ingresos - egresos },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar balance" });
  }
});

// ===============================
// REPORTES ACADÉMICOS
// ===============================

// 5) GET /api/reportes/cursos (authRequired)
router.get("/cursos", async (req, res) => {
  try {
    // Por curso: cupo, inscripciones_activas, cupos_disponibles, ingresos_generados (Pagado)
    const rows = await dbAll(
      `
      SELECT
        c.id AS curso_id,
        c.nombre AS nombre_curso,
        ins.nombre AS instructor_nombre,
        c.cupo AS cupo,

        COALESCE(ic.inscripciones_activas, 0) AS inscripciones_activas,
        (COALESCE(c.cupo, 0) - COALESCE(ic.inscripciones_activas, 0)) AS cupos_disponibles,

        COALESCE(ing.ingresos_generados, 0) AS ingresos_generados
      FROM cursos c
      JOIN instructores ins ON ins.id = c.instructor_id
      LEFT JOIN (
        SELECT curso_id, COUNT(*) AS inscripciones_activas
        FROM inscripciones
        WHERE estado = 'Activa'
        GROUP BY curso_id
      ) ic ON ic.curso_id = c.id
      LEFT JOIN (
        SELECT i.curso_id, COALESCE(SUM(p.monto), 0) AS ingresos_generados
        FROM pagos p
        JOIN inscripciones i ON i.id = p.inscripcion_id
        WHERE p.estado = 'Pagado'
        GROUP BY i.curso_id
      ) ing ON ing.curso_id = c.id
      ORDER BY c.id DESC
      `
    );

    const data = rows.map((r) => ({
      curso_id: r.curso_id,
      nombre_curso: r.nombre_curso,
      instructor_nombre: r.instructor_nombre,
      cupo: Number(r.cupo || 0),
      inscripciones_activas: Number(r.inscripciones_activas || 0),
      cupos_disponibles: Number(r.cupos_disponibles || 0),
      ingresos_generados: Number(r.ingresos_generados || 0),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de cursos" });
  }
});

// 6) GET /api/reportes/asistencia (authRequired)
// Query: curso_id, desde, hasta
router.get("/asistencia", async (req, res) => {
  try {
    const curso_id = normStr(req.query.curso_id);
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    if (!curso_id) return res.status(500).json({ ok: false, error: "curso_id es obligatorio" });

    const cid = Number(curso_id);
    if (!Number.isFinite(cid) || cid <= 0) return res.status(500).json({ ok: false, error: "curso_id inválido" });

    const d = desde || "0000-01-01";
    const h = hasta || "9999-12-31";
    if (desde && !isISODate(desde)) return res.status(500).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(500).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    // Conteos por alumno (usando inscripciones + asistencia)
    const rows = await dbAll(
      `
      SELECT
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,

        COALESCE(SUM(CASE WHEN s.estado='Asistio' THEN 1 ELSE 0 END), 0) AS asistio,
        COALESCE(SUM(CASE WHEN s.estado='Falto' THEN 1 ELSE 0 END), 0) AS falto,
        COALESCE(SUM(CASE WHEN s.estado='Justificado' THEN 1 ELSE 0 END), 0) AS justificado,

        COALESCE(COUNT(s.id), 0) AS total_registros
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      LEFT JOIN asistencia s
        ON s.inscripcion_id = i.id
       AND s.fecha BETWEEN ? AND ?
      WHERE i.curso_id = ?
        AND i.estado = 'Activa'
      GROUP BY a.id
      ORDER BY a.nombre ASC
      `,
      [d, h, cid]
    );

    const data = rows.map((r) => {
      const asistio = Number(r.asistio || 0);
      const falto = Number(r.falto || 0);
      const justificado = Number(r.justificado || 0);
      const total = Number(r.total_registros || 0);
      const porcentaje_asistencia = total > 0 ? (asistio / total) * 100 : 0;

      return {
        alumno_id: r.alumno_id,
        alumno_nombre: r.alumno_nombre,
        asistio,
        falto,
        justificado,
        porcentaje_asistencia: Number(porcentaje_asistencia.toFixed(2)),
      };
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de asistencia" });
  }
});

// ===============================
// REPORTES DE DEUDA Y CAJA
// ===============================

// 7) GET /api/reportes/deudores (authRequired)
router.get("/deudores", async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,

        a.nombre AS alumno_nombre,
        c.nombre AS curso_nombre,

        c.precio AS precio,
        COALESCE(p.total_pagado, 0) AS total_pagado,
        (c.precio - COALESCE(p.total_pagado, 0)) AS deuda
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN (
        SELECT inscripcion_id, COALESCE(SUM(monto), 0) AS total_pagado
        FROM pagos
        WHERE estado = 'Pagado'
        GROUP BY inscripcion_id
      ) p ON p.inscripcion_id = i.id
      WHERE i.estado = 'Activa'
        AND (c.precio - COALESCE(p.total_pagado, 0)) > 0
      ORDER BY deuda DESC, i.id DESC
      `
    );

    const data = rows.map((r) => ({
      inscripcion_id: r.inscripcion_id,
      alumno_nombre: r.alumno_nombre,
      curso_nombre: r.curso_nombre,
      precio: Number(r.precio || 0),
      total_pagado: Number(r.total_pagado || 0),
      deuda: Number(r.deuda || 0),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de deudores" });
  }
});

// 8) GET /api/reportes/caja (Admin) -> sensible
// Query: fecha (YYYY-MM-DD)
router.get("/caja", adminOnly, async (req, res) => {
  try {
    const fecha = normStr(req.query.fecha) || todayISO();
    if (!isISODate(fecha)) return res.status(500).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });

    const ingRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha = ?
      `,
      [fecha]
    );

    const egrRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha = ?
      `,
      [fecha]
    );

    const detalleIngresos = await dbAll(
      `
      SELECT
        p.id AS pago_id,
        p.fecha,
        p.monto,
        p.metodo,
        a.nombre AS alumno_nombre,
        c.nombre AS curso_nombre,
        p.inscripcion_id
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      WHERE p.estado = 'Pagado'
        AND p.fecha = ?
      ORDER BY p.id DESC
      `,
      [fecha]
    );

    const detalleEgresos = await dbAll(
      `
      SELECT id AS egreso_id, fecha, categoria, detalle, monto, comprobante
      FROM egresos
      WHERE fecha = ?
      ORDER BY id DESC
      `,
      [fecha]
    );

    const total_ingresos_dia = Number(ingRow?.total || 0);
    const total_egresos_dia = Number(egrRow?.total || 0);

    return res.json({
      ok: true,
      data: {
        fecha,
        total_ingresos_dia,
        total_egresos_dia,
        balance_dia: total_ingresos_dia - total_egresos_dia,
        detalle_ingresos: detalleIngresos.map((r) => ({
          pago_id: r.pago_id,
          inscripcion_id: r.inscripcion_id,
          fecha: r.fecha,
          monto: Number(r.monto || 0),
          metodo: r.metodo,
          alumno_nombre: r.alumno_nombre,
          curso_nombre: r.curso_nombre,
        })),
        detalle_egresos: detalleEgresos.map((r) => ({
          egreso_id: r.egreso_id,
          fecha: r.fecha,
          categoria: r.categoria,
          detalle: r.detalle,
          monto: Number(r.monto || 0),
          comprobante: r.comprobante,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de caja" });
  }
});

// ===============================
// REPORTES INVENTARIO
// ===============================

// 9) GET /api/reportes/inventario (authRequired)
router.get("/inventario", async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        it.id AS item_id,
        it.producto AS item,
        it.stock_minimo,
        it.estado,
        COALESCE(m.stock_actual, 0) AS stock_actual
      FROM inventario_items it
      LEFT JOIN (
        SELECT
          item_id,
          COALESCE(SUM(
            CASE
              WHEN tipo='Entrada' THEN cantidad
              WHEN tipo='Salida' THEN -cantidad
              WHEN tipo='Ajuste' THEN cantidad
              ELSE 0
            END
          ), 0) AS stock_actual
        FROM inventario_movimientos
        GROUP BY item_id
      ) m ON m.item_id = it.id
      ORDER BY it.producto ASC
      `
    );

    const data = rows.map((r) => {
      const stock_actual = Number(r.stock_actual || 0);
      const stock_minimo = Number(r.stock_minimo || 0);
      return {
        item_id: r.item_id,
        item: r.item,
        stock_actual,
        stock_minimo,
        alerta: stock_actual <= stock_minimo,
      };
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al generar reporte de inventario" });
  }
});

module.exports = router;

/*
reportes.routes.js SOLO consulta (SELECT) y consolida datos del sistema; NO modifica nada.

Conexiones por módulo:
- pagos -> ingresos (solo estado='Pagado') para dashboard, ingresos, balance, caja.
- egresos -> gastos para dashboard, egresos, balance, caja.
- inscripciones -> relación cursos/alumnos (inscripciones activas, deudores).
- cursos + instructores -> reporte académico por curso (cupos, inscripciones, ingresos por curso).
- inventario_items + inventario_movimientos -> stock dinámico, alertas, inventario para dashboard/reportes.
- asistencia -> rendimiento académico por alumno (conteos y %), ligado a inscripciones (inscripcion_id).

Endpoints que usa el frontend:
- Dashboard: GET /api/reportes/dashboard
- Gráficos financieros: GET /api/reportes/ingresos, GET /api/reportes/egresos, GET /api/reportes/balance
- Control: GET /api/reportes/deudores, GET /api/reportes/caja
- Inventario: GET /api/reportes/inventario
- Académico: GET /api/reportes/cursos, GET /api/reportes/asistencia

Sin INSCRIPCIONES, PAGOS, EGRESOS e INVENTARIO este módulo no tendría sentido:
es la prueba de que todo el sistema está bien integrado y conectado.
*/

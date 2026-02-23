// src/routes/reportes.routes.js - VERSIÓN COMPLETA Y FUNCIONAL
const express = require("express");
const db = require("../db");

const router = express.Router();

// ===== HELPERS =====
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function pad2(n) { return String(n).padStart(2, "0"); }

// Detectar columna de fecha en pagos
let PAGOS_DATE_COL = null;
async function resolvePagosDateColumn() {
  if (PAGOS_DATE_COL) return PAGOS_DATE_COL;
  const cols = await dbAll(`PRAGMA table_info(pagos)`);
  const names = new Set(cols.map(c => c && c.name).filter(Boolean));
  const candidates = ["fecha_pago", "fecha", "fecha_registro", "created_at"];
  for (const c of candidates) {
    if (names.has(c)) return (PAGOS_DATE_COL = c);
  }
  return null;
}

// Validar rango de fechas
function parseDate(s) {
  if (!s || typeof s !== "string") return null;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) ? d : null;
}

function dateToISO(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

function getDateRange(desde, hasta) {
  let dStart = null, dEnd = null;
  
  if (desde && typeof desde === "string") dStart = parseDate(desde);
  if (hasta && typeof hasta === "string") dEnd = parseDate(hasta);
  
  if (!dStart || !dEnd) {
    // Default: último mes completo
    const now = new Date();
    dEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    dStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  
  if (dStart > dEnd) [dStart, dEnd] = [dEnd, dStart];
  
  return {
    desde: dateToISO(dStart),
    hasta: dateToISO(addDays(dEnd, 1)), // Inclusive
  };
}

// ===== ENDPOINTS =====

/**
 * GET /api/reportes/kpis
 * Retorna KPIs: ingresos, egresos, utilidad, alumnos activos, inscripciones activas
 */
router.get("/kpis", async (req, res) => {
  try {
    const { desde, hasta, anulados } = req.query;
    const range = getDateRange(desde, hasta);
    const includeAnulados = anulados === "1";
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({
        ok: true,
        desde: range.desde,
        hasta: range.hasta,
        kpis: {
          ingresos: 0,
          egresos: 0,
          utilidad: 0,
          alumnos_activos: 0,
          inscripciones_activas: 0,
        },
      });
    }

    // INGRESOS: pagos con estado "Pagado" en el rango
    const pagosSql = `
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE ${dateCol} >= ?
        AND ${dateCol} < ?
        ${!includeAnulados ? "AND estado = 'Pagado'" : "AND estado IN ('Pagado', 'Pendiente', 'Anulado')"}
    `;
    const ingresosRow = await dbGet(pagosSql, [range.desde, range.hasta]);
    const ingresos = Number(ingresosRow?.total || 0);

    // EGRESOS: tabla egresos si existe
    let egresos = 0;
    try {
      const egresosSql = `
        SELECT COALESCE(SUM(monto), 0) AS total
        FROM egresos
        WHERE fecha >= ? AND fecha < ?
      `;
      const egresosRow = await dbGet(egresosSql, [range.desde, range.hasta]);
      egresos = Number(egresosRow?.total || 0);
    } catch (e) {
      // Tabla egresos no existe o error, dejar en 0
      egresos = 0;
    }

    // UTILIDAD
    const utilidad = ingresos - egresos;

    // ALUMNOS ACTIVOS
    const alumnosRow = await dbGet(`
      SELECT COALESCE(COUNT(DISTINCT id), 0) AS cnt
      FROM alumnos
      WHERE estado = 'Activo'
    `);
    const alumnos_activos = Number(alumnosRow?.cnt || 0);

    // INSCRIPCIONES ACTIVAS
    const inscripcionesRow = await dbGet(`
      SELECT COALESCE(COUNT(DISTINCT id), 0) AS cnt
      FROM inscripciones
      WHERE estado = 'Activa'
    `);
    const inscripciones_activas = Number(inscripcionesRow?.cnt || 0);

    return res.json({
      ok: true,
      desde: range.desde,
      hasta: range.hasta,
      kpis: {
        ingresos,
        egresos,
        utilidad,
        alumnos_activos,
        inscripciones_activas,
      },
    });
  } catch (err) {
    console.error("[REPORTES][KPIS]", err);
    return res.status(500).json({ ok: false, error: "Error calculando KPIs: " + err.message });
  }
});

/**
 * GET /api/reportes/tendencia
 * Retorna serie mensual: mes, ingresos, egresos, utilidad
 */
router.get("/tendencia", async (req, res) => {
  try {
    const { desde, hasta, anulados } = req.query;
    const range = getDateRange(desde, hasta);
    const includeAnulados = anulados === "1";
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({ ok: true, serie_mensual: [] });
    }

    // Obtener meses en rango
    const dStart = parseDate(range.desde);
    const dEnd = parseDate(range.hasta);
    const meses = [];
    
    const current = new Date(dStart.getFullYear(), dStart.getMonth(), 1);
    while (current < dEnd) {
      const y = current.getFullYear();
      const m = pad2(current.getMonth() + 1);
      meses.push(`${y}-${m}`);
      current.setMonth(current.getMonth() + 1);
    }

    const serie = [];

    for (const mes of meses) {
      const [year, month] = mes.split("-");
      const mesStart = `${year}-${month}-01`;
      // Próximo mes
      const nextMonth = parseInt(month) === 12 
        ? `${parseInt(year) + 1}-01-01`
        : `${year}-${pad2(parseInt(month) + 1)}-01`;

      // Ingresos del mes
      const ingRow = await dbGet(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM pagos
         WHERE ${dateCol} >= ? AND ${dateCol} < ?
         ${!includeAnulados ? "AND estado = 'Pagado'" : "AND estado IN ('Pagado', 'Pendiente', 'Anulado')"}`,
        [mesStart, nextMonth]
      );
      const ingresos = Number(ingRow?.total || 0);

      // Egresos del mes
      let egresos = 0;
      try {
        const egreRow = await dbGet(
          `SELECT COALESCE(SUM(monto), 0) AS total FROM egresos
           WHERE fecha >= ? AND fecha < ?`,
          [mesStart, nextMonth]
        );
        egresos = Number(egreRow?.total || 0);
      } catch (e) {
        egresos = 0;
      }

      serie.push({
        mes,
        ingresos,
        egresos,
        utilidad: ingresos - egresos,
      });
    }

    return res.json({ ok: true, serie_mensual: serie });
  } catch (err) {
    console.error("[REPORTES][TENDENCIA]", err);
    return res.status(500).json({ ok: false, error: "Error calculando tendencia: " + err.message });
  }
});

/**
 * GET /api/reportes/pagos-por-estado
 * Retorna conteo y monto de pagos agrupados por estado
 */
router.get("/pagos-por-estado", async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const range = getDateRange(desde, hasta);
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({
        ok: true,
        pagos_por_estado: [
          { estado: "Pagado", cantidad: 0, monto: 0 },
          { estado: "Pendiente", cantidad: 0, monto: 0 },
          { estado: "Anulado", cantidad: 0, monto: 0 },
        ],
      });
    }

    const rows = await dbAll(
      `SELECT estado, COALESCE(COUNT(*), 0) AS cantidad, COALESCE(SUM(monto), 0) AS monto
       FROM pagos
       WHERE ${dateCol} >= ? AND ${dateCol} < ?
       GROUP BY estado`,
      [range.desde, range.hasta]
    );

    const map = {};
    for (const r of rows) {
      map[r.estado] = { estado: r.estado, cantidad: r.cantidad, monto: Number(r.monto || 0) };
    }

    const estados = ["Pagado", "Pendiente", "Anulado"];
    const result = estados.map(e => map[e] || { estado: e, cantidad: 0, monto: 0 });

    return res.json({ ok: true, pagos_por_estado: result });
  } catch (err) {
    console.error("[REPORTES][PAGOS_ESTADO]", err);
    return res.status(500).json({ ok: false, error: "Error: " + err.message });
  }
});

/**
 * GET /api/reportes/top-cursos
 * Retorna top cursos por ingresos
 */
router.get("/top-cursos", async (req, res) => {
  try {
    const { desde, hasta, anulados } = req.query;
    const range = getDateRange(desde, hasta);
    const includeAnulados = anulados === "1";
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({ ok: true, cursos: [] });
    }

    const sql = `
      SELECT 
        c.id, c.nombre AS curso,
        COALESCE(SUM(p.monto), 0) AS ingresos,
        COALESCE(COUNT(p.id), 0) AS num_pagos
      FROM cursos c
      LEFT JOIN inscripciones i ON c.id = i.curso_id
      LEFT JOIN pagos p ON i.id = p.inscripcion_id
        AND p.${dateCol} >= ?
        AND p.${dateCol} < ?
        ${!includeAnulados ? "AND p.estado = 'Pagado'" : ""}
      GROUP BY c.id, c.nombre
      ORDER BY ingresos DESC
      LIMIT 10
    `;

    const cursos = await dbAll(sql, [range.desde, range.hasta]);
    return res.json({
      ok: true,
      cursos: cursos.map(r => ({
        id: r.id,
        curso: r.curso,
        ingresos: Number(r.ingresos || 0),
        num_pagos: r.num_pagos,
      })),
    });
  } catch (err) {
    console.error("[REPORTES][TOP_CURSOS]", err);
    return res.status(500).json({ ok: false, error: "Error: " + err.message });
  }
});

/**
 * GET /api/reportes/top-alumnos
 * Retorna top alumnos por pagos en el periodo
 */
router.get("/top-alumnos", async (req, res) => {
  try {
    const { desde, hasta, anulados } = req.query;
    const range = getDateRange(desde, hasta);
    const includeAnulados = anulados === "1";
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({ ok: true, alumnos: [] });
    }

    const sql = `
      SELECT 
        a.id, a.nombre AS alumno,
        COALESCE(SUM(p.monto), 0) AS pagado,
        COALESCE(COUNT(p.id), 0) AS num_pagos
      FROM alumnos a
      LEFT JOIN inscripciones i ON a.id = i.alumno_id
      LEFT JOIN pagos p ON i.id = p.inscripcion_id
        AND p.${dateCol} >= ?
        AND p.${dateCol} < ?
        ${!includeAnulados ? "AND p.estado = 'Pagado'" : ""}
      WHERE a.estado = 'Activo'
      GROUP BY a.id, a.nombre
      HAVING pagado > 0
      ORDER BY pagado DESC
      LIMIT 10
    `;

    const alumnos = await dbAll(sql, [range.desde, range.hasta]);
    return res.json({
      ok: true,
      alumnos: alumnos.map(r => ({
        id: r.id,
        alumno: r.alumno,
        pagado: Number(r.pagado || 0),
        num_pagos: r.num_pagos,
      })),
    });
  } catch (err) {
    console.error("[REPORTES][TOP_ALUMNOS]", err);
    return res.status(500).json({ ok: false, error: "Error: " + err.message });
  }
});

/**
 * GET /api/reportes/curso/:cursoId/detalle
 * Retorna detalle de pagos de un curso
 */
router.get("/curso/:cursoId/detalle", async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const { cursoId } = req.params;
    const range = getDateRange(desde, hasta);
    const dateCol = await resolvePagosDateColumn();

    if (!dateCol) {
      return res.json({ ok: true, detalle: [] });
    }

    const sql = `
      SELECT 
        p.id, p.${dateCol} AS fecha, a.nombre AS alumno, a.documento AS ci,
        p.monto, p.estado, p.metodo, p.observaciones
      FROM pagos p
      JOIN inscripciones i ON p.inscripcion_id = i.id
      JOIN alumnos a ON i.alumno_id = a.id
      WHERE i.curso_id = ?
        AND p.${dateCol} >= ?
        AND p.${dateCol} < ?
      ORDER BY p.${dateCol} DESC
      LIMIT 500
    `;

    const detalle = await dbAll(sql, [cursoId, range.desde, range.hasta]);
    return res.json({ ok: true, detalle });
  } catch (err) {
    console.error("[REPORTES][CURSO_DETALLE]", err);
    return res.status(500).json({ ok: false, error: "Error: " + err.message });
  }
});

/**
 * LEGACY: GET /api/reportes/dashboard (mantener compatibilidad)
 */
router.get("/dashboard", async (req, res) => {
  try {
    const dateCol = await resolvePagosDateColumn();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const desde = dateToISO(monthStart);
    const hasta = dateToISO(monthEnd);

    if (!dateCol) {
      return res.json({ ok: true, data: { pagos_mes: 0, monto_pagos_mes: 0 } });
    }

    const countRow = await dbGet(
      `SELECT COALESCE(COUNT(*), 0) AS cnt FROM pagos
       WHERE ${dateCol} >= ? AND ${dateCol} < ? AND estado = 'Pagado'`,
      [desde, hasta]
    );

    const totalRow = await dbGet(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM pagos
       WHERE ${dateCol} >= ? AND ${dateCol} < ? AND estado = 'Pagado'`,
      [desde, hasta]
    );

    return res.json({
      ok: true,
      data: {
        pagos_mes: Number(countRow?.cnt || 0),
        monto_pagos_mes: Number(totalRow?.total || 0),
      },
    });
  } catch (err) {
    console.error("[REPORTES][DASHBOARD]", err);
    return res.status(500).json({ ok: false, error: "Error" });
  }
});

/**
 * LEGACY: GET /api/reportes/deudores (mantener compatibilidad)
 */
router.get("/deudores", async (req, res) => {
  try {
    const { q, mes, curso_id } = req.query;

    let targetMonth = mes;
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      targetMonth = `${year}-${month}`;
    }

    let sql = `
      SELECT
        i.id AS inscripcion_id,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        c.id AS curso_id,
        c.nombre AS curso_nombre,
        ? AS mes,
        COALESCE(c.precio, 0) - COALESCE(SUM(CASE WHEN p.estado = 'Pagado' THEN p.monto ELSE 0 END), 0) AS monto_adeudado
      FROM inscripciones i
      INNER JOIN alumnos a ON i.alumno_id = a.id
      INNER JOIN cursos c ON i.curso_id = c.id
      LEFT JOIN pagos p ON i.id = p.inscripcion_id
        AND substr(p.fecha_pago, 1, 7) = ?
      WHERE i.estado = 'Activa'
    `;

    const params = [targetMonth, targetMonth];

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      sql += ` AND (a.nombre LIKE ? OR a.documento LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }

    if (curso_id && curso_id.trim()) {
      sql += ` AND c.id = ?`;
      params.push(parseInt(curso_id, 10));
    }

    sql += ` GROUP BY i.id, a.id, c.id HAVING monto_adeudado > 0 ORDER BY a.nombre ASC`;

    const deudores = await dbAll(sql, params);
    return res.json({ ok: true, data: deudores || [] });
  } catch (err) {
    console.error("[REPORTES][DEUDORES]", err);
    return res.status(500).json({ ok: false, error: "Error generando reporte de deudores" });
  }
});

/**
 * GET /api/reportes/dashboard-v2
 * Endpoint completo para el nuevo Dashboard. Devuelve en una sola llamada:
 *  - ingresos_mes: total, count, variacion vs mes anterior
 *  - alumnos: total, activos, inactivos, nuevos_mes
 *  - prestamos: activos, unidades, top3
 *  - alertas_stock
 *  - ultimos_pagos (últimos 7 con estado Pagado)
 *  - ultimas_inscripciones (últimas 5 activas)
 *  - ultimos_prestamos (últimos 5 pendientes)
 */
router.get("/dashboard-v2", async (req, res) => {
  try {
    const dateCol = await resolvePagosDateColumn();
    const now = new Date();

    // Rangos mes actual y mes anterior
    const mesActualStart  = dateToISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const mesActualEnd    = dateToISO(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    const mesAnteriorStart = dateToISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const mesAnteriorEnd  = mesActualStart;
    const mesActualStr    = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    // ── 1. INGRESOS MES ACTUAL ──
    let ingresos_mes_total = 0, ingresos_mes_count = 0, ingresos_mes_anterior = 0;
    if (dateCol) {
      const rowActual = await dbGet(
        `SELECT COALESCE(SUM(monto),0) AS total, COALESCE(COUNT(*),0) AS cnt
         FROM pagos WHERE ${dateCol} >= ? AND ${dateCol} < ? AND estado='Pagado'`,
        [mesActualStart, mesActualEnd]
      );
      ingresos_mes_total = Number(rowActual?.total || 0);
      ingresos_mes_count = Number(rowActual?.cnt   || 0);

      const rowAnterior = await dbGet(
        `SELECT COALESCE(SUM(monto),0) AS total FROM pagos
         WHERE ${dateCol} >= ? AND ${dateCol} < ? AND estado='Pagado'`,
        [mesAnteriorStart, mesAnteriorEnd]
      );
      ingresos_mes_anterior = Number(rowAnterior?.total || 0);
    }
    const variacion_pct = ingresos_mes_anterior > 0
      ? ((ingresos_mes_total - ingresos_mes_anterior) / ingresos_mes_anterior * 100)
      : null;

    // ── 2. ALUMNOS ──
    const alumnosRow = await dbAll(`SELECT estado FROM alumnos`).catch(() => []);
    const alumnos_activos   = alumnosRow.filter(a => String(a.estado||"").trim() === "Activo").length;
    const alumnos_inactivos = alumnosRow.filter(a => String(a.estado||"").trim() !== "Activo").length;

    // Nuevos alumnos del mes (usando created_at)
    let nuevos_mes = 0;
    try {
      const rowNuevos = await dbGet(
        `SELECT COUNT(*) AS cnt FROM alumnos WHERE substr(created_at,1,7) = ?`,
        [mesActualStr]
      );
      nuevos_mes = Number(rowNuevos?.cnt || 0);
    } catch (_) {}

    // ── 3. PRÉSTAMOS ACTIVOS ──
    let prestamos_activos = 0, prestamos_unidades = 0, prestamos_top3 = [];
    try {
      const prestamosRows = await dbAll(
        `SELECT p.item_id, p.cantidad, it.producto
         FROM inventario_prestamos p
         JOIN inventario_items it ON it.id = p.item_id
         WHERE p.estado = 'Pendiente'`
      );
      prestamos_activos  = prestamosRows.length;
      prestamos_unidades = prestamosRows.reduce((s, r) => s + Number(r.cantidad || 0), 0);

      // top3 por item
      const byItem = {};
      for (const r of prestamosRows) {
        if (!byItem[r.item_id]) byItem[r.item_id] = { item_id: r.item_id, producto: r.producto, cantidad: 0, prestamos: 0 };
        byItem[r.item_id].cantidad  += Number(r.cantidad || 0);
        byItem[r.item_id].prestamos += 1;
      }
      prestamos_top3 = Object.values(byItem)
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 3);
    } catch (_) {}

    // ── 4. ALERTAS STOCK BAJO ──
    let alertas_stock = [];
    try {
      alertas_stock = await dbAll(
        `SELECT * FROM (
          SELECT it.id, it.producto, it.stock_minimo,
            COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('Ingreso','Devolucion') THEN m.cantidad WHEN m.tipo IN ('Salida','Prestamo','Venta') THEN -m.cantidad WHEN m.tipo='Ajuste' THEN m.cantidad ELSE 0 END) FROM inventario_movimientos m WHERE m.item_id=it.id),0) AS stock_actual
          FROM inventario_items it WHERE it.estado='Activo'
        ) t WHERE t.stock_actual <= t.stock_minimo ORDER BY t.stock_actual ASC LIMIT 5`
      );
    } catch (_) {}

    // ── 5. ÚLTIMOS PAGOS (estado Pagado) ──
    let ultimos_pagos = [];
    if (dateCol) {
      try {
        ultimos_pagos = await dbAll(
          `SELECT p.id, p.monto, p.estado, p.metodo, p.${dateCol} AS fecha,
             a.nombre AS alumno_nombre, c.nombre AS curso_nombre
           FROM pagos p
           LEFT JOIN inscripciones i ON i.id = p.inscripcion_id
           LEFT JOIN alumnos a ON a.id = i.alumno_id
           LEFT JOIN cursos c ON c.id = i.curso_id
           WHERE p.estado = 'Pagado'
           ORDER BY p.${dateCol} DESC, p.id DESC LIMIT 7`
        );
      } catch (_) {}
    }

    // ── 6. ÚLTIMAS INSCRIPCIONES ──
    let ultimas_inscripciones = [];
    try {
      ultimas_inscripciones = await dbAll(
        `SELECT i.id, i.estado, i.created_at AS fecha,
           a.nombre AS alumno_nombre, c.nombre AS curso_nombre
         FROM inscripciones i
         LEFT JOIN alumnos a ON a.id = i.alumno_id
         LEFT JOIN cursos c ON c.id = i.curso_id
         ORDER BY i.id DESC LIMIT 5`
      );
    } catch (_) {}

    // ── 7. ÚLTIMOS PRÉSTAMOS ──
    let ultimos_prestamos = [];
    try {
      ultimos_prestamos = await dbAll(
        `SELECT p.id, p.cantidad, p.fecha, p.estado,
           it.producto AS item_producto, ins.nombre AS instructor_nombre
         FROM inventario_prestamos p
         JOIN inventario_items it ON it.id = p.item_id
         LEFT JOIN instructores ins ON ins.id = p.instructor_id
         ORDER BY p.id DESC LIMIT 5`
      );
    } catch (_) {}

    return res.json({
      ok: true,
      data: {
        ingresos_mes: {
          total: ingresos_mes_total,
          count: ingresos_mes_count,
          mes_anterior: ingresos_mes_anterior,
          variacion_pct: variacion_pct !== null ? Math.round(variacion_pct * 10) / 10 : null,
        },
        alumnos: {
          total: alumnos_activos + alumnos_inactivos,
          activos: alumnos_activos,
          inactivos: alumnos_inactivos,
          nuevos_mes,
        },
        prestamos: {
          activos:  prestamos_activos,
          unidades: prestamos_unidades,
          top3:     prestamos_top3,
        },
        alertas_stock,
        ultimos_pagos,
        ultimas_inscripciones,
        ultimos_prestamos,
      },
    });
  } catch (err) {
    console.error("[REPORTES][DASHBOARD-V2]", err);
    return res.status(500).json({ ok: false, error: "Error generando dashboard" });
  }
});

module.exports = router;

// src/routes/reportes.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

// ================= Helpers promisificados =================
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
function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n){
  const x = new Date(d);
  const y = x.getFullYear(), m = x.getMonth(), day = x.getDate();
  const nd = new Date(y, m + n, 1);
  const last = new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate();
  nd.setDate(Math.min(day, last));
  return nd;
}
function yyyymm(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
function isISODate(s){ return typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function monthsBetweenInclusive(desdeISO, hastaISO) {
  const a = new Date(`${desdeISO}T00:00:00`);
  const b = new Date(`${hastaISO}T00:00:00`);
  let cur = startOfMonth(a);
  const end = startOfMonth(b);
  const out = [];
  while (cur <= end) {
    out.push(yyyymm(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

function normalizeRange(desde, hasta) {
  const today = new Date();
  const defHasta = toISO(today);
  const defDesde = toISO(addMonths(today, -11)); // 12 meses por defecto

  const d = (desde && isISODate(desde)) ? desde : defDesde;
  const h = (hasta && isISODate(hasta)) ? hasta : defHasta;

  return { desde: d, hasta: h };
}

// =========================================================
// ✅ GET /api/reportes/kpis (mejorado)
// - KPIs
// - serie mensual ingresos/egresos/utilidad
// - estado pagos (conteo y total)
// - top cursos por ingresos
// - top alumnos por pagos
// =========================================================
router.get("/kpis", async (req, res) => {
  try {
    const { desde, hasta } = normalizeRange(req.query.desde, req.query.hasta);
    const includeAnulados = String(req.query.include_anulados || "0") === "1";

    // KPIs base
    const ingresosRow = await dbGet(
      `SELECT COALESCE(SUM(monto),0) AS total
       FROM pagos
       WHERE estado='Pagado'
         AND fecha BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const egresosRow = await dbGet(
      `SELECT COALESCE(SUM(monto),0) AS total
       FROM egresos
       WHERE fecha BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const alumnosActivosRow = await dbGet(
      `SELECT COUNT(*) AS n FROM alumnos WHERE estado='Activo'`
    );

    const inscActivasRow = await dbGet(
      `SELECT COUNT(*) AS n FROM inscripciones WHERE estado='Activa'`
    );

    const ingresos = Number(ingresosRow?.total || 0);
    const egresos = Number(egresosRow?.total || 0);

    // Serie mensual
    const meses = monthsBetweenInclusive(desde, hasta);

    const ingresosMesRows = await dbAll(
      `SELECT substr(fecha,1,7) AS ym, COALESCE(SUM(monto),0) AS total
       FROM pagos
       WHERE estado='Pagado'
         AND fecha BETWEEN ? AND ?
       GROUP BY substr(fecha,1,7)`,
      [desde, hasta]
    );

    const egresosMesRows = await dbAll(
      `SELECT substr(fecha,1,7) AS ym, COALESCE(SUM(monto),0) AS total
       FROM egresos
       WHERE fecha BETWEEN ? AND ?
       GROUP BY substr(fecha,1,7)`,
      [desde, hasta]
    );

    const mapIng = new Map(ingresosMesRows.map(r => [r.ym, Number(r.total || 0)]));
    const mapEgr = new Map(egresosMesRows.map(r => [r.ym, Number(r.total || 0)]));

    const serie_mensual = meses.map(m => {
      const ing = mapIng.get(m) || 0;
      const egr = mapEgr.get(m) || 0;
      return { mes: m, ingresos: ing, egresos: egr, utilidad: ing - egr };
    });

    // Pagos por estado (conteo + total)
    const pagosEstadoRows = await dbAll(
      `SELECT estado, COUNT(*) AS n, COALESCE(SUM(monto),0) AS total
       FROM pagos
       WHERE fecha BETWEEN ? AND ?
       ${includeAnulados ? "" : "AND estado <> 'Anulado'"}
       GROUP BY estado`,
      [desde, hasta]
    );

    const pagos_estado = {
      Pagado: { n: 0, total: 0 },
      Pendiente: { n: 0, total: 0 },
      Anulado: { n: 0, total: 0 },
      Otro: { n: 0, total: 0 },
    };

    for (const r of pagosEstadoRows) {
      const st = String(r.estado || "Otro");
      const key = pagos_estado[st] ? st : "Otro";
      pagos_estado[key].n += Number(r.n || 0);
      pagos_estado[key].total += Number(r.total || 0);
    }

    // Top cursos
    const topCursos = await dbAll(
      `SELECT
         c.id AS curso_id,
         c.nombre AS curso,
         COUNT(p.id) AS pagos,
         COALESCE(SUM(CASE WHEN p.estado='Pagado' THEN p.monto ELSE 0 END),0) AS ingresos
       FROM pagos p
       JOIN inscripciones i ON i.id = p.inscripcion_id
       JOIN cursos c ON c.id = i.curso_id
       WHERE p.fecha BETWEEN ? AND ?
         ${includeAnulados ? "" : "AND p.estado <> 'Anulado'"}
       GROUP BY c.id
       ORDER BY ingresos DESC, pagos DESC
       LIMIT 10`,
      [desde, hasta]
    );

    // Top alumnos (por total pagado)
    const topAlumnos = await dbAll(
      `SELECT
         a.id AS alumno_id,
         a.nombre AS alumno,
         a.documento AS ci,
         COUNT(p.id) AS pagos,
         COALESCE(SUM(CASE WHEN p.estado='Pagado' THEN p.monto ELSE 0 END),0) AS pagado
       FROM pagos p
       JOIN inscripciones i ON i.id = p.inscripcion_id
       JOIN alumnos a ON a.id = i.alumno_id
       WHERE p.fecha BETWEEN ? AND ?
         ${includeAnulados ? "" : "AND p.estado <> 'Anulado'"}
       GROUP BY a.id
       ORDER BY pagado DESC, pagos DESC
       LIMIT 10`,
      [desde, hasta]
    );

    return res.json({
      ok: true,
      data: {
        desde,
        hasta,
        include_anulados: includeAnulados,
        kpis: {
          ingresos,
          egresos,
          utilidad: ingresos - egresos,
          alumnos_activos: Number(alumnosActivosRow?.n || 0),
          inscripciones_activas: Number(inscActivasRow?.n || 0),
        },
        serie_mensual,
        pagos_estado,
        top_cursos: topCursos.map(r => ({
          curso_id: r.curso_id,
          curso: r.curso,
          pagos: Number(r.pagos || 0),
          ingresos: Number(r.ingresos || 0),
        })),
        top_alumnos: topAlumnos.map(r => ({
          alumno_id: r.alumno_id,
          alumno: r.alumno,
          ci: r.ci,
          pagos: Number(r.pagos || 0),
          pagado: Number(r.pagado || 0),
        })),
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error generando reportes" });
  }
});

// =========================================================
// ✅ GET /api/reportes/curso/:cursoId/detalle
// (Drilldown: lista pagos del curso en el rango)
// =========================================================
router.get("/curso/:cursoId/detalle", async (req, res) => {
  try {
    const cursoId = Number(req.params.cursoId);
    if (!Number.isFinite(cursoId)) return res.status(400).json({ ok:false, error:"cursoId inválido" });

    const { desde, hasta } = normalizeRange(req.query.desde, req.query.hasta);
    const includeAnulados = String(req.query.include_anulados || "0") === "1";

    const rows = await dbAll(
      `SELECT
         p.id,
         p.fecha,
         p.monto,
         p.estado,
         p.metodo,
         p.observaciones,
         a.nombre AS alumno,
         a.documento AS ci
       FROM pagos p
       JOIN inscripciones i ON i.id = p.inscripcion_id
       JOIN alumnos a ON a.id = i.alumno_id
       WHERE i.curso_id = ?
         AND p.fecha BETWEEN ? AND ?
         ${includeAnulados ? "" : "AND p.estado <> 'Anulado'"}
       ORDER BY p.fecha DESC, p.id DESC
       LIMIT 500`,
      [cursoId, desde, hasta]
    );

    const resumen = await dbGet(
      `SELECT
         COALESCE(SUM(CASE WHEN p.estado='Pagado' THEN p.monto ELSE 0 END),0) AS total_pagado,
         COUNT(*) AS n
       FROM pagos p
       JOIN inscripciones i ON i.id = p.inscripcion_id
       WHERE i.curso_id = ?
         AND p.fecha BETWEEN ? AND ?
         ${includeAnulados ? "" : "AND p.estado <> 'Anulado'"}`,
      [cursoId, desde, hasta]
    );

    return res.json({
      ok: true,
      data: {
        desde, hasta,
        total_pagado: Number(resumen?.total_pagado || 0),
        n: Number(resumen?.n || 0),
        rows: rows.map(r => ({
          id: r.id,
          fecha: r.fecha,
          alumno: r.alumno,
          ci: r.ci,
          monto: Number(r.monto || 0),
          estado: r.estado,
          metodo: r.metodo,
          obs: r.observaciones,
        }))
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error:"Error detalle curso" });
  }
});

module.exports = router;


router.get("/dashboard", async (req, res) => {
  try {
    const now = new Date();
    const desdeMes = monthStartISO(now);
    const hastaMesExcl = nextMonthStartISO(now);

    // Rango últimos 12 meses (incluye mes actual)
    const start12 = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const desde12 = monthStartISO(start12);
    const hasta12Excl = nextMonthStartISO(now);

    // En el dashboard se muestran totales (activos e históricos)
    const alumnos = await dbGet(`SELECT COUNT(*) AS n FROM alumnos`);
    const instructores = await dbGet(`SELECT COUNT(*) AS n FROM instructores`);
    // En schema, cursos.estado es: Programado/En curso/Finalizado/Cancelado
const cursos = await dbGet(
  `SELECT COUNT(*) AS n FROM cursos WHERE estado IN ('Programado','En curso')`
);


    const pagosTotal = await dbGet(`SELECT COUNT(*) AS n FROM pagos`);

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
              -- En schema: tipo IN ('Ingreso','Salida','Ajuste')
              WHEN tipo='Ingreso' THEN cantidad
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

    // Ingresos últimos 12 meses (solo Pagado)
    const ingresos12Rows = await dbAll(
      `
      SELECT substr(fecha,1,7) AS mes, COALESCE(SUM(monto),0) AS total
      FROM pagos
      WHERE estado='Pagado'
        AND fecha >= ? AND fecha < ?
      GROUP BY substr(fecha,1,7)
      ORDER BY mes ASC
      `,
      [desde12, hasta12Excl]
    );

    // Construir labels YYYY-MM (12 meses) y completar con ceros
    const labels = [];
    const map = new Map((ingresos12Rows || []).map((r) => [r.mes, Number(r.total || 0)]));
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      labels.push(label);
    }
    const valores = labels.map((m) => map.get(m) || 0);

    const ingresos_mes_actual = Number(ingresosMes?.total || 0);
    const egresos_mes_actual = Number(egresosMes?.total || 0);

    return res.json({
      ok: true,
      data: {
        total_alumnos: Number(alumnos?.n || 0),
        total_instructores: Number(instructores?.n || 0),
        total_cursos: Number(cursos?.n || 0),
        total_inscripciones_activas: Number(inscActivas?.n || 0),

        total_pagos: Number(pagosTotal?.n || 0),

        ingresos_mes_actual,
        egresos_mes_actual,
        balance_mes_actual: ingresos_mes_actual - egresos_mes_actual,

        items_stock_bajo: Number(stockBajo?.n || 0),

        // Para el gráfico del dashboard (index.html)
        ingresos_12m: {
          labels,
          values: valores,
        },
      },
    });
} catch (err) {
  console.error("[REPORTES][DASHBOARD]", err);
  return res.status(500).json({
    ok: false,
    error: "Error al generar dashboard",
    detail: String(err?.message || err),
  });
}

});

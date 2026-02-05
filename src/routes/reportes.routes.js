// src/routes/reportes.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

// ===============================
// Middlewares (placeholder)
// ===============================
function authRequired(req, res, next) { return next(); }
router.use(authRequired);

// ===============================
// Helpers SQLite promisificados
// ===============================
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

// ===============================
// Utils
// ===============================
function normStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function toISODate(input) {
  // acepta YYYY-MM-DD o DD/MM/YYYY
  const s = String(input ?? "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

function isISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(`${s}T00:00:00Z`);
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

function monthKeyFromISO(isoDate) {
  // isoDate: YYYY-MM-DD => YYYY-MM
  return String(isoDate || "").slice(0, 7);
}

function monthStart(yyyy_mm) {
  // YYYY-MM => YYYY-MM-01
  return `${yyyy_mm}-01`;
}

function nextMonthStart(yyyy_mm) {
  const [y, m] = yyyy_mm.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function monthsBetween(desdeISO, hastaISO) {
  const d = new Date(`${desdeISO}T00:00:00Z`);
  const h = new Date(`${hastaISO}T00:00:00Z`);
  // incluimos el mes de "hasta"
  const out = [];
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;

  const endY = h.getUTCFullYear();
  const endM = h.getUTCMonth() + 1;

  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return out;
}

// ===============================
// 1) DASHBOARD (index)
// ===============================
router.get("/dashboard", async (req, res) => {
  try {
    /**
     * Dashboard KPIs
     * - Ingresos último mes = suma de pagos "Pagado" en los últimos 30 días (incluye hoy)
     * - Alumnos activos/inactivos = según columna alumnos.estado
     */
    const now = new Date();
    const hoy = now.toISOString().slice(0, 10);

    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);
    const desde30 = d30.toISOString().slice(0, 10);

    // Para rango exclusivo superior (mañana)
    const maniana = new Date(now);
    maniana.setDate(maniana.getDate() + 1);
    const hastaExcl = maniana.toISOString().slice(0, 10);

    const alumnosAct = await dbGet(`SELECT COUNT(*) AS n FROM alumnos WHERE estado = 'Activo'`);
    const alumnosInact = await dbGet(`SELECT COUNT(*) AS n FROM alumnos WHERE estado = 'Inactivo'`);
    const cursos = await dbGet(
      `SELECT COUNT(*) AS n FROM cursos WHERE estado IN ('Programado','En curso')`
    );
    const pagosTot = await dbGet(`SELECT COUNT(*) AS n FROM pagos`);

const ingresosUltimoMes = await dbGet(
  `SELECT COALESCE(SUM(monto), 0) AS total
   FROM pagos
   WHERE estado = 'Pagado'
     AND fecha_pago >= ? AND fecha_pago < ?`,
  [desde30, hastaExcl]
);


    return res.json({
      ok: true,
      data: {
        // compat: el frontend usa ingresos_mes_actual
        ingresos_mes_actual: Number(ingresosUltimoMes?.total || 0),
        ingresos_ultimo_mes_desde: desde30,
        ingresos_ultimo_mes_hasta: hoy,
        total_alumnos_activos: Number(alumnosAct?.n || 0),
        total_alumnos_inactivos: Number(alumnosInact?.n || 0),
        total_alumnos: Number((alumnosAct?.n || 0) + (alumnosInact?.n || 0)),
        total_cursos: Number(cursos?.n || 0),
        total_pagos_registrados: Number(pagosTot?.n || 0),
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

// ===============================
// 2) DEUDORES (deudores.html)
// ===============================
router.get("/deudores", async (req, res) => {
  try {
    const q = normStr(req.query.q);
    const cursoId = normStr(req.query.curso_id);
    const mes = normStr(req.query.mes); // YYYY-MM opcional
    const mesOut = mes || monthKeyFromISO(new Date().toISOString().slice(0, 10));

    const where = [`i.estado = 'Activa'`];
    const params = [];

    if (cursoId) { where.push(`c.id = ?`); params.push(cursoId); }
    if (q) {
      where.push(`(a.nombre LIKE ? OR a.documento LIKE ? OR c.nombre LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        c.id AS curso_id,
        c.nombre AS curso_nombre,
        c.precio AS precio,
        COALESCE(p.total_pagado, 0) AS total_pagado,
        (c.precio - COALESCE(p.total_pagado, 0)) AS monto_adeudado
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN (
        SELECT inscripcion_id, COALESCE(SUM(monto), 0) AS total_pagado
        FROM pagos
        WHERE estado = 'Pagado'
        GROUP BY inscripcion_id
      ) p ON p.inscripcion_id = i.id
      WHERE ${where.join(" AND ")}
        AND (c.precio - COALESCE(p.total_pagado, 0)) > 0
      ORDER BY monto_adeudado DESC, i.id DESC
      `,
      params
    );

    return res.json({
      ok: true,
      data: rows.map(r => ({
        inscripcion_id: r.inscripcion_id,
        alumno_id: r.alumno_id,
        alumno_nombre: r.alumno_nombre,
        alumno_documento: r.alumno_documento,
        curso_id: r.curso_id,
        curso_nombre: r.curso_nombre,
        mes: mesOut,
        monto_adeudado: Number(r.monto_adeudado || 0),
        precio: Number(r.precio || 0),
        total_pagado: Number(r.total_pagado || 0),
      })),
    });
  } catch (err) {
    console.error("[REPORTES][DEUDORES]", err);
    return res.status(500).json({
      ok: false,
      error: "Error al generar reporte de deudores",
      detail: String(err?.message || err),
    });
  }
});

// ===== esquema dinámico pagos (compat DB vieja/nueva) =====
let _PAGOS_COLS = null;

async function getPagosCols() {
  if (_PAGOS_COLS) return _PAGOS_COLS;
  const rows = await dbAll("PRAGMA table_info(pagos)");
  _PAGOS_COLS = new Set(rows.map(r => String(r.name || "").toLowerCase()));
  return _PAGOS_COLS;
}

function pickFechaCol(cols) {
  const candidates = ["fecha_pago", "fecha", "created_at"];
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}



// ===============================
// 3) KPI (reportes.html)
// GET /api/reportes/kpis?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&anulados=1
// ===============================
router.get("/kpis", async (req, res) => {
  try {
    const desde = toISODate(req.query.desde) || "0000-01-01";
    const hasta = toISODate(req.query.hasta) || "9999-12-31";
    const incluirAnulados = String(req.query.anulados || "0") === "1";

    if (!isISODate(desde) || !isISODate(hasta)) {
      return res.status(400).json({ ok: false, error: "Fechas inválidas (usa YYYY-MM-DD)" });
    }

    // Ingresos: por defecto SOLO Pagado. Si incluirAnulados=1, incluye Pagado + Pendiente (pero NO Anulado).
    // (Anulado nunca debería sumar ingresos)
    const estadosIngresos = incluirAnulados ? `('Pagado','Pendiente')` : `('Pagado')`;

    const ingresos = await dbGet(
      `SELECT COALESCE(SUM(monto),0) AS total
       FROM pagos
       WHERE estado IN ${estadosIngresos}
         AND fecha >= ? AND fecha <= ?`,
      [desde, hasta]
    );

    const egresos = await dbGet(
      `SELECT COALESCE(SUM(monto),0) AS total
       FROM egresos
       WHERE fecha >= ? AND fecha <= ?`,
      [desde, hasta]
    );

    const alumnosActivos = await dbGet(`SELECT COUNT(*) AS n FROM alumnos WHERE estado='Activo'`);
    const inscActivas = await dbGet(`SELECT COUNT(*) AS n FROM inscripciones WHERE estado='Activa'`);

    const ingresosN = Number(ingresos?.total || 0);
    const egresosN = Number(egresos?.total || 0);

    return res.json({
      ok: true,
      data: {
        ingresos: ingresosN,
        egresos: egresosN,
        utilidad: ingresosN - egresosN,
        alumnos_activos: Number(alumnosActivos?.n || 0),
        inscripciones_activas: Number(inscActivas?.n || 0),
      },
    });
  } catch (err) {
    console.error("[REPORTES][KPIS]", err);
    return res.status(500).json({
      ok: false,
      error: "Error: API route not found", // (tu front muestra esto)
      detail: String(err?.message || err),
    });
  }
});

// ===============================
// 4) TENDENCIA MENSUAL (reportes.html)
// GET /api/reportes/tendencia?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&anulados=1
// ===============================
router.get("/tendencia", async (req, res) => {
  try {
    const desde = toISODate(req.query.desde) || "0000-01-01";
    const hasta = toISODate(req.query.hasta) || "9999-12-31";
    const incluirAnulados = String(req.query.anulados || "0") === "1";

    if (!isISODate(desde) || !isISODate(hasta)) {
      return res.status(400).json({ ok: false, error: "Fechas inválidas (usa YYYY-MM-DD)" });
    }

    const estadosIngresos = incluirAnulados ? `('Pagado','Pendiente')` : `('Pagado')`;

    const meses = monthsBetween(desde, hasta);

    // ingresos por mes
    const incRows = await dbAll(
      `
      SELECT substr(fecha,1,7) AS mes, COALESCE(SUM(monto),0) AS total
      FROM pagos
      WHERE estado IN ${estadosIngresos}
        AND fecha >= ? AND fecha <= ?
      GROUP BY substr(fecha,1,7)
      `,
      [desde, hasta]
    );

    // egresos por mes
    const egRows = await dbAll(
      `
      SELECT substr(fecha,1,7) AS mes, COALESCE(SUM(monto),0) AS total
      FROM egresos
      WHERE fecha >= ? AND fecha <= ?
      GROUP BY substr(fecha,1,7)
      `,
      [desde, hasta]
    );

    const incMap = new Map(incRows.map(r => [r.mes, Number(r.total || 0)]));
    const egMap = new Map(egRows.map(r => [r.mes, Number(r.total || 0)]));

    const data = meses.map(m => {
      const ingresos = incMap.get(m) || 0;
      const egresos = egMap.get(m) || 0;
      return { mes: m, ingresos, egresos, utilidad: ingresos - egresos };
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[REPORTES][TENDENCIA]", err);
    return res.status(500).json({
      ok: false,
      error: "Error al generar tendencia",
      detail: String(err?.message || err),
    });
  }
});

// ===============================
// 5) PAGOS POR ESTADO (reportes.html)
// GET /api/reportes/pagos-por-estado?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// ===============================
router.get("/pagos-por-estado", async (req, res) => {
  try {
    const desde = toISODate(req.query.desde) || "0000-01-01";
    const hasta = toISODate(req.query.hasta) || "9999-12-31";

    if (!isISODate(desde) || !isISODate(hasta)) {
      return res.status(400).json({ ok: false, error: "Fechas inválidas (usa YYYY-MM-DD)" });
    }

    const rows = await dbAll(
      `
      SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
      FROM pagos
      WHERE fecha >= ? AND fecha <= ?
      GROUP BY estado
      ORDER BY total DESC
      `,
      [desde, hasta]
    );

    return res.json({
      ok: true,
      data: rows.map(r => ({
        estado: r.estado || "—",
        cantidad: Number(r.cantidad || 0),
        total: Number(r.total || 0),
      })),
    });
  } catch (err) {
    console.error("[REPORTES][PAGOS_ESTADO]", err);
    return res.status(500).json({
      ok: false,
      error: "Error al generar pagos por estado",
      detail: String(err?.message || err),
    });
  }
});

module.exports = router;

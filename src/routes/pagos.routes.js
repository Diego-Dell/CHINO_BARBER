// src/routes/pagos.routes.js
const express = require("express");
const router = express.Router();

/**
 * AJUSTA ESTO si tu db se importa distinto:
 * - Si usas sqlite3 + promisify, debe exponer: db.get, db.all, db.run (promesas)
 */
const db = require("../db");

// ===============================
// Helpers fechas (YYYY-MM-DD)
// ===============================
function hoyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(s) {
  const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function addMonthsKeepDay(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);

  // Ajuste si el mes no tiene ese día (e.g. 31)
  while (d.getDate() !== day) {
    d.setDate(d.getDate() - 1);
    if (d.getDate() === day) break;
    if (d.getDate() < 28) break;
  }
  return toISODate(d);
}

function money2(n) {
  const v = Number(n || 0);
  return Math.round(v * 100) / 100;
}

// ===============================
// Periodos según frecuencia
// - Mensual: [inicio .. fin] = inicio hasta (inicio+1mes -1día)
// - Semanal: 7 días => fin = inicio+6
// ===============================
function buildPeriodo(inicioISO, frecuencia) {
  const f = String(frecuencia || "Mensual").toLowerCase();
  if (f === "semanal") {
    const fin = addDays(inicioISO, 6);
    return { inicio: inicioISO, fin };
  }
  // mensual
  const nextMonthSameDay = addMonthsKeepDay(inicioISO, 1);
  const fin = addDays(nextMonthSameDay, -1);
  return { inicio: inicioISO, fin };
}

function montoPeriodo(precioCurso, frecuencia) {
  const f = String(frecuencia || "Mensual").toLowerCase();
  if (f === "semanal") return money2(Number(precioCurso || 0) / 4); // regla simple
  return money2(Number(precioCurso || 0));
}

// ===============================
// Query helpers
// ===============================
async function getCurso(cursoId) {
  return db.get(
    `SELECT id, nombre, precio, pago_frecuencia, fecha_inicio, nro_clases, dias
     FROM cursos WHERE id = ?`,
    [cursoId]
  );
}

async function getInscripcionesActivas(cursoId) {
  // Ajusta "estado" si tu tabla usa otro campo
  return db.all(
    `SELECT i.id as inscripcion_id, i.curso_id, i.alumno_id,
            a.nombre as alumno_nombre, a.documento as alumno_documento
     FROM inscripciones i
     JOIN alumnos a ON a.id = i.alumno_id
     WHERE i.curso_id = ? AND (i.estado IS NULL OR i.estado = 'Activa')`,
    [cursoId]
  );
}

async function getSumPagadoPorPeriodo(inscripcionId) {
  const rows = await db.all(
    `SELECT periodo_inicio, periodo_fin, SUM(monto) as pagado
     FROM pagos
     WHERE inscripcion_id = ?
     GROUP BY periodo_inicio, periodo_fin`,
    [inscripcionId]
  );
  const map = new Map();
  for (const r of rows) {
    const k = `${String(r.periodo_inicio)}|${String(r.periodo_fin)}`;
    map.set(k, Number(r.pagado || 0));
  }
  return map;
}

async function getUltimoPeriodoPagado(inscripcionId) {
  // último periodo que tenga pagos
  return db.get(
    `SELECT periodo_fin
     FROM pagos
     WHERE inscripcion_id = ?
     ORDER BY periodo_fin DESC, id DESC
     LIMIT 1`,
    [inscripcionId]
  );
}

// genera periodos desde fecha_inicio del curso hasta HOY (para deuda)
function generarPeriodosHastaHoy(fechaInicioISO, frecuencia) {
  const start = String(fechaInicioISO || "").slice(0, 10);
  const today = hoyISO();
  if (!parseISO(start)) return [];

  const out = [];
  let cursor = start;

  for (let guard = 0; guard < 120; guard++) { // 10 años mensual
    const p = buildPeriodo(cursor, frecuencia);
    out.push(p);

    // si el fin ya pasó hoy, seguimos; si estamos dentro del periodo actual, igual lo incluimos
    // y cortamos cuando el inicio sea mayor a hoy (seguridad)
    const nextCursor =
      String(frecuencia || "Mensual").toLowerCase() === "semanal"
        ? addDays(cursor, 7)
        : addMonthsKeepDay(cursor, 1);

    if (!nextCursor) break;

    // cortar si el cursor siguiente es mayor a hoy por mucho
    if (parseISO(nextCursor) > parseISO(today) && out.length > 1) {
      // aún incluimos periodo actual (ya está)
      break;
    }
    cursor = nextCursor;
  }
  return out;
}

// calcula resumen pago (deuda + próximo periodo pendiente)
async function resumenInscripcion({ inscripcion_id, curso }) {
  const freq = curso.pago_frecuencia || "Mensual";
  const montoP = montoPeriodo(curso.precio, freq);

  const periodos = generarPeriodosHastaHoy(curso.fecha_inicio, freq);
  const pagadoMap = await getSumPagadoPorPeriodo(inscripcion_id);

  let deudaTotal = 0;
  let proximo = null;

  for (const p of periodos) {
    const k = `${p.inicio}|${p.fin}`;
    const pagado = Number(pagadoMap.get(k) || 0);
    const restante = money2(montoP - pagado);

    if (restante > 0.001) {
      deudaTotal = money2(deudaTotal + restante);
      if (!proximo) proximo = { ...p, pagado, restante, monto_periodo: montoP };
    }
  }

  // si no debe nada, próximo = periodo actual con restante 0 (para pagar adelantado si quieres)
  if (!proximo && periodos.length) {
    const last = periodos[periodos.length - 1];
    const k = `${last.inicio}|${last.fin}`;
    const pagado = Number(pagadoMap.get(k) || 0);
    proximo = { ...last, pagado, restante: 0, monto_periodo: montoP };
  }

  return {
    deuda_total: deudaTotal,
    proximo_periodo: proximo,
    monto_periodo: montoP,
    frecuencia: freq,
    estado: deudaTotal > 0 ? "DEBE" : "AL_DIA",
  };
}

// ===============================
// GET /api/pagos/resumen?curso_id=1
// ===============================
router.get("/resumen", async (req, res) => {
  try {
    const cursoId = Number(req.query.curso_id || 0);
    if (!cursoId) return res.status(400).json({ error: "curso_id requerido" });

    const curso = await getCurso(cursoId);
    if (!curso) return res.status(404).json({ error: "Curso no encontrado" });

    const insc = await getInscripcionesActivas(cursoId);

    const out = [];
    for (const r of insc) {
      const calc = await resumenInscripcion({ inscripcion_id: r.inscripcion_id, curso });
      out.push({
        inscripcion_id: r.inscripcion_id,
        alumno_id: r.alumno_id,
        alumno_nombre: r.alumno_nombre,
        alumno_documento: r.alumno_documento,
        estado_pago: calc.estado,
        deuda_total: calc.deuda_total,
        frecuencia: calc.frecuencia,
        monto_periodo: calc.monto_periodo,
        proximo_periodo: calc.proximo_periodo,
      });
    }

    res.json({
      curso: {
        id: curso.id,
        nombre: curso.nombre,
        precio: Number(curso.precio || 0),
        pago_frecuencia: curso.pago_frecuencia || "Mensual",
        fecha_inicio: String(curso.fecha_inicio || "").slice(0, 10),
      },
      data: out,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// ===============================
// GET /api/pagos?inscripcion_id=...
// historial de pagos
// ===============================
router.get("/", async (req, res) => {
  try {
    const inscId = Number(req.query.inscripcion_id || 0);
    if (!inscId) return res.status(400).json({ error: "inscripcion_id requerido" });

    const rows = await db.all(
      `SELECT id, inscripcion_id, curso_id, alumno_id, periodo_inicio, periodo_fin,
              monto, fecha_pago, metodo, nota, created_at
       FROM pagos
       WHERE inscripcion_id = ?
       ORDER BY fecha_pago DESC, id DESC`,
      [inscId]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

// ===============================
// POST /api/pagos
// body:
// { curso_id, inscripcion_id, alumno_id, monto, metodo, nota, fecha_pago, periodo_inicio?, periodo_fin? }
// Si no mandas periodo, el backend paga el próximo periodo pendiente.
// ===============================
router.post("/", async (req, res) => {
  try {
    const cursoId = Number(req.body.curso_id || 0);
    const inscId = Number(req.body.inscripcion_id || 0);
    const alumnoId = Number(req.body.alumno_id || 0);

    let monto = Number(req.body.monto || 0);
    if (!cursoId || !inscId || !alumnoId) {
      return res.status(400).json({ error: "curso_id, inscripcion_id, alumno_id requeridos" });
    }
    if (!(monto > 0)) return res.status(400).json({ error: "monto inválido" });

    const curso = await getCurso(cursoId);
    if (!curso) return res.status(404).json({ error: "Curso no encontrado" });

    const freq = curso.pago_frecuencia || "Mensual";
    const montoP = montoPeriodo(curso.precio, freq);

    // si no mandan periodo, calcula el próximo pendiente
    let periodoInicio = String(req.body.periodo_inicio || "").slice(0, 10);
    let periodoFin = String(req.body.periodo_fin || "").slice(0, 10);

    if (!parseISO(periodoInicio) || !parseISO(periodoFin)) {
      const calc = await resumenInscripcion({ inscripcion_id: inscId, curso });
      const p = calc.proximo_periodo;
      if (!p) return res.status(400).json({ error: "No se pudo calcular periodo" });
      periodoInicio = p.inicio;
      periodoFin = p.fin;

      // si el usuario intenta pagar adelantado y está AL_DIA, igual dejamos pagar pero máximo sugerido
      // no bloqueamos.
    }

    // controla abono mayor al restante (opcional: permitir adelantado)
    // aquí lo dejamos libre, pero tú puedes limitarlo:
    // monto = Math.min(monto, montoP);

    const fechaPago = String(req.body.fecha_pago || hoyISO()).slice(0, 10);
    const metodo = String(req.body.metodo || "Efectivo");
    const nota = String(req.body.nota || "");

    await db.run(
      `INSERT INTO pagos (inscripcion_id, curso_id, alumno_id, periodo_inicio, periodo_fin, monto, fecha_pago, metodo, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inscId, cursoId, alumnoId, periodoInicio, periodoFin, money2(monto), fechaPago, metodo, nota]
    );

    // devuelve resumen actualizado
    const calcNew = await resumenInscripcion({ inscripcion_id: inscId, curso });

    res.json({
      ok: true,
      message: "Pago registrado",
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
      monto: money2(monto),
      monto_periodo: montoP,
      resumen: calcNew,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;

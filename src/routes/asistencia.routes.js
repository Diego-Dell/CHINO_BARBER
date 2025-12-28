// src/routes/asistencia.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

// ===============================
// Middlewares (si en tu server ya existen, reemplaza por los reales)
// ===============================
function authRequired(req, res, next) {
  // si usas sesión:
  // if (!req.session?.user) return res.status(401).json({ ok:false, error:"No autenticado" });
  return next();
}
function adminOnly(req, res, next) {
  // if (!req.session?.user || req.session.user.rol !== "Admin") return res.status(403).json({ ok:false, error:"Acceso denegado" });
  return next();
}

router.use(authRequired);

// ===============================
// Helpers SQLite promisificados
// ===============================
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
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
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ===============================
// Utils
// ===============================
const ESTADOS_VALIDOS = new Set(["Asistio", "Falto", "Justificado"]);

function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  const [y, m, d] = s.split("-").map(Number);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}
function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

// ===============================
// GET /api/asistencia?curso_id=1&fecha=YYYY-MM-DD
// Devuelve inscripciones activas del curso + asistencia del día (si existe)
// ===============================
router.get("/", async (req, res) => {
  try {
    const curso_id = toInt(req.query.curso_id, null);
    const fecha = String(req.query.fecha || todayISO()).trim();

    if (curso_id === null) return res.status(400).json({ ok: false, error: "curso_id es obligatorio" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });

    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        a.telefono AS alumno_telefono,
        a.email AS alumno_email,

        c.id AS curso_id,
        c.nombre AS curso_nombre,

        ? AS fecha,

        s.id AS asistencia_id,
        s.estado AS estado,
        s.observacion AS observacion
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN asistencia s
        ON s.inscripcion_id = i.id
       AND s.fecha = ?
      WHERE i.curso_id = ?
        AND i.estado = 'Activa'
      ORDER BY a.nombre ASC
      `,
      [fecha, fecha, curso_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("[ASISTENCIA][GET]", err);
    return res.status(500).json({ ok: false, error: "Error al obtener asistencia" });
  }
});

// ===============================
// POST /api/asistencia/bulk  (Admin)
// body: { fecha, curso_id, registros:[{inscripcion_id, estado, observacion}] }
// ===============================
router.post("/bulk", adminOnly, async (req, res) => {
  try {
    const { fecha, curso_id, registros } = req.body || {};

    if (!fecha || !curso_id || !Array.isArray(registros) || registros.length === 0) {
      return res.status(400).json({ ok: false, error: "fecha, curso_id y registros son obligatorios" });
    }
    if (!isISODate(String(fecha))) {
      return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });
    }

    const clean = registros
      .map((r) => ({
        inscripcion_id: Number(r.inscripcion_id),
        estado: String(r.estado || "").trim(),
        observacion: String(r.observacion || "").trim(),
      }))
      .filter((r) => r.inscripcion_id > 0 && ESTADOS_VALIDOS.has(r.estado));

    if (!clean.length) return res.status(400).json({ ok: false, error: "Registros inválidos" });

    await dbRun("BEGIN TRANSACTION");

    for (const r of clean) {
      // UPSERT manual (por si no tienes UNIQUE(inscripcion_id, fecha))
      const existing = await dbGet(
        `SELECT id FROM asistencia WHERE inscripcion_id = ? AND fecha = ?`,
        [r.inscripcion_id, fecha]
      );

      if (existing) {
        await dbRun(
          `UPDATE asistencia SET estado = ?, observacion = ? WHERE id = ?`,
          [r.estado, r.observacion || null, existing.id]
        );
      } else {
        await dbRun(
          `INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion) VALUES (?, ?, ?, ?)`,
          [r.inscripcion_id, fecha, r.estado, r.observacion || null]
        );
      }
    }

    await dbRun("COMMIT");
    return res.json({ ok: true, fecha, total: clean.length });
  } catch (err) {
    console.error("[ASISTENCIA][BULK]", err);
    try { await dbRun("ROLLBACK"); } catch (_) {}
    return res.status(500).json({ ok: false, error: "Error al guardar asistencia" });
  }
});

module.exports = router;



// ===============================
// GET /api/asistencia/curso/:curso_id/resumen
// Devuelve: curso + fechas_clase[] + alumnos[] con estados por fecha
// ===============================
router.get("/curso/:curso_id/resumen", async (req, res) => {
  try {
    const curso_id = Number(req.params.curso_id);
    if (!Number.isFinite(curso_id) || curso_id <= 0) {
      return res.status(400).json({ ok: false, error: "curso_id inválido" });
    }

    // 1) Traer curso
    const curso = await dbGet(
      `
      SELECT
        c.*,
        COALESCE(i.nombre,'') AS instructor_nombre
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [curso_id]
    );

    if (!curso) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const nroClases = Number(curso.nro_clases || 0);
    if (!nroClases || nroClases < 1) {
      return res.json({ ok: true, curso, fechas: [], alumnos: [] });
    }

    // 2) Helpers para fechas
    const DIA_MAP = {
      lunes: 1,
      martes: 2,
      miercoles: 3,
      miércoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6,
      sábado: 6,
      domingo: 0,
    };

    function parseDias(diasStr) {
      const s = String(diasStr || "").toLowerCase();
      // soporta: "Martes-Jueves", "Martes, Jueves", "Martes/Jueves"
      const tokens = s
        .split(/[-,/]|y/i)
        .map(x => x.trim())
        .filter(Boolean);

      const nums = [];
      for (const t of tokens) {
        const key = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (DIA_MAP[key] !== undefined) nums.push(DIA_MAP[key]);
      }
      // único + orden
      return [...new Set(nums)].sort((a, b) => a - b);
    }

    function toISO(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    function addDays(d, n) {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    }

    const diasSemana = parseDias(curso.dias);
    const startISO = String(curso.fecha_inicio || "").slice(0, 10);

    // si no hay fecha_inicio o dias, devolvemos vacío para no romper
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !diasSemana.length) {
      return res.json({
        ok: true,
        curso,
        fechas: [],
        alumnos: [],
        warning: "Curso sin fecha_inicio o días configurados",
      });
    }

    // 3) Generar fechas de clases (nro_clases)
    const fechas = [];
    let cursor = new Date(`${startISO}T00:00:00`);
    while (fechas.length < nroClases) {
      const dow = cursor.getDay(); // 0..6
      if (diasSemana.includes(dow)) fechas.push(toISO(cursor));
      cursor = addDays(cursor, 1);
      if (fechas.length > 500) break; // safety
    }

    // 4) Traer alumnos inscritos (Activa)
    const alumnos = await dbAll(
      `
      SELECT
        ins.id AS inscripcion_id,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        a.telefono AS alumno_telefono,
        a.email AS alumno_email,
        ins.estado AS estado_inscripcion
      FROM inscripciones ins
      JOIN alumnos a ON a.id = ins.alumno_id
      WHERE ins.curso_id = ?
        AND ins.estado = 'Activa'
      ORDER BY a.nombre ASC
      `,
      [curso_id]
    );

    if (!alumnos.length) {
      return res.json({ ok: true, curso, fechas, alumnos: [] });
    }

    // 5) Traer asistencia de esas fechas (para esas inscripciones)
    const insIds = alumnos.map(x => x.inscripcion_id);
    const placeholdersIns = insIds.map(() => "?").join(",");
    const placeholdersFechas = fechas.map(() => "?").join(",");

    const asist = await dbAll(
      `
      SELECT inscripcion_id, fecha, estado, observacion
      FROM asistencia
      WHERE inscripcion_id IN (${placeholdersIns})
        AND fecha IN (${placeholdersFechas})
      `,
      [...insIds, ...fechas]
    );

    // index por inscripcion_id -> { fecha: estado }
    const map = new Map();
    for (const r of asist) {
      if (!map.has(r.inscripcion_id)) map.set(r.inscripcion_id, {});
      map.get(r.inscripcion_id)[r.fecha] = {
        estado: r.estado,
        observacion: r.observacion || ""
      };
    }

    const out = alumnos.map(a => ({
      ...a,
      asistencia: map.get(a.inscripcion_id) || {} // { "2025-12-16": {estado,observacion}, ... }
    }));

    return res.json({ ok: true, curso, fechas, alumnos: out });
  } catch (err) {
    console.error("[ASISTENCIA][RESUMEN]", err);
    return res.status(500).json({ ok: false, error: "Error al generar resumen de asistencia" });
  }
});

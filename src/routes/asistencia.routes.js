const express = require("express");
const router = express.Router();
const db = require("../db");

// ===============================
// Helpers
// ===============================
function bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

function normEstado(estado) {
  const e = String(estado || "").trim().toLowerCase();

  // soportar lo que manda el front (A/F/L o textos)
  if (e === "a" || e === "asistio" || e === "asistió" || e.includes("asist")) return "Asistio";
  if (e === "f" || e === "falto" || e === "faltó" || e.includes("falt")) return "Falto";
  if (e === "l" || e === "licencia" || e.includes("lic") || e === "justificado" || e.includes("justif"))
    return "Justificado";

  // default
  return "Asistio";
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // { changes, lastID }
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

// ===============================
// Utils para calcular fechas de clases (según curso)
// ===============================
function parseHorarioPorDia(hp) {
  const txt = String(hp || "");
  const parts = txt.split("|").map((s) => s.trim());

  let fecha_inicio = "";
  let hora_inicio = "";
  let duracion = "";

  for (const p of parts) {
    if (p.startsWith("Inicio:")) fecha_inicio = p.replace("Inicio:", "").trim();
    if (p.startsWith("Hora:")) hora_inicio = p.replace("Hora:", "").trim();
    if (p.startsWith("Dur:")) duracion = p.replace("Dur:", "").trim();
  }
  return { fecha_inicio, hora_inicio, duracion };
}

function parseISO(d) {
  const s = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, day] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function toISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();
  const map = [
    ["lunes", 1],
    ["martes", 2],
    ["miercoles", 3],
    ["miércoles", 3],
    ["jueves", 4],
    ["viernes", 5],
    ["sabado", 6],
    ["sábado", 6],
    ["domingo", 0],
  ];
  const out = new Set();
  for (const [name, idx] of map) if (s.includes(name)) out.add(idx);
  return Array.from(out).sort((a, b) => a - b);
}

// Genera las N fechas de clase según inicio + dias + nro_clases
function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
  const start = parseISO(fecha_inicio);
  const n = toInt(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || n <= 0 || weekdays.length === 0) return [];

  const fechas = [];
  let cursor = new Date(start);

  // seguridad
  const LIMIT = 900;
  let guard = 0;

  while (fechas.length < n && guard < LIMIT) {
    if (weekdays.includes(cursor.getDay())) fechas.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
    guard++;
  }
  return fechas;
}

// ===============================
// GET /api/asistencia?curso_id=1&fecha=YYYY-MM-DD
// Devuelve asistencia de un día para un curso
// ===============================
router.get("/", async (req, res) => {
  try {
    const { curso_id, fecha } = req.query;
    if (!curso_id || !fecha) return bad(res, "Faltan parámetros: curso_id y fecha");

    const sql = `
      SELECT
        a.id,
        a.inscripcion_id,
        a.fecha,
        a.estado,
        a.observacion
      FROM asistencia a
      JOIN inscripciones i ON i.id = a.inscripcion_id
      WHERE i.curso_id = ? AND a.fecha = ?
      ORDER BY a.id DESC
    `;

    const rows = await allAsync(sql, [curso_id, String(fecha).slice(0, 10)]);
    return res.json(rows);
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

// ===============================
// POST /api/asistencia
// Body: { inscripcion_id, fecha, estado, observacion? }
// Upsert manual (UPDATE primero, si no existe INSERT)
// ===============================
router.post("/", async (req, res) => {
  try {
    const { inscripcion_id, fecha, estado, observacion } = req.body || {};
    if (!inscripcion_id || !fecha) return bad(res, "Faltan campos: inscripcion_id y fecha");

    const inscId = Number(inscripcion_id);
    const f = String(fecha).slice(0, 10);
    const est = normEstado(estado);

    // 1) UPDATE
    const up = await runAsync(
      `
      UPDATE asistencia
      SET estado = ?, observacion = ?, updated_at = datetime('now')
      WHERE inscripcion_id = ? AND fecha = ?
      `,
      [est, observacion ?? null, inscId, f]
    );

    // 2) Si no actualizó nada => INSERT
    if (!up.changes) {
      await runAsync(
        `
        INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `,
        [inscId, f, est, observacion ?? null]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

// ===============================
// POST /api/asistencia/bulk
// Body: { items: [{inscripcion_id, fecha, estado, observacion?}, ...] }
// Upsert manual dentro de transacción
// ===============================
router.post("/bulk", (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return bad(res, "items es obligatorio");

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmtUpdate = db.prepare(`
      UPDATE asistencia
      SET estado = ?, observacion = ?, updated_at = datetime('now')
      WHERE inscripcion_id = ? AND fecha = ?
    `);

    const stmtInsert = db.prepare(`
      INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    try {
      let pend = 0;
      let failed = false;

      const done = (err) => {
        if (failed) return;
        if (err) {
          failed = true;
          stmtUpdate.finalize(() => {
            stmtInsert.finalize(() => {
              db.run("ROLLBACK");
              return bad(res, err.message || "Error bulk", 500);
            });
          });
          return;
        }

        pend--;
        if (pend <= 0) {
          stmtUpdate.finalize(() => {
            stmtInsert.finalize(() => {
              db.run("COMMIT", (err2) => {
                if (err2) return bad(res, err2.message, 500);
                return res.json({ ok: true });
              });
            });
          });
        }
      };

      for (const it of items) {
        const insc = Number(it.inscripcion_id ?? it.inscripcionId ?? 0);
        const f = String(it.fecha || "").slice(0, 10);
        if (!insc || !f) continue;

        const est = normEstado(it.estado);
        const obs = it.observacion ?? null;

        pend++;
        stmtUpdate.run([est, obs, insc, f], function (err) {
          if (err) return done(err);

          if (this.changes && this.changes > 0) {
            return done(null);
          }

          stmtInsert.run([insc, f, est, obs], (err2) => done(err2));
        });
      }

      if (pend === 0) {
        stmtUpdate.finalize(() => {
          stmtInsert.finalize(() => {
            db.run("COMMIT", () => res.json({ ok: true }));
          });
        });
      }
    } catch (e) {
      stmtUpdate.finalize(() => {
        stmtInsert.finalize(() => {
          db.run("ROLLBACK");
          return bad(res, e.message || "Error bulk", 500);
        });
      });
    }
  });
});

// ===============================
// GET /api/asistencia/resumen?curso_id=1
// Resumen por alumno: asistio/falto/licencia
// ===============================
router.get("/resumen", async (req, res) => {
  try {
    const { curso_id } = req.query;
    if (!curso_id) return bad(res, "Falta curso_id");

    const sql = `
      SELECT
        i.id AS inscripcion_id,
        al.nombre AS alumno_nombre,
        al.documento AS alumno_documento,
        SUM(CASE WHEN a.estado = 'Asistio' THEN 1 ELSE 0 END) AS asistio,
        SUM(CASE WHEN a.estado = 'Falto' THEN 1 ELSE 0 END) AS falto,
        SUM(CASE WHEN a.estado = 'Justificado' THEN 1 ELSE 0 END) AS licencia
      FROM inscripciones i
      JOIN alumnos al ON al.id = i.alumno_id
      LEFT JOIN asistencia a ON a.inscripcion_id = i.id
      WHERE i.curso_id = ? AND i.estado = 'Activa'
      GROUP BY i.id
      ORDER BY al.nombre ASC
    `;

    const rows = await allAsync(sql, [curso_id]);
    return res.json(rows);
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

// ======================================================
// ✅ NUEVO: GET /api/asistencia/curso/:cursoId/resumen
// (Lo que tu cursos.js llama)
// Devuelve:
// { ok: true, curso: {...}, fechas:[...], alumnos:[{..., asistencia:{[fecha]:{estado}}}] }
// ======================================================
router.get("/curso/:cursoId/resumen", async (req, res) => {
  try {
    const cursoId = toInt(req.params.cursoId, 0);
    if (!cursoId) return bad(res, "cursoId inválido");

    // 1) Curso + instructor
    const curso = await getAsync(
      `
      SELECT 
        c.*,
        COALESCE(i.nombre,'') AS instructor_nombre
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [cursoId]
    );
    if (!curso) return bad(res, "Curso no encontrado", 404);

    // 2) obtener fecha_inicio (desde horario_por_dia si existe)
    let fecha_inicio = String(curso.fecha_inicio || "").slice(0, 10);
    if (!fecha_inicio) {
      const p = parseHorarioPorDia(curso.horario_por_dia);
      fecha_inicio = String(p.fecha_inicio || "").slice(0, 10);
    }

    const nro_clases = toInt(curso.nro_clases, 0);
    const dias = String(curso.dias || "");

    const fechas = buildFechasClases({ fecha_inicio, dias, nro_clases });

    // 3) Alumnos inscritos (Activos)
    const alumnos = await allAsync(
      `
      SELECT
        i.id AS inscripcion_id,
        al.nombre AS alumno_nombre,
        al.documento AS alumno_documento
      FROM inscripciones i
      JOIN alumnos al ON al.id = i.alumno_id
      WHERE i.curso_id = ? AND i.estado = 'Activa'
      ORDER BY al.nombre ASC
      `,
      [cursoId]
    );

    // Si no hay nada, responde igual con estructura válida
    if (!fechas.length || !alumnos.length) {
      return res.json({
        ok: true,
        curso: {
          id: curso.id,
          nombre: curso.nombre,
          instructor_nombre: curso.instructor_nombre || "",
          fecha_inicio,
          dias,
          nro_clases,
        },
        fechas,
        alumnos: alumnos.map((a) => ({
          ...a,
          asistencia: {},
        })),
      });
    }

    // 4) Traer asistencias de esas inscripciones (solo fechas del curso)
    const inscIds = alumnos.map((a) => Number(a.inscripcion_id)).filter(Boolean);
    const placeholders = inscIds.map(() => "?").join(",");

    // (filtrar por rango de fechas del curso para no traer de más)
    const minF = fechas[0];
    const maxF = fechas[fechas.length - 1];

    const asistRows = await allAsync(
      `
      SELECT inscripcion_id, fecha, estado
      FROM asistencia
      WHERE inscripcion_id IN (${placeholders})
        AND fecha >= ? AND fecha <= ?
      `,
      [...inscIds, minF, maxF]
    );

    // 5) Armar mapa asistencia por alumno
    const mapa = new Map(); // inscId -> {fecha: {estado}}
    for (const r of asistRows) {
      const iid = Number(r.inscripcion_id);
      const f = String(r.fecha || "").slice(0, 10);
      if (!iid || !f) continue;
      if (!mapa.has(iid)) mapa.set(iid, {});
      mapa.get(iid)[f] = { estado: r.estado };
    }

    const outAlumnos = alumnos.map((a) => ({
      ...a,
      asistencia: mapa.get(Number(a.inscripcion_id)) || {},
    }));

    return res.json({
      ok: true,
      curso: {
        id: curso.id,
        nombre: curso.nombre,
        instructor_nombre: curso.instructor_nombre || "",
        fecha_inicio,
        dias,
        nro_clases,
      },
      fechas,
      alumnos: outAlumnos,
    });
  } catch (err) {
    console.error("[ASISTENCIA][curso/:id/resumen]", err);
    return bad(res, err.message || "Error", 500);
  }
});

module.exports = router;

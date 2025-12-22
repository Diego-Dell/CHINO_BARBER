// src/routes/inscripciones.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

// ===============================
// SIN LOGIN / SIN SESIONES
// ===============================
function authRequired(req, res, next) {
  return next();
}
function adminOnly(req, res, next) {
  return next();
}
router.use(authRequired);

// ===============================
// Helpers SQLite (promises)
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
function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function normStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}
function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ✅ Tu sistema de cursos usa: Programado | En curso | Finalizado | Cancelado
function cursoEsDisponible(estadoCurso) {
  const e = String(estadoCurso || "").trim().toLowerCase();
  return e === "programado" || e === "en curso" || e === "encurso";
}

// ✅ Inscripciones: Activa | Inactiva (tu front usa "Activa")
function normalizeEstadoInscripcion(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "inactiva" || s === "inactivo") return "Inactiva";
  return "Activa";
}

// ===============================
// Validaciones conectadas
// ===============================
async function getAlumno(alumno_id) {
  const a = await dbGet(
    `SELECT id, nombre, documento, telefono, estado
     FROM alumnos
     WHERE id = ?`,
    [alumno_id]
  );
  if (!a) return { ok: false, code: 400, error: "El alumno no existe" };
  return { ok: true, data: a };
}

async function getCurso(curso_id) {
  const c = await dbGet(
    `SELECT id, nombre, precio, cupo, estado, instructor_id
     FROM cursos
     WHERE id = ?`,
    [curso_id]
  );
  if (!c) return { ok: false, code: 400, error: "El curso no existe" };
  if (!cursoEsDisponible(c.estado)) {
    return { ok: false, code: 400, error: "Curso no disponible (solo Programado / En curso)" };
  }
  return { ok: true, data: c };
}

async function countActivasPorCurso(curso_id) {
  const r = await dbGet(
    `SELECT COUNT(*) AS n
     FROM inscripciones
     WHERE curso_id = ? AND estado = 'Activa'`,
    [curso_id]
  );
  return Number(r?.n || 0);
}

async function validateCupo(curso_id) {
  const curso = await dbGet(`SELECT id, cupo FROM cursos WHERE id = ?`, [curso_id]);
  if (!curso) return { ok: false, code: 400, error: "El curso no existe" };

  const cupo = Number(curso.cupo || 0);
  if (cupo <= 0) return { ok: false, code: 400, error: "Cupo inválido en curso" };

  const activas = await countActivasPorCurso(curso_id);
  if (activas >= cupo) {
    return { ok: false, code: 409, error: "Cupo lleno" };
  }
  return { ok: true, data: { cupo, activas, disponibles: cupo - activas } };
}

async function existeInscripcionActiva(alumno_id, curso_id) {
  const r = await dbGet(
    `SELECT id
     FROM inscripciones
     WHERE alumno_id = ? AND curso_id = ? AND estado = 'Activa'`,
    [alumno_id, curso_id]
  );
  return !!r;
}

// ===============================
// GET /api/inscripciones
// filtros: alumno_id, curso_id, estado, q
// ===============================
router.get("/", async (req, res) => {
  try {
    const alumno_id = toInt(req.query.alumno_id, 0);
    const curso_id = toInt(req.query.curso_id, 0);
    const estado = normStr(req.query.estado); // Activa/Inactiva (opcional)
    const q = normStr(req.query.q);

    const limit = Math.max(1, toInt(req.query.limit, 100));
    const offset = Math.max(0, toInt(req.query.offset, 0));

    const where = [];
    const params = [];

    if (alumno_id) {
      where.push("i.alumno_id = ?");
      params.push(alumno_id);
    }
    if (curso_id) {
      where.push("i.curso_id = ?");
      params.push(curso_id);
    }
    if (estado) {
      const est = normalizeEstadoInscripcion(estado);
      where.push("i.estado = ?");
      params.push(est);
    }
    if (q) {
      where.push("(a.nombre LIKE ? OR a.documento LIKE ? OR c.nombre LIKE ?)");
      params.push(likeWrap(q), likeWrap(q), likeWrap(q));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await dbGet(
      `
      SELECT COUNT(*) AS total
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      ${whereSql}
      `,
      params
    );
    const total = Number(totalRow?.total || 0);

    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,
        i.fecha_inscripcion,
        i.estado AS inscripcion_estado,

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        a.telefono AS alumno_telefono,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        c.precio AS curso_precio,
        c.cupo AS curso_cupo,
        c.estado AS curso_estado,

        ins.id AS instructor_id,
        ins.nombre AS instructor_nombre
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN instructores ins ON ins.id = c.instructor_id
      ${whereSql}
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    console.error("[INSCRIPCIONES][GET]", err);
    return res.status(500).json({ ok: false, error: "Error al listar inscripciones" });
  }
});

// ===============================
// GET /api/inscripciones/por-curso/:curso_id
// Para asistencia.html: lista inscripciones activas + alumno
// ===============================
router.get("/por-curso/:curso_id", async (req, res) => {
  try {
    const curso_id = toInt(req.params.curso_id, 0);
    if (!curso_id) return res.status(400).json({ ok: false, error: "curso_id inválido" });

    const curso = await dbGet(`SELECT id, estado FROM cursos WHERE id = ?`, [curso_id]);
    if (!curso) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      WHERE i.curso_id = ? AND i.estado = 'Activa'
      ORDER BY a.nombre ASC
      `,
      [curso_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("[INSCRIPCIONES][POR-CURSO]", err);
    return res.status(500).json({ ok: false, error: "Error al listar inscripciones por curso" });
  }
});

// ===============================
// GET /api/inscripciones/:id
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await dbGet(
      `
      SELECT
        i.id AS inscripcion_id,
        i.fecha_inscripcion,
        i.estado AS inscripcion_estado,

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        a.telefono AS alumno_telefono,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        c.precio AS curso_precio,
        c.cupo AS curso_cupo,
        c.estado AS curso_estado,

        ins.id AS instructor_id,
        ins.nombre AS instructor_nombre
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN instructores ins ON ins.id = c.instructor_id
      WHERE i.id = ?
      `,
      [id]
    );

    if (!row) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("[INSCRIPCIONES][GET/:id]", err);
    return res.status(500).json({ ok: false, error: "Error al obtener inscripción" });
  }
});

// ===============================
// POST /api/inscripciones
// ✅ compatible con tu front: { alumno_id, curso_id, estado }
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const alumno_id = toInt(req.body?.alumno_id, 0);
    const curso_id = toInt(req.body?.curso_id, 0);

    // tu front manda "Activa" normalmente
    const estado = normalizeEstadoInscripcion(req.body?.estado || "Activa");

    // si no manda fecha, la ponemos hoy
    const fecha_inscripcion = normStr(req.body?.fecha_inscripcion) || todayISO();

    if (!alumno_id || !curso_id) {
      return res.status(400).json({ ok: false, error: "alumno_id y curso_id son obligatorios" });
    }

    const aCheck = await getAlumno(alumno_id);
    if (!aCheck.ok) return res.status(aCheck.code).json({ ok: false, error: aCheck.error });

    const cCheck = await getCurso(curso_id);
    if (!cCheck.ok) return res.status(cCheck.code).json({ ok: false, error: cCheck.error });

    // evitar duplicado activo (misma persona, mismo curso)
    if (estado === "Activa") {
      const dup = await existeInscripcionActiva(alumno_id, curso_id);
      if (dup) {
        return res.status(409).json({ ok: false, error: "Alumno ya inscrito (Activa) en este curso" });
      }

      // validar cupo
      const cupoCheck = await validateCupo(curso_id);
      if (!cupoCheck.ok) return res.status(cupoCheck.code).json({ ok: false, error: cupoCheck.error });
    }

    await dbRun(
      `
      INSERT INTO inscripciones (alumno_id, curso_id, fecha_inscripcion, estado)
      VALUES (?, ?, ?, ?)
      `,
      [alumno_id, curso_id, fecha_inscripcion, estado]
    );

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[INSCRIPCIONES][POST]", err);
    return res.status(500).json({ ok: false, error: "Error al inscribir alumno" });
  }
});

// ===============================
// PUT /api/inscripciones/:id
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(
      `SELECT id, alumno_id, curso_id, fecha_inscripcion, estado FROM inscripciones WHERE id = ?`,
      [id]
    );
    if (!current) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const newEstado = req.body?.estado !== undefined ? normalizeEstadoInscripcion(req.body.estado) : current.estado;
    const newFecha = normStr(req.body?.fecha_inscripcion) || current.fecha_inscripcion || todayISO();

    // reactivar: valida curso disponible + cupo + duplicado activo
    if (current.estado === "Inactiva" && newEstado === "Activa") {
      const cCheck = await getCurso(current.curso_id);
      if (!cCheck.ok) return res.status(cCheck.code).json({ ok: false, error: cCheck.error });

      const dup = await existeInscripcionActiva(current.alumno_id, current.curso_id);
      if (dup) return res.status(409).json({ ok: false, error: "Ya existe otra inscripción Activa en este curso" });

      const cupoCheck = await validateCupo(current.curso_id);
      if (!cupoCheck.ok) return res.status(cupoCheck.code).json({ ok: false, error: cupoCheck.error });
    }

    await dbRun(
      `UPDATE inscripciones SET fecha_inscripcion = ?, estado = ? WHERE id = ?`,
      [newFecha, newEstado, id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[INSCRIPCIONES][PUT]", err);
    return res.status(500).json({ ok: false, error: "Error al actualizar inscripción" });
  }
});

// ===============================
// DELETE /api/inscripciones/:id  (baja lógica)
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    await dbRun(`UPDATE inscripciones SET estado = 'Inactiva' WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[INSCRIPCIONES][DELETE]", err);
    return res.status(500).json({ ok: false, error: "Error al inactivar inscripción" });
  }
});

module.exports = router;

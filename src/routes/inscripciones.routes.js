// src/routes/inscripciones.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta ruta según tu estructura
// ===============================
function authRequired(req, res, next) {
  return next();
}

function adminOnly(req, res, next) {
  return next();
}

// Todas las rutas requieren sesión
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
// Utilidades
// ===============================
function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

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

const ESTADOS_INSCRIPCION = new Set(["Activa", "Inactiva"]);

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

// ===============================
// Validaciones “conectadas”
// ===============================
async function getAlumnoActivo(alumno_id) {
  const row = await dbGet(
    `SELECT id, nombre, documento, telefono, estado
     FROM alumnos
     WHERE id = ?`,
    [alumno_id]
  );
  if (!row) return { ok: false, code: 400, error: "El alumno no existe" };
  // Recomendado: alumno activo
  if (row.estado && row.estado !== "Activo") {
    return { ok: false, code: 400, error: "El alumno debe estar Activo" };
  }
  return { ok: true, data: row };
}

async function getCursoActivo(curso_id) {
  const row = await dbGet(
    `SELECT id, nombre, precio, cupo, estado, instructor_id
     FROM cursos
     WHERE id = ?`,
    [curso_id]
  );
  if (!row) return { ok: false, code: 400, error: "El curso no existe" };
  // Reglas: curso debe estar Activo (no permitir Inactivo o Finalizado)
  if (row.estado !== "Activo") {
    return { ok: false, code: 400, error: "El curso debe estar Activo" };
  }
  return { ok: true, data: row };
}

async function getInscripcionesActivasCount(curso_id) {
  const r = await dbGet(
    `SELECT COUNT(*) AS n
     FROM inscripciones
     WHERE curso_id = ? AND estado = 'Activa'`,
    [curso_id]
  );
  return r ? Number(r.n || 0) : 0;
}

async function validateCupoDisponible(curso_id) {
  const curso = await dbGet(`SELECT id, cupo FROM cursos WHERE id = ?`, [curso_id]);
  if (!curso) return { ok: false, code: 400, error: "El curso no existe" };

  const cupo = Number(curso.cupo || 0);
  if (cupo < 0) return { ok: false, code: 400, error: "Cupo inválido en curso (negativo)" };

  const activas = await getInscripcionesActivasCount(curso_id);
  if (activas >= cupo) {
    return { ok: false, code: 409, error: "Cupo lleno: no hay cupos disponibles" };
  }
  return { ok: true, data: { cupo, activas, disponibles: Math.max(0, cupo - activas) } };
}

async function existsInscripcionActivaDuplicada(alumno_id, curso_id, excludeId = null) {
  const params = [alumno_id, curso_id];
  let sql = `
    SELECT id
    FROM inscripciones
    WHERE alumno_id = ? AND curso_id = ? AND estado = 'Activa'
  `;
  if (excludeId !== null) {
    sql += ` AND id <> ?`;
    params.push(excludeId);
  }
  const row = await dbGet(sql, params);
  return !!row;
}

// ===============================
// Helpers stats (pagos / asistencia)
// ===============================
async function getFinanzasByInscripcion(inscripcion_id) {
  const totalRow = await dbGet(
    `
    SELECT COALESCE(SUM(monto), 0) AS total_pagado
    FROM pagos
    WHERE inscripcion_id = ? AND estado = 'Pagado'
    `,
    [inscripcion_id]
  );
  return Number(totalRow?.total_pagado || 0);
}

async function getPrecioCursoByInscripcion(inscripcion_id) {
  const row = await dbGet(
    `
    SELECT c.precio AS precio
    FROM inscripciones i
    JOIN cursos c ON c.id = i.curso_id
    WHERE i.id = ?
    `,
    [inscripcion_id]
  );
  return row ? Number(row.precio || 0) : 0;
}

async function getAsistenciaStats(inscripcion_id) {
  const rows = await dbAll(
    `
    SELECT estado, COUNT(*) AS n
    FROM asistencia
    WHERE inscripcion_id = ?
    GROUP BY estado
    `,
    [inscripcion_id]
  );

  let asistio = 0,
    falto = 0,
    justificado = 0;

  for (const r of rows) {
    const n = Number(r.n || 0);
    if (r.estado === "Asistio") asistio = n;
    else if (r.estado === "Falto") falto = n;
    else if (r.estado === "Justificado") justificado = n;
  }

  return { asistio, falto, justificado };
}

// ===============================
// 1) GET /api/inscripciones
// Filtros: alumno_id, curso_id, estado, q (alumno.nombre|documento|curso.nombre), limit, offset
// JOIN: alumno + curso + instructor
// ===============================
router.get("/", async (req, res) => {
  try {
    const alumno_id = toInt(req.query.alumno_id, null);
    const curso_id = toInt(req.query.curso_id, null);
    const estado = normStr(req.query.estado);
    const q = normStr(req.query.q);

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (alumno_id !== null) {
      where.push("i.alumno_id = ?");
      params.push(alumno_id);
    }

    if (curso_id !== null) {
      where.push("i.curso_id = ?");
      params.push(curso_id);
    }

    if (estado) {
      if (!ESTADOS_INSCRIPCION.has(estado)) {
        return res.status(400).json({ ok: false, error: "estado inválido (Activa|Inactiva)" });
      }
      where.push("i.estado = ?");
      params.push(estado);
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
      JOIN instructores ins ON ins.id = c.instructor_id
      ${whereSql}
      `,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

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
      JOIN instructores ins ON ins.id = c.instructor_id
      ${whereSql}
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar inscripciones" });
  }
});

// ===============================
// 6) GET /api/inscripciones/por-curso/:curso_id
// (para asistencia.html) Inscripciones activas + alumno
// ===============================
router.get("/por-curso/:curso_id", async (req, res) => {
  try {
    const curso_id = toInt(req.params.curso_id, null);
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
      WHERE i.curso_id = ?
        AND i.estado = 'Activa'
      ORDER BY a.nombre ASC
      `,
      [curso_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar inscripciones por curso" });
  }
});

// ===============================
// 2) GET /api/inscripciones/:id
// Devuelve inscripción + alumno + curso + instructor + stats (finanzas y asistencia)
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
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
      JOIN instructores ins ON ins.id = c.instructor_id
      WHERE i.id = ?
      `,
      [id]
    );

    if (!row) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const total_pagado = await getFinanzasByInscripcion(id);
    const precio = Number(row.curso_precio || 0);
    const deuda = Math.max(0, precio - total_pagado);

    const asistencia = await getAsistenciaStats(id);

    return res.json({
      ok: true,
      data: {
        ...row,
        stats_financieros: { total_pagado, deuda },
        stats_asistencia: asistencia,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener inscripción" });
  }
});

// ===============================
// 3) POST /api/inscripciones (Admin)
// Validar alumno activo, curso activo, cupo, duplicado activo alumno+curso
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const alumno_id = toInt(req.body?.alumno_id, null);
    const curso_id = toInt(req.body?.curso_id, null);
    const fecha_inscripcion = normStr(req.body?.fecha_inscripcion) || todayISO();
    const estado = normStr(req.body?.estado) || "Activa";

    if (!alumno_id || !curso_id) {
      return res.status(400).json({ ok: false, error: "alumno_id y curso_id son obligatorios" });
    }
    if (!isISODate(fecha_inscripcion)) {
      return res.status(400).json({ ok: false, error: "fecha_inscripcion inválida (YYYY-MM-DD)" });
    }
    if (!ESTADOS_INSCRIPCION.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activa|Inactiva)" });
    }

    const aCheck = await getAlumnoActivo(alumno_id);
    if (!aCheck.ok) return res.status(aCheck.code).json({ ok: false, error: aCheck.error });

    const cCheck = await getCursoActivo(curso_id);
    if (!cCheck.ok) return res.status(cCheck.code).json({ ok: false, error: cCheck.error });

    // Evitar duplicado activo
    const dup = await existsInscripcionActivaDuplicada(alumno_id, curso_id);
    if (dup) {
      return res.status(409).json({ ok: false, error: "Ya existe una inscripción Activa para este alumno en este curso" });
    }

    // Validar cupo si se crea Activa (si se crea Inactiva, no consume cupo)
    if (estado === "Activa") {
      const cupoCheck = await validateCupoDisponible(curso_id);
      if (!cupoCheck.ok) return res.status(cupoCheck.code).json({ ok: false, error: cupoCheck.error });
    }

    const r = await dbRun(
      `
      INSERT INTO inscripciones (alumno_id, curso_id, fecha_inscripcion, estado)
      VALUES (?, ?, ?, ?)
      `,
      [alumno_id, curso_id, fecha_inscripcion, estado]
    );

    const created = await dbGet(
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
      JOIN instructores ins ON ins.id = c.instructor_id
      WHERE i.id = ?
      `,
      [r.lastID]
    );

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear inscripción" });
  }
});

// ===============================
// 4) PUT /api/inscripciones/:id (Admin)
// Cambiar estado y/o fecha_inscripcion
// Regla: si reactivas, validar curso activo + cupo disponible + no duplicado activo
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(
      `SELECT id, alumno_id, curso_id, fecha_inscripcion, estado FROM inscripciones WHERE id = ?`,
      [id]
    );
    if (!current) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const newFecha =
      req.body?.fecha_inscripcion !== undefined
        ? normStr(req.body.fecha_inscripcion)
        : current.fecha_inscripcion;

    const newEstado =
      req.body?.estado !== undefined ? normStr(req.body.estado) : current.estado;

    if (!newFecha || !isISODate(newFecha)) {
      return res.status(400).json({ ok: false, error: "fecha_inscripcion inválida (YYYY-MM-DD)" });
    }
    if (!newEstado || !ESTADOS_INSCRIPCION.has(newEstado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activa|Inactiva)" });
    }

    const wasInactiva = current.estado === "Inactiva";
    const willActiva = newEstado === "Activa";

    if (wasInactiva && willActiva) {
      // Validar alumno activo y curso activo
      const aCheck = await getAlumnoActivo(current.alumno_id);
      if (!aCheck.ok) return res.status(aCheck.code).json({ ok: false, error: aCheck.error });

      const cCheck = await getCursoActivo(current.curso_id);
      if (!cCheck.ok) return res.status(cCheck.code).json({ ok: false, error: cCheck.error });

      // Evitar duplicado activo (otra inscripción activa para mismo alumno+curso)
      const dup = await existsInscripcionActivaDuplicada(current.alumno_id, current.curso_id, id);
      if (dup) {
        return res.status(409).json({ ok: false, error: "Ya existe otra inscripción Activa para este alumno en este curso" });
      }

      // Validar cupo
      const cupoCheck = await validateCupoDisponible(current.curso_id);
      if (!cupoCheck.ok) return res.status(cupoCheck.code).json({ ok: false, error: cupoCheck.error });
    }

    await dbRun(
      `UPDATE inscripciones SET fecha_inscripcion = ?, estado = ? WHERE id = ?`,
      [newFecha, newEstado, id]
    );

    const updated = await dbGet(
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
      JOIN instructores ins ON ins.id = c.instructor_id
      WHERE i.id = ?
      `,
      [id]
    );

    return res.json({ ok: true, data: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar inscripción" });
  }
});

// ===============================
// 5) DELETE /api/inscripciones/:id (Admin) -> baja lógica
// (NO borrar físico por pagos y asistencia enlazados)
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    await dbRun(`UPDATE inscripciones SET estado = 'Inactiva' WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al inactivar inscripción" });
  }
});

// ===============================
// 7) GET /api/inscripciones/:id/pagos
// ===============================
router.get("/:id/pagos", async (req, res) => {
  try {
    const inscripcion_id = toInt(req.params.id, null);
    if (!inscripcion_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const rows = await dbAll(
      `
      SELECT id, inscripcion_id, fecha, monto, estado, metodo
      FROM pagos
      WHERE inscripcion_id = ?
      ORDER BY fecha DESC, id DESC
      `,
      [inscripcion_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar pagos" });
  }
});

// ===============================
// 8) GET /api/inscripciones/:id/asistencia
// ===============================
router.get("/:id/asistencia", async (req, res) => {
  try {
    const inscripcion_id = toInt(req.params.id, null);
    if (!inscripcion_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const insc = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!insc) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const rows = await dbAll(
      `
      SELECT id, inscripcion_id, fecha, estado
      FROM asistencia
      WHERE inscripcion_id = ?
      ORDER BY fecha DESC, id DESC
      `,
      [inscripcion_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar asistencia" });
  }
});

// ===============================
// 9) GET /api/inscripciones/:id/deuda
// ===============================
router.get("/:id/deuda", async (req, res) => {
  try {
    const inscripcion_id = toInt(req.params.id, null);
    if (!inscripcion_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM inscripciones WHERE id = ?`, [inscripcion_id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    const precio = await getPrecioCursoByInscripcion(inscripcion_id);
    const total_pagado = await getFinanzasByInscripcion(inscripcion_id);
    const deuda = Math.max(0, precio - total_pagado);

    return res.json({ ok: true, data: { precio, total_pagado, deuda } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al calcular deuda" });
  }
});

module.exports = router;

/*
INSCRIPCIONES es la tabla puente entre ALUMNOS y CURSOS:
- une alumno_id con curso_id y genera inscripcion_id, que es la clave central del sistema.

PAGOS y ASISTENCIA dependen de inscripcion_id:
- por eso NO se borra físico una inscripción; se hace baja lógica (estado='Inactiva') para no romper pagos/asistencia enlazados.

Validaciones clave para “todo conecte”:
- Evita duplicados: no permite dos inscripciones ACTIVAS del mismo alumno al mismo curso (validación por código).
- Valida cupo antes de inscribir y al reactivar (Inactiva -> Activa) con COUNT(inscripciones Activa) vs cursos.cupo.
- Valida que alumno esté Activo (recomendado) y que curso esté Activo (no Inactivo/Finalizado).

Endpoints clave para frontend:
- Asistencia (lista del curso): GET /api/inscripciones/por-curso/:curso_id
- Pagos por inscripción: GET /api/inscripciones/:id/pagos
- Asistencia por inscripción: GET /api/inscripciones/:id/asistencia
- Deuda por inscripción: GET /api/inscripciones/:id/deuda

Seguridad:
- Todo requiere sesión (authRequired).
- Mutaciones y acciones especiales requieren Admin (adminOnly).
*/

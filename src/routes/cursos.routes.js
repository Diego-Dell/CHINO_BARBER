// src/routes/cursos.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database() exportada
const router = express.Router();

// ===============================
// Middlewares (importables o locales)
// ===============================
// Si ya exportas { authRequired, adminOnly } desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta ruta según tu estructura
// Aquí los definimos localmente para que el archivo sea 100% plug & play.

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
// Utilidades / validaciones
// ===============================
const ESTADOS_CURSO = new Set(["Activo", "Inactivo", "Finalizado"]);

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function toNum(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function getInscripcionesActivasCount(curso_id) {
  const row = await dbGet(
    `SELECT COUNT(*) AS n
     FROM inscripciones
     WHERE curso_id = ? AND estado = 'Activa'`,
    [curso_id]
  );
  return row ? Number(row.n || 0) : 0;
}

async function validateInstructorActivo(instructor_id) {
  const row = await dbGet(
    `SELECT id, estado
     FROM instructores
     WHERE id = ?`,
    [instructor_id]
  );
  if (!row) return { ok: false, code: 400, error: "instructor_id no existe" };
  if (row.estado !== "Activo") {
    // Recomendado: exigir activo
    return { ok: false, code: 400, error: "El instructor debe estar Activo" };
  }
  return { ok: true };
}

// ===============================
// 1) GET /api/cursos
// Query: q, estado, instructor_id, limit, offset, withStats=1
// ===============================
router.get("/", async (req, res) => {
  try {
    const q = normStr(req.query.q);
    const estado = normStr(req.query.estado);
    const instructor_id = toInt(req.query.instructor_id, null);
    const withStats = String(req.query.withStats || "").trim() === "1";

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (q) {
      where.push("(c.nombre LIKE ? OR c.nivel LIKE ?)");
      params.push(likeWrap(q), likeWrap(q));
    }

    if (estado) {
      if (!ESTADOS_CURSO.has(estado)) {
        return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo|Finalizado)" });
      }
      where.push("c.estado = ?");
      params.push(estado);
    }

    if (instructor_id !== null) {
      where.push("c.instructor_id = ?");
      params.push(instructor_id);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Total filtrado (sin paginación)
    const totalRow = await dbGet(
      `
      SELECT COUNT(*) AS total
      FROM cursos c
      JOIN instructores i ON i.id = c.instructor_id
      ${whereSql}
      `,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

    let data = [];

    if (!withStats) {
      data = await dbAll(
        `
        SELECT
          c.*,
          i.nombre AS instructor_nombre
        FROM cursos c
        JOIN instructores i ON i.id = c.instructor_id
        ${whereSql}
        ORDER BY c.id DESC
        LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.json({ ok: true, data, meta: { limit, offset, total } });
    }

    // withStats=1: agregamos count de inscripciones activas y cupos disponibles
    data = await dbAll(
      `
      SELECT
        c.*,
        i.nombre AS instructor_nombre,
        COALESCE(x.inscripciones_activas, 0) AS inscripciones_activas,
        (c.cupo - COALESCE(x.inscripciones_activas, 0)) AS cupos_disponibles
      FROM cursos c
      JOIN instructores i ON i.id = c.instructor_id
      LEFT JOIN (
        SELECT curso_id, COUNT(*) AS inscripciones_activas
        FROM inscripciones
        WHERE estado = 'Activa'
        GROUP BY curso_id
      ) x ON x.curso_id = c.id
      ${whereSql}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // Garantizar no negativo visualmente (si alguien dañó datos)
    data = data.map((r) => ({
      ...r,
      inscripciones_activas: Number(r.inscripciones_activas || 0),
      cupos_disponibles: Math.max(0, Number(r.cupos_disponibles || 0)),
    }));

    return res.json({ ok: true, data, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar cursos" });
  }
});

// ===============================
// 2) GET /api/cursos/:id  (detalle + stats)
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const curso = await dbGet(
      `
      SELECT
        c.*,
        i.nombre AS instructor_nombre
      FROM cursos c
      JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [id]
    );

    if (!curso) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const inscripciones_activas = await getInscripcionesActivasCount(id);
    const cupos_disponibles = Math.max(0, Number(curso.cupo || 0) - inscripciones_activas);

    return res.json({
      ok: true,
      data: {
        ...curso,
        inscripciones_activas,
        cupos_disponibles,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener curso" });
  }
});

// ===============================
// 3) POST /api/cursos  (Admin)
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const nombre = normStr(req.body?.nombre);
    const nivel = normStr(req.body?.nivel);
    const nro_clases = toInt(req.body?.nro_clases, null);
    const dias = normStr(req.body?.dias);
    const horario_por_dia = normStr(req.body?.horario_por_dia);

    const precio = toNum(req.body?.precio, null);
    const cupo = toInt(req.body?.cupo, null);
    const estado = normStr(req.body?.estado) || "Activo";
    const instructor_id = toInt(req.body?.instructor_id, null);

    if (!nombre) return res.status(400).json({ ok: false, error: "nombre es obligatorio" });
    if (precio === null || precio < 0) return res.status(400).json({ ok: false, error: "precio inválido (>= 0)" });
    if (cupo === null || cupo < 0) return res.status(400).json({ ok: false, error: "cupo inválido (>= 0)" });

    if (!ESTADOS_CURSO.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo|Finalizado)" });
    }

    if (!instructor_id) {
      return res.status(400).json({ ok: false, error: "instructor_id es obligatorio" });
    }

    const instCheck = await validateInstructorActivo(instructor_id);
    if (!instCheck.ok) {
      return res.status(instCheck.code).json({ ok: false, error: instCheck.error });
    }

    // (Opcional) Duplicado lógico: nombre+nivel
    if (nivel) {
      const dup = await dbGet(
        `SELECT id FROM cursos WHERE LOWER(nombre) = LOWER(?) AND LOWER(nivel) = LOWER(?) LIMIT 1`,
        [nombre, nivel]
      );
      if (dup) {
        return res.status(409).json({ ok: false, error: "Ya existe un curso con el mismo nombre y nivel" });
      }
    }

    const r = await dbRun(
      `
      INSERT INTO cursos
        (nombre, nivel, nro_clases, dias, horario_por_dia, precio, cupo, estado, instructor_id)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        nombre,
        nivel,
        nro_clases,
        dias,
        horario_por_dia,
        precio,
        cupo,
        estado,
        instructor_id,
      ]
    );

    const created = await dbGet(
      `
      SELECT c.*, i.nombre AS instructor_nombre
      FROM cursos c
      JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [r.lastID]
    );

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear curso" });
  }
});

// ===============================
// 4) PUT /api/cursos/:id (Admin)
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(`SELECT * FROM cursos WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const nombre = req.body?.nombre !== undefined ? normStr(req.body.nombre) : current.nombre;
    const nivel = req.body?.nivel !== undefined ? normStr(req.body.nivel) : current.nivel;
    const nro_clases = req.body?.nro_clases !== undefined ? toInt(req.body.nro_clases, null) : current.nro_clases;
    const dias = req.body?.dias !== undefined ? normStr(req.body.dias) : current.dias;
    const horario_por_dia =
      req.body?.horario_por_dia !== undefined ? normStr(req.body.horario_por_dia) : current.horario_por_dia;

    const precio = req.body?.precio !== undefined ? toNum(req.body.precio, null) : Number(current.precio);
    const cupo = req.body?.cupo !== undefined ? toInt(req.body.cupo, null) : Number(current.cupo);
    const estado = req.body?.estado !== undefined ? normStr(req.body.estado) : current.estado;
    const instructor_id =
      req.body?.instructor_id !== undefined ? toInt(req.body.instructor_id, null) : current.instructor_id;

    if (!nombre) return res.status(400).json({ ok: false, error: "nombre no puede quedar vacío" });
    if (precio === null || precio < 0) return res.status(400).json({ ok: false, error: "precio inválido (>= 0)" });
    if (cupo === null || cupo < 0) return res.status(400).json({ ok: false, error: "cupo inválido (>= 0)" });

    if (!ESTADOS_CURSO.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo|Finalizado)" });
    }

    if (!instructor_id) {
      return res.status(400).json({ ok: false, error: "instructor_id es obligatorio" });
    }

    // Validar instructor si cambian o siempre (seguro)
    const instCheck = await validateInstructorActivo(instructor_id);
    if (!instCheck.ok) {
      return res.status(instCheck.code).json({ ok: false, error: instCheck.error });
    }

    // Regla: si cambian cupo, no permitir cupo < inscripciones activas actuales
    const inscripciones_activas = await getInscripcionesActivasCount(id);
    if (cupo < inscripciones_activas) {
      return res.status(409).json({ ok: false, error: "Cupo menor a inscripciones activas" });
    }

    await dbRun(
      `
      UPDATE cursos
      SET
        nombre = ?,
        nivel = ?,
        nro_clases = ?,
        dias = ?,
        horario_por_dia = ?,
        precio = ?,
        cupo = ?,
        estado = ?,
        instructor_id = ?
      WHERE id = ?
      `,
      [
        nombre,
        nivel,
        nro_clases,
        dias,
        horario_por_dia,
        precio,
        cupo,
        estado,
        instructor_id,
        id,
      ]
    );

    const updated = await dbGet(
      `
      SELECT c.*, i.nombre AS instructor_nombre
      FROM cursos c
      JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [id]
    );

    const cupos_disponibles = Math.max(0, cupo - inscripciones_activas);

    return res.json({
      ok: true,
      data: {
        ...updated,
        inscripciones_activas,
        cupos_disponibles,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar curso" });
  }
});

// ===============================
// 5) DELETE /api/cursos/:id (Admin) -> soft delete
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM cursos WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    await dbRun(`UPDATE cursos SET estado = 'Inactivo' WHERE id = ?`, [id]);
    return res.json({ ok: true, data: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al inactivar curso" });
  }
});

// ===============================
// 6) GET /api/cursos/:id/inscritos
// Query: estado=Activa|Inactiva|todas (default Activa)
// ===============================
router.get("/:id/inscritos", async (req, res) => {
  try {
    const curso_id = toInt(req.params.id, null);
    if (!curso_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const curso = await dbGet(`SELECT id FROM cursos WHERE id = ?`, [curso_id]);
    if (!curso) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const estadoQ = String(req.query.estado || "Activa").trim();
    let whereEstado = "";
    const params = [curso_id];

    if (estadoQ === "Activa") {
      whereEstado = "AND ins.estado = 'Activa'";
    } else if (estadoQ === "Inactiva") {
      whereEstado = "AND ins.estado = 'Inactiva'";
    } else if (estadoQ === "todas" || estadoQ === "Todas") {
      whereEstado = "";
    } else {
      return res.status(400).json({ ok: false, error: "estado inválido (Activa|Inactiva|todas)" });
    }

    // Nota: el ERD de ALUMNOS aquí no incluye telefono, pero tu requisito lo pide.
    // Asumimos que existe alumnos.telefono en tu tabla (como en tu ERD de alumnos).
    const rows = await dbAll(
      `
      SELECT
        ins.id AS inscripcion_id,
        ins.fecha_inscripcion,
        ins.estado,
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        a.telefono AS alumno_telefono
      FROM inscripciones ins
      JOIN alumnos a ON a.id = ins.alumno_id
      WHERE ins.curso_id = ?
      ${whereEstado}
      ORDER BY a.nombre ASC
      `,
      params
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar inscritos" });
  }
});

// ===============================
// 7) GET /api/cursos/:id/cupo
// ===============================
router.get("/:id/cupo", async (req, res) => {
  try {
    const curso_id = toInt(req.params.id, null);
    if (!curso_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const curso = await dbGet(`SELECT id, cupo FROM cursos WHERE id = ?`, [curso_id]);
    if (!curso) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const cupo = Number(curso.cupo || 0);
    const inscripciones_activas = await getInscripcionesActivasCount(curso_id);
    const cupos_disponibles = Math.max(0, cupo - inscripciones_activas);

    return res.json({
      ok: true,
      data: { cupo, inscripciones_activas, cupos_disponibles },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al calcular cupo" });
  }
});

module.exports = router;

/*
Cómo “todo conecta”:
- Cursos ↔ Instructores: se hace JOIN por cursos.instructor_id = instructores.id para devolver instructor_nombre.
- Cupos: inscripciones_activas = COUNT(*) en inscripciones WHERE curso_id=? AND estado='Activa';
  cupos_disponibles = cursos.cupo - inscripciones_activas (nunca negativo).
- Validación: al crear/editar, instructor_id debe existir y estar Activo; al editar cupo, no puede ser menor a inscripciones activas.

Qué consume el frontend:
- Listado: GET /api/cursos?withStats=1 (y filtros q/estado/instructor_id/limit/offset)
- Detalle:  GET /api/cursos/:id
- Cupo:    GET /api/cursos/:id/cupo
- Inscritos: GET /api/cursos/:id/inscritos?estado=Activa

Seguridad:
- Todas las rutas requieren sesión (authRequired).
- Mutaciones (POST/PUT/DELETE) requieren rol Admin (adminOnly).
- Regla de negocio para nuevas inscripciones: si curso.estado != 'Activo', no debería permitir inscribir (se valida en inscripciones.routes.js).
*/

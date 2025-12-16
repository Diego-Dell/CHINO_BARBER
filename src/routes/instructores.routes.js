// src/routes/instructores.routes.js
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

const ESTADOS = new Set(["Activo", "Inactivo"]);

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

async function getInstructorById(id) {
  return await dbGet(
    `
    SELECT id, nombre, documento, telefono, email, especialidad, fecha_alta, estado
    FROM instructores
    WHERE id = ?
    `,
    [id]
  );
}

async function documentoExists(documento, excludeId = null) {
  if (!documento) return false;
  const params = [documento];
  let sql = `SELECT id FROM instructores WHERE documento = ?`;
  if (excludeId !== null) {
    sql += ` AND id <> ?`;
    params.push(excludeId);
  }
  const row = await dbGet(sql, params);
  return !!row;
}

async function countDependenciasInstructor(instructor_id) {
  const cursos = await dbGet(
    `SELECT COUNT(*) AS n FROM cursos WHERE instructor_id = ?`,
    [instructor_id]
  );
  const agenda = await dbGet(
    `SELECT COUNT(*) AS n FROM agenda_turnos WHERE instructor_id = ?`,
    [instructor_id]
  );

  // Inventario: puede no existir en algunos proyectos. Si no existe, lo contamos como 0 sin romper.
  let invN = 0;
  try {
    const inv = await dbGet(
      `SELECT COUNT(*) AS n FROM inventario_movimientos WHERE instructor_id = ?`,
      [instructor_id]
    );
    invN = Number(inv?.n || 0);
  } catch (e) {
    invN = 0;
  }

  return {
    cursos: Number(cursos?.n || 0),
    agenda: Number(agenda?.n || 0),
    inventario: invN,
  };
}

// ===============================
// 1) GET /api/instructores
// Filtros: q (nombre, documento, email), estado, soloActivos=1, limit, offset
// Orden: nombre ASC
// ===============================
router.get("/", async (req, res) => {
  try {
    const q = normStr(req.query.q);
    const estado = normStr(req.query.estado);
    const soloActivos = String(req.query.soloActivos || "").trim() === "1";

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (soloActivos) {
      where.push("estado = 'Activo'");
    } else if (estado) {
      if (!ESTADOS.has(estado)) {
        return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo)" });
      }
      where.push("estado = ?");
      params.push(estado);
    }

    if (q) {
      where.push("(nombre LIKE ? OR documento LIKE ? OR email LIKE ?)");
      params.push(likeWrap(q), likeWrap(q), likeWrap(q));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await dbGet(
      `SELECT COUNT(*) AS total FROM instructores ${whereSql}`,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

    const rows = await dbAll(
      `
      SELECT id, nombre, documento, telefono, email, especialidad, estado, fecha_alta
      FROM instructores
      ${whereSql}
      ORDER BY nombre ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar instructores" });
  }
});

// ===============================
// 2) GET /api/instructores/:id
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await getInstructorById(id);
    if (!row) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener instructor" });
  }
});

// ===============================
// 3) POST /api/instructores (Admin)
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const nombre = normStr(req.body?.nombre);
    const documento = normStr(req.body?.documento);
    const telefono = normStr(req.body?.telefono);
    const email = normStr(req.body?.email);
    const especialidad = normStr(req.body?.especialidad);
    const fecha_alta = normStr(req.body?.fecha_alta) || todayISO();
    const estado = normStr(req.body?.estado) || "Activo";

    if (!nombre) return res.status(400).json({ ok: false, error: "nombre es obligatorio" });
    if (!isISODate(fecha_alta)) {
      return res.status(400).json({ ok: false, error: "fecha_alta inválida (YYYY-MM-DD)" });
    }
    if (!ESTADOS.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo)" });
    }

    if (documento) {
      const existsDoc = await documentoExists(documento);
      if (existsDoc) {
        return res.status(409).json({ ok: false, error: "documento ya existe (debe ser UNIQUE)" });
      }
    }

    const r = await dbRun(
      `
      INSERT INTO instructores (nombre, documento, telefono, email, especialidad, fecha_alta, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [nombre, documento, telefono, email, especialidad, fecha_alta, estado]
    );

    const created = await getInstructorById(r.lastID);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear instructor" });
  }
});

// ===============================
// 4) PUT /api/instructores/:id (Admin)
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await getInstructorById(id);
    if (!current) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    const nombre = req.body?.nombre !== undefined ? normStr(req.body.nombre) : current.nombre;
    const documento = req.body?.documento !== undefined ? normStr(req.body.documento) : current.documento;
    const telefono = req.body?.telefono !== undefined ? normStr(req.body.telefono) : current.telefono;
    const email = req.body?.email !== undefined ? normStr(req.body.email) : current.email;
    const especialidad =
      req.body?.especialidad !== undefined ? normStr(req.body.especialidad) : current.especialidad;
    const fecha_alta = req.body?.fecha_alta !== undefined ? normStr(req.body.fecha_alta) : current.fecha_alta;
    const estado = req.body?.estado !== undefined ? normStr(req.body.estado) : current.estado;

    if (!nombre) return res.status(400).json({ ok: false, error: "nombre no puede quedar vacío" });
    if (!isISODate(fecha_alta)) {
      return res.status(400).json({ ok: false, error: "fecha_alta inválida (YYYY-MM-DD)" });
    }
    if (!ESTADOS.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo)" });
    }

    // documento UNIQUE si se cambia / si viene
    if (documento) {
      const existsDoc = await documentoExists(documento, id);
      if (existsDoc) {
        return res.status(409).json({ ok: false, error: "documento ya existe (debe ser UNIQUE)" });
      }
    }

    await dbRun(
      `
      UPDATE instructores
      SET nombre = ?, documento = ?, telefono = ?, email = ?, especialidad = ?, fecha_alta = ?, estado = ?
      WHERE id = ?
      `,
      [nombre, documento, telefono, email, especialidad, fecha_alta, estado, id]
    );

    const updated = await getInstructorById(id);
    return res.json({ ok: true, data: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar instructor" });
  }
});

// ===============================
// 5) DELETE /api/instructores/:id (Admin) -> soft delete (estado='Inactivo')
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await getInstructorById(id);
    if (!exists) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    // Reglas: no borrar físico; si tiene dependencias, igual hacemos soft delete.
    await dbRun(`UPDATE instructores SET estado = 'Inactivo' WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al inactivar instructor" });
  }
});

// ===============================
// 6) GET /api/instructores/:id/cursos
// ===============================
router.get("/:id/cursos", async (req, res) => {
  try {
    const instructor_id = toInt(req.params.id, null);
    if (!instructor_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const inst = await getInstructorById(instructor_id);
    if (!inst) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    const rows = await dbAll(
      `
      SELECT id, nombre, estado, cupo, precio
      FROM cursos
      WHERE instructor_id = ?
      ORDER BY id DESC
      `,
      [instructor_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar cursos del instructor" });
  }
});

// ===============================
// 7) GET /api/instructores/:id/agenda
// Devuelve turnos del instructor + alumno_nombre si existe
// ===============================
router.get("/:id/agenda", async (req, res) => {
  try {
    const instructor_id = toInt(req.params.id, null);
    if (!instructor_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const inst = await getInstructorById(instructor_id);
    if (!inst) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    const rows = await dbAll(
      `
      SELECT
        t.fecha,
        t.hora,
        t.servicio,
        t.estado,
        a.nombre AS alumno_nombre
      FROM agenda_turnos t
      LEFT JOIN alumnos a ON a.id = t.alumno_id
      WHERE t.instructor_id = ?
      ORDER BY t.fecha DESC, t.hora DESC
      `,
      [instructor_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar agenda del instructor" });
  }
});

// ===============================
// 8) GET /api/instructores/:id/uso-inventario
// Movimientos de inventario por instructor
// (Si la tabla no existe o el esquema difiere, responde error claro.)
// ===============================
router.get("/:id/uso-inventario", async (req, res) => {
  try {
    const instructor_id = toInt(req.params.id, null);
    if (!instructor_id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const inst = await getInstructorById(instructor_id);
    if (!inst) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });

    // Asumimos esquema mínimo: fecha, tipo, cantidad, item_nombre, instructor_id
    // Si tu tabla usa JOIN a items, ajusta este SELECT.
    const rows = await dbAll(
      `
      SELECT
        fecha,
        tipo,
        cantidad,
        item_nombre
      FROM inventario_movimientos
      WHERE instructor_id = ?
      ORDER BY fecha DESC, rowid DESC
      `,
      [instructor_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    // Si la tabla no existe: SQLite devuelve "no such table"
    const msg = String(err?.message || "");
    if (msg.includes("no such table")) {
      return res.status(500).json({
        ok: false,
        error: "La tabla inventario_movimientos no existe o no está creada aún",
      });
    }
    if (msg.includes("no such column")) {
      return res.status(500).json({
        ok: false,
        error: "El esquema de inventario_movimientos no coincide (faltan columnas esperadas)",
      });
    }
    return res.status(500).json({ ok: false, error: "Error al listar uso de inventario del instructor" });
  }
});

module.exports = router;

/*
Cómo INSTRUCTORES se conecta con:
- CURSOS: cursos.instructor_id -> permite listar / validar instructor para cursos.
- AGENDA_TURNOS: agenda_turnos.instructor_id -> agenda por instructor (y alumno_nombre si existe).
- INVENTARIO_MOVIMIENTOS: inventario_movimientos.instructor_id -> movimientos asociados (uso de insumos/herramientas).

Por qué soft delete (estado='Inactivo'):
- Instructores se referencian desde cursos/agenda/inventario. No se borra físico para no romper referencias históricas.
- Un instructor Inactivo no debe usarse para nuevos cursos/turnos (eso se valida en cursos.routes.js / agenda.routes.js exigiendo instructor Activo).

Qué consume el frontend:
- Combos (solo activos): GET /api/instructores?soloActivos=1
- Gestión: POST / PUT / DELETE
- Relacionados: /:id/cursos, /:id/agenda, /:id/uso-inventario

Seguridad:
- Todas las rutas requieren sesión (authRequired).
- Mutaciones (POST/PUT/DELETE) requieren rol Admin (adminOnly).
*/

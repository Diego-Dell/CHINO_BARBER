// src/routes/agenda.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta la ruta según tu estructura
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
// Utilidades / validaciones
// ===============================
const ESTADOS = new Set(["Pendiente", "Confirmado", "Atendido", "Cancelado"]);

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

function isTimeHHmm(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [hh, mm] = s.split(":").map((x) => Number(x));
  return (
    Number.isFinite(hh) &&
    Number.isFinite(mm) &&
    hh >= 0 &&
    hh <= 23 &&
    mm >= 0 &&
    mm <= 59
  );
}

async function validateInstructorActivo(instructor_id) {
  const row = await dbGet(
    `SELECT id, estado FROM instructores WHERE id = ?`,
    [instructor_id]
  );
  if (!row) return { ok: false, code: 400, error: "instructor_id no existe" };
  if (row.estado !== "Activo") {
    return { ok: false, code: 400, error: "El instructor debe estar Activo" };
  }
  return { ok: true };
}

async function getAlumno(alumno_id) {
  const row = await dbGet(
    `SELECT id, nombre, documento, telefono FROM alumnos WHERE id = ?`,
    [alumno_id]
  );
  return row || null;
}

async function conflictExists({ instructor_id, fecha, hora, excludeId = null }) {
  const params = [instructor_id, fecha, hora];
  let sql = `
    SELECT id
    FROM agenda_turnos
    WHERE instructor_id = ? AND fecha = ? AND hora = ?
  `;
  if (excludeId !== null) {
    sql += ` AND id <> ?`;
    params.push(excludeId);
  }
  const row = await dbGet(sql, params);
  return !!row;
}

async function getTurnoById(id) {
  return await dbGet(
    `
    SELECT
      t.id, t.fecha, t.hora, t.tipo, t.servicio, t.precio, t.estado, t.notas,
      t.instructor_id, i.nombre AS instructor_nombre,
      t.alumno_id, a.nombre AS alumno_nombre, a.documento AS alumno_documento,
      t.cliente_nombre, t.cliente_telefono
    FROM agenda_turnos t
    JOIN instructores i ON i.id = t.instructor_id
    LEFT JOIN alumnos a ON a.id = t.alumno_id
    WHERE t.id = ?
    `,
    [id]
  );
}

// ===============================
// 1) GET /api/agenda
// Filtros: fecha, instructor_id, estado, desde, hasta
// Orden: fecha ASC, hora ASC
// ===============================
router.get("/", async (req, res) => {
  try {
    const fecha = normStr(req.query.fecha);
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    const instructor_id = toInt(req.query.instructor_id, null);
    const estado = normStr(req.query.estado);

    const where = [];
    const params = [];

    if (fecha) {
      if (!isISODate(fecha)) {
        return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
      }
      where.push("t.fecha = ?");
      params.push(fecha);
    }

    if (desde || hasta) {
      if (!desde || !hasta) {
        return res.status(400).json({ ok: false, error: "Para rango usa desde y hasta (YYYY-MM-DD)" });
      }
      if (!isISODate(desde) || !isISODate(hasta)) {
        return res.status(400).json({ ok: false, error: "desde/hasta inválidos (YYYY-MM-DD)" });
      }
      where.push("t.fecha BETWEEN ? AND ?");
      params.push(desde, hasta);
    }

    if (instructor_id !== null) {
      where.push("t.instructor_id = ?");
      params.push(instructor_id);
    }

    if (estado) {
      if (!ESTADOS.has(estado)) {
        return res.status(400).json({
          ok: false,
          error: "estado inválido (Pendiente|Confirmado|Atendido|Cancelado)",
        });
      }
      where.push("t.estado = ?");
      params.push(estado);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await dbAll(
      `
      SELECT
        t.id, t.fecha, t.hora, t.tipo, t.servicio, t.precio, t.estado, t.notas,
        t.instructor_id, i.nombre AS instructor_nombre,
        t.alumno_id, a.nombre AS alumno_nombre, a.documento AS alumno_documento,
        t.cliente_nombre, t.cliente_telefono
      FROM agenda_turnos t
      JOIN instructores i ON i.id = t.instructor_id
      LEFT JOIN alumnos a ON a.id = t.alumno_id
      ${whereSql}
      ORDER BY t.fecha ASC, t.hora ASC
      `,
      params
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar agenda" });
  }
});

// ===============================
// 2) GET /api/agenda/:id
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await getTurnoById(id);
    if (!row) return res.status(404).json({ ok: false, error: "Turno no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener turno" });
  }
});

// ===============================
// 3) POST /api/agenda (Admin) -> crear turno
// Validar instructor activo, alumno opcional, autocompletar cliente_* si falta, evitar conflicto
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const fecha = normStr(req.body?.fecha);
    const hora = normStr(req.body?.hora);
    const tipo = normStr(req.body?.tipo);
    const servicio = normStr(req.body?.servicio);
    const precio = toNum(req.body?.precio, null);
    const estado = normStr(req.body?.estado) || "Pendiente";
    const notas = normStr(req.body?.notas);

    const instructor_id = toInt(req.body?.instructor_id, null);
    const alumno_id = toInt(req.body?.alumno_id, null);

    let cliente_nombre = normStr(req.body?.cliente_nombre);
    let cliente_telefono = normStr(req.body?.cliente_telefono);

    if (!fecha || !isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha obligatoria e inválida (YYYY-MM-DD)" });
    }
    if (!hora || !isTimeHHmm(hora)) {
      return res.status(400).json({ ok: false, error: "hora obligatoria e inválida (HH:mm)" });
    }
    if (!instructor_id) {
      return res.status(400).json({ ok: false, error: "instructor_id es obligatorio" });
    }
    if (!ESTADOS.has(estado)) {
      return res.status(400).json({
        ok: false,
        error: "estado inválido (Pendiente|Confirmado|Atendido|Cancelado)",
      });
    }

    const instCheck = await validateInstructorActivo(instructor_id);
    if (!instCheck.ok) {
      return res.status(instCheck.code).json({ ok: false, error: instCheck.error });
    }

    // Conflicto: mismo instructor + fecha + hora
    const conflict = await conflictExists({ instructor_id, fecha, hora });
    if (conflict) {
      return res.status(409).json({ ok: false, error: "Conflicto: el instructor ya tiene un turno en esa fecha y hora" });
    }

    // Si viene alumno_id, validar y autocompletar cliente_* si faltan
    if (alumno_id !== null) {
      const alumno = await getAlumno(alumno_id);
      if (!alumno) {
        return res.status(400).json({ ok: false, error: "alumno_id no existe" });
      }
      if (!cliente_nombre) cliente_nombre = alumno.nombre;
      if (!cliente_telefono) cliente_telefono = alumno.telefono || null;
    }

    const r = await dbRun(
      `
      INSERT INTO agenda_turnos
        (fecha, hora, tipo, cliente_nombre, cliente_telefono, alumno_id, instructor_id, servicio, precio, estado, notas)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fecha,
        hora,
        tipo,
        cliente_nombre,
        cliente_telefono,
        alumno_id,
        instructor_id,
        servicio,
        precio,
        estado,
        notas,
      ]
    );

    const created = await getTurnoById(r.lastID);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear turno" });
  }
});

// ===============================
// 4) PUT /api/agenda/:id (Admin) -> editar turno
// Edita: fecha, hora, tipo, servicio, precio, estado, notas, instructor_id
// Validar conflicto y estado, instructor activo si cambia
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(`SELECT * FROM agenda_turnos WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ ok: false, error: "Turno no encontrado" });

    const fecha = req.body?.fecha !== undefined ? normStr(req.body.fecha) : current.fecha;
    const hora = req.body?.hora !== undefined ? normStr(req.body.hora) : current.hora;
    const tipo = req.body?.tipo !== undefined ? normStr(req.body.tipo) : current.tipo;
    const servicio = req.body?.servicio !== undefined ? normStr(req.body.servicio) : current.servicio;
    const precio = req.body?.precio !== undefined ? toNum(req.body.precio, null) : current.precio;
    const estado = req.body?.estado !== undefined ? normStr(req.body.estado) : current.estado;
    const notas = req.body?.notas !== undefined ? normStr(req.body.notas) : current.notas;

    const instructor_id =
      req.body?.instructor_id !== undefined ? toInt(req.body.instructor_id, null) : current.instructor_id;

    if (!fecha || !isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    }
    if (!hora || !isTimeHHmm(hora)) {
      return res.status(400).json({ ok: false, error: "hora inválida (HH:mm)" });
    }
    if (!instructor_id) {
      return res.status(400).json({ ok: false, error: "instructor_id es obligatorio" });
    }
    if (!ESTADOS.has(estado)) {
      return res.status(400).json({
        ok: false,
        error: "estado inválido (Pendiente|Confirmado|Atendido|Cancelado)",
      });
    }

    // Validar instructor activo (siempre por seguridad)
    const instCheck = await validateInstructorActivo(instructor_id);
    if (!instCheck.ok) {
      return res.status(instCheck.code).json({ ok: false, error: instCheck.error });
    }

    // Conflicto: mismo instructor + fecha + hora, excluyendo este turno
    const conflict = await conflictExists({ instructor_id, fecha, hora, excludeId: id });
    if (conflict) {
      return res.status(409).json({ ok: false, error: "Conflicto: el instructor ya tiene un turno en esa fecha y hora" });
    }

    await dbRun(
      `
      UPDATE agenda_turnos
      SET fecha = ?, hora = ?, tipo = ?, servicio = ?, precio = ?, estado = ?, notas = ?, instructor_id = ?
      WHERE id = ?
      `,
      [fecha, hora, tipo, servicio, precio, estado, notas, instructor_id, id]
    );

    const updated = await getTurnoById(id);
    return res.json({ ok: true, data: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar turno" });
  }
});

// ===============================
// Helpers de cambio de estado
// ===============================
async function setEstadoTurno(id, nuevoEstado) {
  const exists = await dbGet(`SELECT id FROM agenda_turnos WHERE id = ?`, [id]);
  if (!exists) return { ok: false, code: 404, error: "Turno no encontrado" };

  await dbRun(`UPDATE agenda_turnos SET estado = ? WHERE id = ?`, [nuevoEstado, id]);
  const row = await getTurnoById(id);
  return { ok: true, data: row };
}

// 5) POST /api/agenda/:id/confirmar
router.post("/:id/confirmar", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const r = await setEstadoTurno(id, "Confirmado");
    if (!r.ok) return res.status(r.code).json({ ok: false, error: r.error });
    return res.json({ ok: true, data: r.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al confirmar turno" });
  }
});

// 6) POST /api/agenda/:id/cancelar
router.post("/:id/cancelar", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const r = await setEstadoTurno(id, "Cancelado");
    if (!r.ok) return res.status(r.code).json({ ok: false, error: r.error });
    return res.json({ ok: true, data: r.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al cancelar turno" });
  }
});

// 7) POST /api/agenda/:id/atender
router.post("/:id/atender", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const r = await setEstadoTurno(id, "Atendido");
    if (!r.ok) return res.status(r.code).json({ ok: false, error: r.error });
    return res.json({ ok: true, data: r.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al marcar como atendido" });
  }
});

// ===============================
// 8) DELETE /api/agenda/:id (Admin) -> eliminación física
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM agenda_turnos WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Turno no encontrado" });

    await dbRun(`DELETE FROM agenda_turnos WHERE id = ?`, [id]);
    return res.json({ ok: true, data: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al eliminar turno" });
  }
});

module.exports = router;

/*
Cómo conecta AGENDA con ALUMNOS e INSTRUCTORES:
- agenda_turnos.alumno_id (opcional) -> LEFT JOIN alumnos para alumno_nombre y alumno_documento.
- agenda_turnos.instructor_id -> JOIN instructores para instructor_nombre; además se valida que el instructor exista y esté Activo.

Cómo se evita doble turno:
- Antes de crear/editar se verifica conflicto por (instructor_id + fecha + hora). Si existe, responde 409.

Qué endpoints consume el frontend:
- Listar por fecha: GET /api/agenda?fecha=YYYY-MM-DD (también soporta instructor_id, estado y rango desde/hasta)
- Crear: POST /api/agenda
- Editar: PUT /api/agenda/:id
- Cambios de estado: POST /api/agenda/:id/confirmar | /cancelar | /atender
- Eliminar: DELETE /api/agenda/:id

Seguridad:
- Todas las operaciones requieren sesión activa (authRequired).
- Crear/editar/cancelar/confirmar/atender/eliminar requieren rol Admin (adminOnly).
*/

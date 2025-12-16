const express = require("express");
const db = require("../db"); // Importar la instancia de la base de datos SQLite
const router = express.Router();

// Middleware para comprobar si el usuario está autenticado
function authRequired(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

// Middleware para comprobar si el usuario es administrador
function adminOnly(req, res, next) {
  if (req.session.user.rol !== "Admin") {
    return res.status(403).json({ ok: false, error: "Prohibido" });
  }
  next();
}

// Helpers para interactuar con la base de datos
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Ruta para obtener todos los alumnos con filtros
router.get("/api/alumnos", authRequired, async (req, res) => {
  const { q, estado = "Activo", limit = 50, offset = 0 } = req.query;
  const searchQuery = q ? `%${q.trim()}%` : "%";
  const queryEstado = estado === "Activo" || estado === "Inactivo" ? estado : "Activo";
  const limitNum = parseInt(limit, 10);
  const offsetNum = parseInt(offset, 10);

  try {
    const alumnos = await dbAll(
      "SELECT * FROM alumnos WHERE (nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? OR email LIKE ?) AND estado = ? ORDER BY id DESC LIMIT ? OFFSET ?",
      [searchQuery, searchQuery, searchQuery, searchQuery, queryEstado, limitNum, offsetNum]
    );

    const total = await dbGet(
      "SELECT COUNT(*) AS total FROM alumnos WHERE (nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? OR email LIKE ?) AND estado = ?",
      [searchQuery, searchQuery, searchQuery, searchQuery, queryEstado]
    );

    res.json({ ok: true, data: alumnos, meta: { limit: limitNum, offset: offsetNum, total: total.total } });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al obtener los alumnos" });
  }
});

// Ruta para obtener un alumno por ID
router.get("/api/alumnos/:id", authRequired, async (req, res) => {
  const { id } = req.params;

  try {
    const alumno = await dbGet("SELECT * FROM alumnos WHERE id = ?", [id]);
    if (!alumno) {
      return res.status(404).json({ ok: false, error: "Alumno no encontrado" });
    }
    res.json({ ok: true, data: alumno });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al obtener el alumno" });
  }
});

// Ruta para crear un alumno (solo Admin)
router.post("/api/alumnos", authRequired, adminOnly, async (req, res) => {
  const { nombre, documento, telefono, email, fecha_ingreso, estado = "Activo" } = req.body;

  if (!nombre || !documento) {
    return res.status(400).json({ ok: false, error: "Nombre y documento son obligatorios" });
  }

  try {
    // Verificar si el documento ya existe
    const existingAlumno = await dbGet("SELECT * FROM alumnos WHERE documento = ?", [documento]);
    if (existingAlumno) {
      return res.status(409).json({ ok: false, error: "El documento ya está registrado" });
    }

    // Insertar el nuevo alumno
    const result = await dbRun(
      "INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado) VALUES (?, ?, ?, ?, ?, ?)",
      [nombre, documento, telefono, email, fecha_ingreso, estado]
    );

    res.status(201).json({ ok: true, data: { id: result.lastID, nombre, documento, telefono, email, fecha_ingreso, estado } });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al crear el alumno" });
  }
});

// Ruta para actualizar un alumno (solo Admin)
router.put("/api/alumnos/:id", authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { nombre, documento, telefono, email, fecha_ingreso, estado } = req.body;

  if (!nombre || !documento) {
    return res.status(400).json({ ok: false, error: "Nombre y documento son obligatorios" });
  }

  try {
    // Verificar si el documento ya existe en otro alumno
    const existingAlumno = await dbGet("SELECT * FROM alumnos WHERE documento = ? AND id != ?", [documento, id]);
    if (existingAlumno) {
      return res.status(409).json({ ok: false, error: "El documento ya está registrado" });
    }

    // Actualizar el alumno
    await dbRun(
      "UPDATE alumnos SET nombre = ?, documento = ?, telefono = ?, email = ?, fecha_ingreso = ?, estado = ? WHERE id = ?",
      [nombre, documento, telefono, email, fecha_ingreso, estado, id]
    );

    res.json({ ok: true, message: "Alumno actualizado con éxito" });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al actualizar el alumno" });
  }
});

// Ruta para eliminar un alumno (solo Admin)
router.delete("/api/alumnos/:id", authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;

  try {
    await dbRun("UPDATE alumnos SET estado = 'Inactivo' WHERE id = ?", [id]);
    res.json({ ok: true, message: "Alumno inactivado con éxito" });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al inactivar el alumno" });
  }
});

// Ruta para activar un alumno (solo Admin)
router.post("/api/alumnos/:id/activar", authRequired, adminOnly, async (req, res) => {
  const { id } = req.params;

  try {
    await dbRun("UPDATE alumnos SET estado = 'Activo' WHERE id = ?", [id]);
    res.json({ ok: true, message: "Alumno activado con éxito" });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al activar el alumno" });
  }
});

// Ruta para obtener las inscripciones de un alumno (authRequired)
router.get("/api/alumnos/:id/inscripciones", authRequired, async (req, res) => {
  const { id } = req.params;

  try {
    const inscripciones = await dbAll(
      "SELECT inscripciones.id, inscripciones.fecha_inscripcion, inscripciones.estado, cursos.id AS curso_id, cursos.nombre AS curso_nombre, cursos.precio, cursos.estado AS curso_estado FROM inscripciones JOIN cursos ON inscripciones.curso_id = cursos.id WHERE inscripciones.alumno_id = ? ORDER BY inscripciones.id DESC",
      [id]
    );

    res.json({ ok: true, data: inscripciones });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error al obtener las inscripciones" });
  }
});

module.exports = router;

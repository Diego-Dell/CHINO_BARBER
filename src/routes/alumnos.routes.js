const express = require("express");
const db = require("../db"); // Debe exportar sqlite Database()
const router = express.Router();

// ===============================
// Helpers DB
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

function likeWrap(q) {
  return `%${String(q || "").trim()}%`;
}

/**
 * IMPORTANTE:
 * - /search y /by-documento DEBEN IR ANTES que /:id
 */

// =====================================
// GET /api/alumnos/search?q=
// (búsqueda en la tabla)
// =====================================
router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const search = q ? likeWrap(q) : "%";

  try {
    const rows = await dbAll(
      `
      SELECT *
      FROM alumnos
      WHERE (nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? OR email LIKE ?)
      ORDER BY id DESC
      LIMIT 200
      `,
      [search, search, search, search]
    );

    // 👈 Devuelve ARRAY (tu frontend lo espera así)
    return res.json(rows);
  } catch (e) {
    console.error("[ALUMNOS][SEARCH]", e);
    return res.status(500).json({ ok: false, error: "Error al buscar alumnos" });
  }
});

// =====================================
// GET /api/alumnos/by-documento/:doc
// (usado en inscripciones)
// =====================================
router.get("/by-documento/:doc", async (req, res) => {
  const doc = String(req.params.doc || "").trim();
  if (!doc) return res.status(400).json({ ok: false, error: "Documento requerido" });

  try {
    const alumno = await dbGet("SELECT * FROM alumnos WHERE documento = ?", [doc]);
    if (!alumno) {
      return res.status(404).json({ ok: false, error: "Alumno no encontrado" });
    }

    // 👈 Devuelve OBJETO alumno
    return res.json(alumno);
  } catch (e) {
    console.error("[ALUMNOS][BY-DOC]", e);
    return res.status(500).json({ ok: false, error: "Error al buscar alumno" });
  }
});

// =====================================
// GET /api/alumnos
// (carga inicial de la tabla)
// =====================================
router.get("/", async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM alumnos ORDER BY id DESC LIMIT 200"
    );

    // 👈 Devuelve ARRAY
    return res.json(rows);
  } catch (e) {
    console.error("[ALUMNOS][LIST]", e);
    return res.status(500).json({ ok: false, error: "Error al obtener los alumnos" });
  }
});

// =====================================
// GET /api/alumnos/:id
// =====================================
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const alumno = await dbGet("SELECT * FROM alumnos WHERE id = ?", [id]);
    if (!alumno) {
      return res.status(404).json({ ok: false, error: "Alumno no encontrado" });
    }

    return res.json({ ok: true, data: alumno });
  } catch (e) {
    console.error("[ALUMNOS][GET]", e);
    return res.status(500).json({ ok: false, error: "Error al obtener el alumno" });
  }
});

// =====================================
// POST /api/alumnos
// (crear alumno)
// =====================================
router.post("/", async (req, res) => {
  const {
    nombre,
    documento,
    telefono,
    email,
    fecha_ingreso,
    estado = "Activo",
  } = req.body || {};

  if (!nombre || !documento) {
    return res.status(400).json({
      ok: false,
      error: "Nombre y documento son obligatorios",
    });
  }

  try {
    const exists = await dbGet(
      "SELECT id FROM alumnos WHERE documento = ?",
      [documento]
    );
    if (exists) {
      return res
        .status(409)
        .json({ ok: false, error: "El documento ya está registrado" });
    }

    const r = await dbRun(
      `
      INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        nombre,
        documento,
        telefono || null,
        email || null,
        fecha_ingreso || null,
        estado,
      ]
    );

    return res.status(201).json({
      ok: true,
      data: { id: r.lastID },
    });
  } catch (e) {
    console.error("[ALUMNOS][POST]", e);
    return res.status(500).json({ ok: false, error: "Error al crear el alumno" });
  }
});

// =====================================
// PUT /api/alumnos/:id
// (editar alumno)
// =====================================
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  const {
    nombre,
    documento,
    telefono,
    email,
    fecha_ingreso,
    estado = "Activo",
  } = req.body || {};

  if (!nombre || !documento) {
    return res.status(400).json({
      ok: false,
      error: "Nombre y documento son obligatorios",
    });
  }

  try {
    const dup = await dbGet(
      "SELECT id FROM alumnos WHERE documento = ? AND id != ?",
      [documento, id]
    );
    if (dup) {
      return res
        .status(409)
        .json({ ok: false, error: "El documento ya está registrado" });
    }

    await dbRun(
      `
      UPDATE alumnos
      SET nombre = ?, documento = ?, telefono = ?, email = ?, fecha_ingreso = ?, estado = ?
      WHERE id = ?
      `,
      [
        nombre,
        documento,
        telefono || null,
        email || null,
        fecha_ingreso || null,
        estado,
        id,
      ]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[ALUMNOS][PUT]", e);
    return res.status(500).json({ ok: false, error: "Error al actualizar el alumno" });
  }
});

// =====================================
// DELETE /api/alumnos/:id
// (inactivar alumno)
// =====================================
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    await dbRun(
      "UPDATE alumnos SET estado = 'Inactivo' WHERE id = ?",
      [id]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[ALUMNOS][DELETE]", e);
    return res.status(500).json({ ok: false, error: "Error al inactivar el alumno" });
  }
});

module.exports = router;

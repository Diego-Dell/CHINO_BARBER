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
 * Estado AUTOMÁTICO:
 * Activo   = existe al menos 1 inscripción con estado='Activa'
 * Inactivo = si no tiene ninguna inscripción activa
 */
const SELECT_ALUMNOS_WITH_ESTADO = `
  SELECT
    a.id, a.nombre, a.documento, a.telefono, a.email, a.fecha_ingreso,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM inscripciones i
        WHERE i.alumno_id = a.id
          AND i.estado = 'Activa'
      )
      THEN 'Activo'
      ELSE 'Inactivo'
    END AS estado,
    a.created_at, a.updated_at
  FROM alumnos a
`;

/**
 * IMPORTANTE:
 * - /search y /by-documento DEBEN IR ANTES que /:id
 */

// =====================================
// GET /api/alumnos/search?q=
// =====================================
router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const search = q ? likeWrap(q) : "%";

  try {
    const rows = await dbAll(
      `
      ${SELECT_ALUMNOS_WITH_ESTADO}
      WHERE (a.nombre LIKE ? OR a.documento LIKE ? OR a.telefono LIKE ? OR a.email LIKE ?)
      ORDER BY a.id DESC
      LIMIT 200
      `,
      [search, search, search, search]
    );

    return res.json(rows);
  } catch (e) {
    console.error("[ALUMNOS][SEARCH]", e);
    return res.status(500).json({ ok: false, error: "Error al buscar alumnos" });
  }
});

// =====================================
// GET /api/alumnos/by-documento/:doc
// =====================================
router.get("/by-documento/:doc", async (req, res) => {
  const doc = String(req.params.doc || "").trim();
  if (!doc) return res.status(400).json({ ok: false, error: "Documento requerido" });

  try {
    const alumno = await dbGet(
      `
      ${SELECT_ALUMNOS_WITH_ESTADO}
      WHERE a.documento = ?
      LIMIT 1
      `,
      [doc]
    );

    if (!alumno) return res.status(404).json({ ok: false, error: "Alumno no encontrado" });
    return res.json(alumno);
  } catch (e) {
    console.error("[ALUMNOS][BY-DOC]", e);
    return res.status(500).json({ ok: false, error: "Error al buscar alumno" });
  }
});

// =====================================
// GET /api/alumnos
// =====================================
router.get("/", async (req, res) => {
  try {
    const rows = await dbAll(
      `
      ${SELECT_ALUMNOS_WITH_ESTADO}
      ORDER BY a.id DESC
      LIMIT 200
      `
    );
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
    const alumno = await dbGet(
      `
      ${SELECT_ALUMNOS_WITH_ESTADO}
      WHERE a.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!alumno) return res.status(404).json({ ok: false, error: "Alumno no encontrado" });
    return res.json({ ok: true, data: alumno });
  } catch (e) {
    console.error("[ALUMNOS][GET]", e);
    return res.status(500).json({ ok: false, error: "Error al obtener el alumno" });
  }
});

// =====================================
// POST /api/alumnos
// (crear alumno)
// - NO acepta estado desde frontend
// - SIEMPRE se guarda como Inactivo en BD
// =====================================
router.post("/", async (req, res) => {
  const { nombre, documento, telefono, email, fecha_ingreso } = req.body || {};

  if (!nombre || !documento) {
    return res.status(400).json({ ok: false, error: "Nombre y documento son obligatorios" });
  }

  try {
    const exists = await dbGet("SELECT id FROM alumnos WHERE documento = ?", [documento]);
    if (exists) return res.status(409).json({ ok: false, error: "El documento ya está registrado" });

    const r = await dbRun(
      `
      INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado)
      VALUES (?, ?, ?, ?, ?, 'Inactivo')
      `,
      [nombre, documento, telefono || null, email || null, fecha_ingreso || null]
    );

    return res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (e) {
    console.error("[ALUMNOS][POST]", e);
    return res.status(500).json({ ok: false, error: "Error al crear el alumno" });
  }
});

// =====================================
// PUT /api/alumnos/:id
// (editar alumno)
// - NO permite editar estado
// =====================================
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  const { nombre, documento, telefono, email, fecha_ingreso } = req.body || {};

  if (!nombre || !documento) {
    return res.status(400).json({ ok: false, error: "Nombre y documento son obligatorios" });
  }

  try {
    const dup = await dbGet("SELECT id FROM alumnos WHERE documento = ? AND id != ?", [documento, id]);
    if (dup) return res.status(409).json({ ok: false, error: "El documento ya está registrado" });

    await dbRun(
      `
      UPDATE alumnos
      SET nombre = ?, documento = ?, telefono = ?, email = ?, fecha_ingreso = ?
      WHERE id = ?
      `,
      [nombre, documento, telefono || null, email || null, fecha_ingreso || null, id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[ALUMNOS][PUT]", e);
    return res.status(500).json({ ok: false, error: "Error al actualizar el alumno" });
  }
});

// =====================================
// DELETE /api/alumnos/:id
// “baja” lógica:
// - Cancela inscripciones activas
// - Marca alumno Inactivo en BD
// (el estado visual igualmente se calcula por inscripciones)
// =====================================
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    await dbRun("BEGIN");
    await dbRun(`UPDATE inscripciones SET estado = 'Cancelada' WHERE alumno_id = ? AND estado = 'Activa'`, [id]);
    await dbRun(`UPDATE alumnos SET estado = 'Inactivo' WHERE id = ?`, [id]);
    await dbRun("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    console.error("[ALUMNOS][DELETE]", e);
    try { await dbRun("ROLLBACK"); } catch (_) {}
    return res.status(500).json({ ok: false, error: "Error al dar de baja al alumno" });
  }
});

module.exports = router;

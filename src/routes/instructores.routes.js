const express = require("express");
const db = require("../db");
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

// ===============================
// Asegurar tabla instructores (si no existe)
// ===============================
(async () => {
  try {
    await dbRun(
      `
      CREATE TABLE IF NOT EXISTS instructores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        especialidad TEXT,
        telefono TEXT,
        email TEXT,
        estado TEXT NOT NULL DEFAULT 'Activo',
        created_at TEXT
      )
      `
    );
  } catch (e) {
    console.error("[INSTRUCTORES] init table error:", e.message);
  }
})();

/**
 * IMPORTANTE:
 * - /search debe ir antes de /:id
 */

// =====================================
// GET /api/instructores/search?q=
// =====================================
router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const search = q ? likeWrap(q) : "%";
  try {
    const rows = await dbAll(
      `
      SELECT * FROM instructores
      WHERE (nombre LIKE ? OR especialidad LIKE ? OR telefono LIKE ? OR email LIKE ?)
      ORDER BY id DESC
      LIMIT 200
      `,
      [search, search, search, search]
    );
    return res.json(rows);
  } catch (e) {
    console.error("[INSTRUCTORES][SEARCH]", e);
    return res.status(500).json({ ok: false, error: "Error al buscar instructores" });
  }
});

// =====================================
// GET /api/instructores
// =====================================
router.get("/", async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM instructores ORDER BY id DESC LIMIT 200");
    return res.json(rows);
  } catch (e) {
    console.error("[INSTRUCTORES][LIST]", e);
    return res.status(500).json({ ok: false, error: "Error al obtener instructores" });
  }
});

// =====================================
// GET /api/instructores/:id
// =====================================
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const row = await dbGet("SELECT * FROM instructores WHERE id = ?", [id]);
    if (!row) return res.status(404).json({ ok: false, error: "Instructor no encontrado" });
    return res.json({ ok: true, data: row });
  } catch (e) {
    console.error("[INSTRUCTORES][GET]", e);
    return res.status(500).json({ ok: false, error: "Error al obtener instructor" });
  }
});

// =====================================
// POST /api/instructores
// =====================================
router.post("/", async (req, res) => {
  const { nombre, especialidad, telefono, email, estado = "Activo" } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: "Nombre es obligatorio" });

  try {
    const r = await dbRun(
      `
      INSERT INTO instructores (nombre, especialidad, telefono, email, estado, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        String(nombre).trim(),
        especialidad ? String(especialidad).trim() : null,
        telefono ? String(telefono).trim() : null,
        email ? String(email).trim() : null,
        estado || "Activo",
        new Date().toISOString(),
      ]
    );

    return res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (e) {
    console.error("[INSTRUCTORES][POST]", e);
    return res.status(500).json({ ok: false, error: "Error al registrar instructor" });
  }
});

// =====================================
// PUT /api/instructores/:id
// =====================================
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  const { nombre, especialidad, telefono, email, estado = "Activo" } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: "Nombre es obligatorio" });

  try {
    await dbRun(
      `
      UPDATE instructores
      SET nombre = ?, especialidad = ?, telefono = ?, email = ?, estado = ?
      WHERE id = ?
      `,
      [
        String(nombre).trim(),
        especialidad ? String(especialidad).trim() : null,
        telefono ? String(telefono).trim() : null,
        email ? String(email).trim() : null,
        estado || "Activo",
        id,
      ]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[INSTRUCTORES][PUT]", e);
    return res.status(500).json({ ok: false, error: "Error al actualizar instructor" });
  }
});

// =====================================
// DELETE /api/instructores/:id (inactivar)
// =====================================
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    await dbRun("UPDATE instructores SET estado = 'Inactivo' WHERE id = ?", [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[INSTRUCTORES][DELETE]", e);
    return res.status(500).json({ ok: false, error: "Error al inactivar instructor" });
  }
});

module.exports = router;

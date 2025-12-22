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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function likeWrap(q) {
  return `%${String(q || "").trim()}%`;
}

// ===============================
// Asegurar tabla
// - documento NOT NULL (porque tu DB así lo exige)
// ===============================
(async () => {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS instructores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        documento TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        estado TEXT NOT NULL DEFAULT 'Activo',
        created_at TEXT
      )
    `);
  } catch (e) {
    console.error("[INSTRUCTORES] init table error:", e.message);
  }
})();

/**
 * IMPORTANTE:
 * /search debe ir antes de /:id
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
      WHERE (nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? OR email LIKE ?)
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
// (soporta filtros q y estado si tu front los manda)
// =====================================
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();

  try {
    let sql = "SELECT * FROM instructores";
    const params = [];

    const where = [];
    if (q) {
      const s = likeWrap(q);
      where.push("(nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? OR email LIKE ?)");
      params.push(s, s, s, s);
    }
    if (estado && estado !== "Todos") {
      where.push("estado = ?");
      params.push(estado);
    }

    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY id DESC LIMIT 200";

    const rows = await dbAll(sql, params);
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
  // ✅ Acepta documento desde varias llaves por compatibilidad
  const nombre = String(req.body?.nombre || "").trim();
  const documento = String(
    req.body?.documento || req.body?.ci || req.body?.documento_ci || ""
  ).trim();

  const telefono = req.body?.telefono ? String(req.body.telefono).trim() : null;
  const email = req.body?.email ? String(req.body.email).trim() : null;
  const estado = String(req.body?.estado || "Activo").trim();

  if (!nombre) return res.status(400).json({ ok: false, error: "Nombre es obligatorio" });
  if (!documento) return res.status(400).json({ ok: false, error: "Documento/CI es obligatorio" });

  try {
    // opcional: evitar duplicado por documento
    const dup = await dbGet("SELECT id FROM instructores WHERE documento = ?", [documento]);
    if (dup) return res.status(409).json({ ok: false, error: "El documento ya está registrado" });

    const r = await dbRun(
      `
      INSERT INTO instructores (nombre, documento, telefono, email, estado, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [nombre, documento, telefono, email, estado, new Date().toISOString()]
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

  const nombre = String(req.body?.nombre || "").trim();
  const documento = String(
    req.body?.documento || req.body?.ci || req.body?.documento_ci || ""
  ).trim();

  const telefono = req.body?.telefono ? String(req.body.telefono).trim() : null;
  const email = req.body?.email ? String(req.body.email).trim() : null;
  const estado = String(req.body?.estado || "Activo").trim();

  if (!nombre) return res.status(400).json({ ok: false, error: "Nombre es obligatorio" });
  if (!documento) return res.status(400).json({ ok: false, error: "Documento/CI es obligatorio" });

  try {
    const dup = await dbGet(
      "SELECT id FROM instructores WHERE documento = ? AND id != ?",
      [documento, id]
    );
    if (dup) return res.status(409).json({ ok: false, error: "El documento ya está registrado" });

    await dbRun(
      `
      UPDATE instructores
      SET nombre = ?, documento = ?, telefono = ?, email = ?, estado = ?
      WHERE id = ?
      `,
      [nombre, documento, telefono, email, estado, id]
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

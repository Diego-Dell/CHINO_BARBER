const express = require("express");
const db = require("../db");
const router = express.Router();

// ================= HELPERS =================
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

// ================= GET =================
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();

  let sql = `SELECT * FROM instructores WHERE 1=1`;
  const params = [];

  if (q) {
    sql += ` AND (nombre LIKE ? OR documento LIKE ?)`;
    params.push(likeWrap(q), likeWrap(q));
  }

  if (estado) {
    sql += ` AND estado = ?`;
    params.push(estado);
  }

  sql += ` ORDER BY id DESC`;

  try {
    const rows = await dbAll(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("[INSTRUCTORES][GET]", err);
    res.status(500).json({ error: "Error al listar instructores" });
  }
});

// ================= POST =================
router.post("/", async (req, res) => {
  const { nombre, documento, telefono, email, estado = "Activo" } = req.body;

  if (!nombre || !documento) {
    return res.status(400).json({
      error: "Nombre y Documento son obligatorios"
    });
  }

  try {
    // evitar duplicados
    const existe = await dbGet(
      "SELECT id FROM instructores WHERE documento = ?",
      [documento]
    );
    if (existe) {
      return res.status(409).json({
        error: "El documento ya está registrado"
      });
    }

    await dbRun(
      `
      INSERT INTO instructores
      (nombre, documento, telefono, email, estado, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        nombre,
        documento,           // ✅ ORDEN CORRECTO
        telefono || null,
        email || null,
        estado,
        new Date().toISOString()
      ]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[INSTRUCTORES][POST]", err);
    res.status(500).json({
      error: "Error al registrar instructor"
    });
  }
});

// ================= PUT =================
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nombre, documento, telefono, email, estado } = req.body;

  if (!id || !nombre || !documento) {
    return res.status(400).json({
      error: "Datos incompletos"
    });
  }

  try {
    await dbRun(
      `
      UPDATE instructores
      SET nombre = ?, documento = ?, telefono = ?, email = ?, estado = ?
      WHERE id = ?
      `,
      [
        nombre,
        documento,
        telefono || null,
        email || null,
        estado || "Activo",
        id
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[INSTRUCTORES][PUT]", err);
    res.status(500).json({
      error: "Error al actualizar instructor"
    });
  }
});

module.exports = router;

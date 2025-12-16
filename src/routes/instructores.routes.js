const express = require("express");
const router = express.Router();
const db = require("../db"); // IMPORTANTE: db único

// ===================================================
// GET /api/instructores
// Filtros: ?q=nombre|documento  &estado=Activo|Inactivo
// ===================================================
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();

  const where = [];
  const params = [];

  if (q) {
    where.push("(nombre LIKE ? OR documento LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }

  if (estado) {
    where.push("estado = ?");
    params.push(estado);
  }

  const sql = `
    SELECT *
    FROM instructores
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY nombre ASC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ===================================================
// POST /api/instructores
// Crear instructor
// ===================================================
router.post("/", (req, res) => {
  const b = req.body || {};

  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const estado = String(b.estado || "Activo").trim();

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const sql = `
    INSERT INTO instructores (nombre, documento, telefono, email, estado)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [nombre, documento, telefono, email, estado],
    function (err) {
      if (err) {
        if (String(err.message).includes("UNIQUE")) {
          return res.status(409).json({ error: "Documento duplicado" });
        }
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({ ok: true, id: this.lastID });
    }
  );
});

// ===================================================
// PUT /api/instructores/:id
// Editar instructor
// ===================================================
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const b = req.body || {};

  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const estado = String(b.estado || "Activo").trim();

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const sql = `
    UPDATE instructores
    SET nombre = ?,
        documento = ?,
        telefono = ?,
        email = ?,
        estado = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [nombre, documento, telefono, email, estado, id],
    function (err) {
      if (err) {
        if (String(err.message).includes("UNIQUE")) {
          return res.status(409).json({ error: "Documento duplicado" });
        }
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: "Instructor no encontrado" });
      }

      res.json({ ok: true });
    }
  );
});

// ===================================================
// DELETE /api/instructores/:id   (opcional)
// ===================================================
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  db.run("DELETE FROM instructores WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) {
      return res.status(404).json({ error: "Instructor no encontrado" });
    }
    res.json({ ok: true });
  });
});

module.exports = router;

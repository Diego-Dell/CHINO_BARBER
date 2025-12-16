
const express = require("express");
const db = require("../db");
const router = express.Router();

/**
 * GET /api/instructores
 * Lista instructores (con filtros opcionales)
 */
router.get("/", (req, res) => {
  const { q = "", estado = "" } = req.query;

  let sql = "SELECT * FROM instructores WHERE 1=1";
  const params = [];

  if (q) {
    sql += " AND (nombre LIKE ? OR documento LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  if (estado) {
    sql += " AND estado = ?";
    params.push(estado);
  }

  sql += " ORDER BY nombre ASC";

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * POST /api/instructores
 * Crear instructor
 */
router.post("/", (req, res) => {
  const { nombre, documento, telefono, email, estado } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const sql = `
    INSERT INTO instructores (nombre, documento, telefono, email, estado)
    VALUES (?, ?, ?, ?, ?)
  `;

  const params = [
    nombre.trim(),
    documento || "",
    telefono || "",
    email || "",
    estado || "Activo",
  ];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID });
  });
});

/**
 * PUT /api/instructores/:id
 * Editar instructor
 */
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { nombre, documento, telefono, email, estado } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const sql = `
    UPDATE instructores
    SET nombre = ?, documento = ?, telefono = ?, email = ?, estado = ?
    WHERE id = ?
  `;

  const params = [
    nombre.trim(),
    documento || "",
    telefono || "",
    email || "",
    estado || "Activo",
    id,
  ];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

module.exports = router;

const express = require("express");
const db = require("../db");
const router = express.Router();

// GET /api/alumnos  -> lista todos
router.get("/", (req, res) => {
  db.all("SELECT * FROM alumnos ORDER BY nombre ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /api/alumnos/search?q=...
router.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    db.all("SELECT * FROM alumnos ORDER BY nombre ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      return res.json(rows);
    });
    return;
  }
  const like = `%${q}%`;
  db.all(
    "SELECT * FROM alumnos WHERE nombre LIKE ? OR documento LIKE ? ORDER BY nombre ASC",
    [like, like],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// POST /api/alumnos  -> crea alumno nuevo
router.post("/", (req, res) => {
  const { nombre, documento, telefono, email, fecha_ingreso, estado } = req.body;
  if (!nombre || !documento) {
    return res.status(400).json({ error: "Nombre y documento son obligatorios" });
  }

  const sql = `
    INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const params = [
    nombre.trim(),
    documento.trim(),
    telefono || "",
    email || "",
    fecha_ingreso || new Date().toISOString().slice(0, 10),
    estado || "Activo",
  ];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID });
  });
});

module.exports = router;

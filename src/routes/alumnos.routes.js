
const express = require("express");
const db = require("../db");
const router = express.Router();

/* ======================================================
   GET /api/alumnos
   Lista todos los alumnos
====================================================== */
router.get("/", (req, res) => {
  db.all(
    "SELECT * FROM alumnos ORDER BY nombre ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* ======================================================
   GET /api/alumnos/search?q=...
   Busca por nombre o documento (CI)
   👉 usado por tabla y por inscripción
====================================================== */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();

  if (!q) {
    db.all(
      "SELECT * FROM alumnos ORDER BY nombre ASC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(rows);
      }
    );
    return;
  }

  const like = `%${q}%`;
  db.all(
    `SELECT * FROM alumnos
     WHERE nombre LIKE ? OR documento LIKE ?
     ORDER BY nombre ASC`,
    [like, like],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* ======================================================
   GET /api/alumnos/by-documento/:doc
   🔒 BÚSQUEDA EXACTA POR CI (recomendado para inscripción)
====================================================== */
router.get("/by-documento/:doc", (req, res) => {
  const doc = (req.params.doc || "").trim();
  if (!doc) return res.status(400).json({ error: "Documento requerido" });

  db.get(
    "SELECT * FROM alumnos WHERE documento = ?",
    [doc],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Alumno no encontrado" });
      res.json(row);
    }
  );
});

/* ======================================================
   POST /api/alumnos
   Crea alumno nuevo
====================================================== */
router.post("/", (req, res) => {
  const {
    nombre,
    documento,
    telefono,
    email,
    fecha_ingreso,
    estado
  } = req.body;

  if (!nombre || !documento) {
    return res
      .status(400)
      .json({ error: "Nombre y documento son obligatorios" });
  }

  const sql = `
    INSERT INTO alumnos
      (nombre, documento, telefono, email, fecha_ingreso, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const params = [
    nombre.trim(),
    documento.trim(),
    telefono || "",
    email || "",
    fecha_ingreso || new Date().toISOString().slice(0, 10),
    estado || "Activo"
  ];

  db.run(sql, params, function (err) {
    if (err) {
      if (err.message.includes("UNIQUE")) {
        return res
          .status(409)
          .json({ error: "Ya existe un alumno con ese documento" });
      }
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({
      id: this.lastID,
      mensaje: "Alumno creado correctamente"
    });
  });
});

module.exports = router;

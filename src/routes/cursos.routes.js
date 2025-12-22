const express = require("express");
const db = require("../db");
const router = express.Router();

// ✅ SIN LOGIN / SIN AUTH
// Todas las rutas quedan abiertas

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

router.get("/", async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM cursos ORDER BY id DESC");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"Error al listar cursos" });
  }
});

module.exports = router;
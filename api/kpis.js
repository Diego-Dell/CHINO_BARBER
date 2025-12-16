const express = require("express");
const db = require("../db");
const router = express.Router();

// GET /api/kpis/ingresos-mes
router.get("/ingresos-mes", (req, res) => {
  const sql = `
    SELECT substr(fecha,1,7) as periodo, SUM(monto) as total
    FROM pagos
    GROUP BY periodo
    ORDER BY periodo
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const meses = rows.map(r => r.periodo);
    const totales = rows.map(r => r.total);
    res.json({ meses, totales });
  });
});

module.exports = router;

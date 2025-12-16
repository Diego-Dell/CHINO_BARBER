// src/routes/cursos.routes.js
const express = require("express");
const db = require("../db"); // debe exportar tu sqlite Database()
const router = express.Router();

// ===============================
// Helpers
// ===============================
function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function nowISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Guardamos TODO en horario_por_dia (tu tabla no tiene fecha_inicio/hora/duracion separados)
function buildHorario({ fecha_inicio, hora_inicio, duracion }) {
  const fi = String(fecha_inicio || "").trim();
  const hi = String(hora_inicio || "").trim();
  const du = String(duracion || "").trim();

  const parts = [];
  if (fi) parts.push(`Inicio:${fi}`);
  if (hi) parts.push(`Hora:${hi}`);
  if (du) parts.push(`Dur:${du}min`);
  return parts.join(" | ");
}

// ===============================
// GET /api/cursos
// Query:
//   q=texto
//   estado=Programado|En curso|Finalizado|Cancelado
//   instructor_id=1
//   disponibles=1   (solo Programado/En curso)
// ===============================
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();
  const instructor_id = toNum(req.query.instructor_id, 0);
  const disponibles = String(req.query.disponibles || "").trim() === "1";

  const where = [];
  const params = [];

  if (q) {
    where.push("(c.nombre LIKE ?)");
    params.push(likeWrap(q));
  }

  if (estado) {
    where.push("c.estado = ?");
    params.push(estado);
  }

  if (instructor_id) {
    where.push("c.instructor_id = ?");
    params.push(instructor_id);
  }

  if (disponibles) {
    where.push("(c.estado IN ('Programado','En curso'))");
  }

  const sql = `
    SELECT
      c.*,
      i.nombre AS instructor_nombre,
      (
        SELECT COUNT(1)
        FROM inscripciones ins
        WHERE ins.curso_id = c.id AND ins.estado = 'Activa'
      ) AS inscritos_activos
    FROM cursos c
    LEFT JOIN instructores i ON i.id = c.instructor_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY c.id DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const out = (rows || []).map(r => {
      const cupo = toNum(r.cupo, 0);
      const act = toNum(r.inscritos_activos, 0);
      return {
        ...r,
        inscritos_activos: act,
        inscritos_texto: `${act}/${cupo}`,
      };
    });

    res.json(out);
  });
});

// ===============================
// GET /api/cursos/:id
// ===============================
router.get("/:id", (req, res) => {
  const id = toNum(req.params.id, 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const sql = `
    SELECT
      c.*,
      i.nombre AS instructor_nombre,
      (
        SELECT COUNT(1)
        FROM inscripciones ins
        WHERE ins.curso_id = c.id AND ins.estado = 'Activa'
      ) AS inscritos_activos
    FROM cursos c
    LEFT JOIN instructores i ON i.id = c.instructor_id
    WHERE c.id = ?
    LIMIT 1
  `;

  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Curso no encontrado" });

    const cupo = toNum(row.cupo, 0);
    const act = toNum(row.inscritos_activos, 0);

    res.json({
      ...row,
      inscritos_activos: act,
      inscritos_texto: `${act}/${cupo}`,
    });
  });
});

// ===============================
// POST /api/cursos
// body esperado (desde tu modal):
// { nombre, instructor_id, fecha_inicio, nro_clases, cupo, dias, hora_inicio, duracion, precio, estado }
// Nota: fecha/hora/duracion se guardan dentro de horario_por_dia
// ===============================
router.post("/", (req, res) => {
  const b = req.body || {};

  const nombre = String(b.nombre || "").trim();
  const instructor_id = toNum(b.instructor_id, null);
  const nro_clases = toNum(b.nro_clases, 0);
  const cupo = toNum(b.cupo, 0);
  const dias = String(b.dias || "").trim();

  const precio = Number(b.precio);
  const precioOk = Number.isFinite(precio) ? precio : 0;

  const estado = String(b.estado || "Programado").trim();
  const fecha_inicio = String(b.fecha_inicio || "").trim() || nowISODate();
  const hora_inicio = String(b.hora_inicio || "").trim();
  const duracion = toNum(b.duracion, 0);

  if (!nombre) return res.status(400).json({ error: "nombre es obligatorio" });
  if (!instructor_id) return res.status(400).json({ error: "instructor_id es obligatorio" });
  if (nro_clases <= 0) return res.status(400).json({ error: "nro_clases debe ser >= 1" });
  if (cupo <= 0) return res.status(400).json({ error: "cupo debe ser >= 1" });
  if (!dias) return res.status(400).json({ error: "dias es obligatorio" });
  if (!hora_inicio) return res.status(400).json({ error: "hora_inicio es obligatorio" });
  if (duracion <= 0) return res.status(400).json({ error: "duracion debe ser >= 1" });

  const horario_por_dia = buildHorario({ fecha_inicio, hora_inicio, duracion });

  const sql = `
    INSERT INTO cursos (nombre, nro_clases, dias, horario_por_dia, precio, cupo, estado, instructor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [nombre, nro_clases, dias, horario_por_dia, precioOk, cupo, estado, instructor_id];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ ok: true, id: this.lastID });
  });
});

// ===============================
// PUT /api/cursos/:id
// Si mandas fecha/hora/duracion, reconstruye horario_por_dia.
// Si NO mandas, deja el horario como estaba.
// ===============================
router.put("/:id", (req, res) => {
  const id = toNum(req.params.id, 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const b = req.body || {};

  const nombre = String(b.nombre || "").trim();
  const instructor_id = toNum(b.instructor_id, null);
  const nro_clases = toNum(b.nro_clases, 0);
  const cupo = toNum(b.cupo, 0);
  const dias = String(b.dias || "").trim();

  const precio = Number(b.precio);
  const precioOk = Number.isFinite(precio) ? precio : 0;

  const estado = String(b.estado || "Programado").trim();

  // opcionales (solo si quieres actualizar horario)
  const fecha_inicio = String(b.fecha_inicio || "").trim();
  const hora_inicio = String(b.hora_inicio || "").trim();
  const duracion = toNum(b.duracion, 0);

  if (!nombre) return res.status(400).json({ error: "nombre es obligatorio" });
  if (!instructor_id) return res.status(400).json({ error: "instructor_id es obligatorio" });
  if (nro_clases <= 0) return res.status(400).json({ error: "nro_clases debe ser >= 1" });
  if (cupo <= 0) return res.status(400).json({ error: "cupo debe ser >= 1" });
  if (!dias) return res.status(400).json({ error: "dias es obligatorio" });

  const horario_por_dia = (fecha_inicio || hora_inicio || duracion)
    ? buildHorario({ fecha_inicio, hora_inicio, duracion })
    : null;

  const sql = `
    UPDATE cursos
    SET
      nombre = ?,
      nro_clases = ?,
      dias = ?,
      horario_por_dia = COALESCE(?, horario_por_dia),
      precio = ?,
      cupo = ?,
      estado = ?,
      instructor_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `;

  const params = [
    nombre,
    nro_clases,
    dias,
    horario_por_dia,
    precioOk,
    cupo,
    estado,
    instructor_id,
    id
  ];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Curso no encontrado" });
    res.json({ ok: true });
  });
});

// ===============================
// DELETE /api/cursos/:id
// ===============================
router.delete("/:id", (req, res) => {
  const id = toNum(req.params.id, 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  db.run("DELETE FROM cursos WHERE id=?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Curso no encontrado" });
    res.json({ ok: true });
  });
});

module.exports = router;

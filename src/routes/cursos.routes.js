const express = require("express");
const db = require("../db");
const router = express.Router();

// ================= helpers =================
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
function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ✅ DB cursos: Programado | En curso | Finalizado | Cancelado
function normalizeEstado(estado) {
  const s = String(estado || "").trim();
  if (!s) return "Programado";
  const low = s.toLowerCase();

  // tu front puede tener "Activo" => lo convertimos a Programado
  if (low === "activo") return "Programado";

  // normalizamos mayúsculas exactas
  if (low === "programado") return "Programado";
  if (low === "en curso" || low === "encurso") return "En curso";
  if (low === "finalizado") return "Finalizado";
  if (low === "cancelado") return "Cancelado";

  return "Programado";
}

// Guardamos estos 3 dentro de horario_por_dia
function buildHorarioPorDia({ fecha_inicio, hora_inicio, duracion }) {
  const parts = [];
  if (fecha_inicio) parts.push(`Inicio:${String(fecha_inicio).trim()}`);
  if (hora_inicio) parts.push(`Hora:${String(hora_inicio).trim()}`);
  if (duracion !== "" && duracion != null) parts.push(`Dur:${String(duracion).trim()}`);
  return parts.join(" | ");
}

function parseHorarioPorDia(hp) {
  const txt = String(hp || "");
  const parts = txt.split("|").map((s) => s.trim());

  let fecha_inicio = "";
  let hora_inicio = "";
  let duracion = "";

  for (const p of parts) {
    if (p.startsWith("Inicio:")) fecha_inicio = p.replace("Inicio:", "").trim();
    if (p.startsWith("Hora:")) hora_inicio = p.replace("Hora:", "").trim();
    if (p.startsWith("Dur:")) duracion = p.replace("Dur:", "").trim();
  }

  return { fecha_inicio, hora_inicio, duracion };
}

// ================= GET /api/cursos =================
router.get("/", async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT 
        c.*,
        i.nombre AS instructor_nombre
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      ORDER BY c.id DESC
      LIMIT 200
    `);

    // ✅ agregamos campos que tu front usa en horarioTexto()
    const out = rows.map((c) => {
      const { fecha_inicio, hora_inicio, duracion } = parseHorarioPorDia(c.horario_por_dia);
      return {
        ...c,
        fecha_inicio,
        hora_inicio,
        duracion: duracion ? toNum(duracion, 0) : 0,
      };
    });

    return res.json(out);
  } catch (err) {
    console.error("[CURSOS][GET]", err);
    return res.status(500).json({ ok: false, error: "Error al listar cursos" });
  }
});

// ================= GET /api/cursos/:id =================
router.get("/:id", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const c = await dbGet(
      `
      SELECT 
        c.*,
        i.nombre AS instructor_nombre
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [id]
    );

    if (!c) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    const extra = parseHorarioPorDia(c.horario_por_dia);
    return res.json({ ok: true, data: { ...c, ...extra, duracion: extra.duracion ? toNum(extra.duracion, 0) : 0 } });
  } catch (err) {
    console.error("[CURSOS][GET/:id]", err);
    return res.status(500).json({ ok: false, error: "Error al obtener curso" });
  }
});

// ================= POST /api/cursos =================
// ✅ compatible con tu front: nro_clases + cupo
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};

    const nombre = String(b.nombre || "").trim();
    const instructor_id = toInt(b.instructor_id, 0);

    const fecha_inicio = String(b.fecha_inicio || "").trim();
    const nro_clases = toInt(b.nro_clases, 0);
    const cupo = toInt(b.cupo, 0);

    const dias = String(b.dias || "").trim();
    const hora_inicio = String(b.hora_inicio || "").trim();
    const duracion = toInt(b.duracion, 0);

    const precio = toNum(b.precio, 0);
    const estado = normalizeEstado(b.estado);

    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre del curso es obligatorio" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "Instructor requerido" });
    if (nro_clases < 1) return res.status(400).json({ ok: false, error: "nro_clases inválido" });
    if (cupo < 1) return res.status(400).json({ ok: false, error: "cupo inválido" });
    if (!dias) return res.status(400).json({ ok: false, error: "Días es obligatorio" });
    if (!hora_inicio) return res.status(400).json({ ok: false, error: "Hora inicio es obligatoria" });
    if (duracion < 1) return res.status(400).json({ ok: false, error: "Duración inválida" });

    const horario_por_dia = buildHorarioPorDia({ fecha_inicio, hora_inicio, duracion });

    const r = await dbRun(
      `
      INSERT INTO cursos
      (nombre, nivel, nro_clases, dias, horario_por_dia, precio, cupo, estado, instructor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [nombre, null, nro_clases, dias, horario_por_dia, precio, cupo, estado, instructor_id]
    );

    return res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (err) {
    console.error("[CURSOS][POST]", err);
    return res.status(500).json({ ok: false, error: "Error al crear curso" });
  }
});

// ================= PUT /api/cursos/:id =================
// ✅ compatible con tu front: nro_clases + cupo
router.put("/:id", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const b = req.body || {};

    const nombre = String(b.nombre || "").trim();
    const instructor_id = toInt(b.instructor_id, 0);

    const fecha_inicio = String(b.fecha_inicio || "").trim();
    const nro_clases = toInt(b.nro_clases, 0);
    const cupo = toInt(b.cupo, 0);

    const dias = String(b.dias || "").trim();
    const hora_inicio = String(b.hora_inicio || "").trim();
    const duracion = toInt(b.duracion, 0);

    const precio = toNum(b.precio, 0);
    const estado = normalizeEstado(b.estado);

    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre del curso es obligatorio" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "Instructor requerido" });
    if (nro_clases < 1) return res.status(400).json({ ok: false, error: "nro_clases inválido" });
    if (cupo < 1) return res.status(400).json({ ok: false, error: "cupo inválido" });

    const horario_por_dia = buildHorarioPorDia({ fecha_inicio, hora_inicio, duracion });

    await dbRun(
      `
      UPDATE cursos
      SET nombre = ?,
          nro_clases = ?,
          dias = ?,
          horario_por_dia = ?,
          precio = ?,
          cupo = ?,
          estado = ?,
          instructor_id = ?
      WHERE id = ?
      `,
      [nombre, nro_clases, dias || null, horario_por_dia || null, precio, cupo, estado, instructor_id, id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[CURSOS][PUT]", err);
    return res.status(500).json({ ok: false, error: "Error al actualizar curso" });
  }
});

module.exports = router;

const express = require("express");
const db = require("../db");
const router = express.Router();

// ================= helpers DB =================
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

function escStr(v) {
  return String(v ?? "").trim();
}

// ================= esquema dinámico =================
let _CURSOS_COLS = null;

async function getCursosCols() {
  if (_CURSOS_COLS) return _CURSOS_COLS;
  const rows = await dbAll("PRAGMA table_info(cursos)");
  const cols = new Set(rows.map((r) => String(r.name || "").toLowerCase()));
  _CURSOS_COLS = cols;
  return cols;
}

function hasCol(cols, name) {
  return cols.has(String(name).toLowerCase());
}

// ================= horario_por_dia utils =================
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

// ================= cálculo de estado automático =================
function parseISODate(iso) {
  // iso: YYYY-MM-DD
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  // normalizado a medianoche local
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function addDays(dt, days) {
  const x = new Date(dt);
  x.setDate(x.getDate() + days);
  x.setHours(0, 0, 0, 0);
  return x;
}

function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();

  const map = [
    ["lunes", 1],
    ["martes", 2],
    ["miercoles", 3],
    ["miércoles", 3],
    ["jueves", 4],
    ["viernes", 5],
    ["sabado", 6],
    ["sábado", 6],
    ["domingo", 0],
  ];

  const out = new Set();
  for (const [name, idx] of map) {
    if (s.includes(name)) out.add(idx);
  }
  return Array.from(out).sort((a, b) => a - b);
}

// Devuelve la fecha (Date) de la última clase estimada, según fecha_inicio + dias + nro_clases
function calcFechaUltimaClase({ fecha_inicio, dias, nro_clases }) {
  const start = parseISODate(fecha_inicio);
  const n = toInt(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || n <= 0 || weekdays.length === 0) return null;

  const fechas = [];
  let cursor = new Date(start);

  // seguridad para no loop infinito
  const LIMIT = 900;
  let guard = 0;

  while (fechas.length < n && guard < LIMIT) {
    if (weekdays.includes(cursor.getDay())) {
      fechas.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
    guard++;
  }

  if (!fechas.length) return null;
  return fechas[fechas.length - 1];
}

// Reglas pedidas:
// - Cancelado: si inscritos = 0
// - Programado: si inicia la próxima semana (<= 7 días) o en el futuro cercano
// - Finalizado: si ya pasó la última clase estimada
// - En curso: caso contrario (ya inició y faltan clases)
function calcularEstadoCurso({ fecha_inicio, dias, nro_clases, estado_bd }) {
  // ✅ Regla: un curso NO se vuelve "Cancelado" solo por tener 0 inscriptos.
  // Cancelado debe venir explícito desde BD (si lo usas), o por acción del usuario.
  const estBD = String(estado_bd || "").trim();
  if (estBD === "Cancelado") return "Cancelado";

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const fi = parseISODate(fecha_inicio);
  if (!fi) {
    // si no hay fecha válida, lo tratamos como Programado (seguro)
    return "Programado";
  }

  const limiteProg = addDays(hoy, 7);
  if (fi > hoy && fi <= limiteProg) return "Programado";
  if (fi > limiteProg) return "Programado";

  // Ya inició (fi <= hoy)
  const last = calcFechaUltimaClase({ fecha_inicio, dias, nro_clases });
  if (last) {
    if (hoy > last) return "Finalizado";
  }

  return "En curso";
}


// ================= GET /api/cursos =================
router.get("/", async (req, res) => {
  try {
    const cols = await getCursosCols();

    // Filtro opcional por q / estado (tu front lo manda)
    const q = escStr(req.query.q);
    const estadoQ = escStr(req.query.estado); // Programado|En curso|Finalizado|Cancelado

    // NOTA: como el estado es calculado, filtraremos "estado" en memoria luego.
    const params = [];
    let where = "WHERE 1=1";

    if (q) {
      where += " AND (c.nombre LIKE ?)";
      params.push(`%${q}%`);
    }

    const rows = await dbAll(
      `
      SELECT 
        c.*,
        COALESCE(i.nombre,'') AS instructor_nombre,
        (
          SELECT COUNT(*)
          FROM inscripciones x
          WHERE x.curso_id = c.id AND x.estado = 'Activa'
        ) AS inscritos
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      ${where}
      ORDER BY c.id DESC
      LIMIT 200
      `,
      params
    );

    const out = rows.map((c) => {
      // Sacar fecha/hora/duracion desde horario_por_dia o columnas separadas
      let extra = { fecha_inicio: "", hora_inicio: "", duracion: 0 };

      if (hasCol(cols, "horario_por_dia")) {
        const p = parseHorarioPorDia(c.horario_por_dia);
        extra = {
          fecha_inicio: p.fecha_inicio || "",
          hora_inicio: p.hora_inicio || "",
          duracion: p.duracion ? toNum(p.duracion, 0) : 0,
        };
      } else {
        // soporta columnas separadas si existen
        extra = {
          fecha_inicio: escStr(c.fecha_inicio || ""),
          hora_inicio: escStr(c.hora_inicio || ""),
          duracion: toNum(c.duracion, 0),
        };
      }

      // calcular estado automático
const estadoAuto = calcularEstadoCurso({
  fecha_inicio: extra.fecha_inicio,
  dias: c.dias,
  nro_clases: c.nro_clases,
  estado_bd: c.estado,
});


      return {
        ...c,
        ...extra,
        estado: estadoAuto, // 👈 sobrescribe lo que haya en BD
      };
    });

    // filtrar por estado (calculado) si lo piden
    const filtered = estadoQ ? out.filter((x) => String(x.estado) === estadoQ) : out;

    return res.json(filtered);
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
    const cols = await getCursosCols();

    const c = await dbGet(
      `
      SELECT 
        c.*,
        COALESCE(i.nombre,'') AS instructor_nombre,
        (
          SELECT COUNT(*)
          FROM inscripciones x
          WHERE x.curso_id = c.id AND x.estado = 'Activa'
        ) AS inscritos
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      WHERE c.id = ?
      `,
      [id]
    );

    if (!c) return res.status(404).json({ ok: false, error: "Curso no encontrado" });

    let extra = { fecha_inicio: "", hora_inicio: "", duracion: 0 };

    if (hasCol(cols, "horario_por_dia")) {
      const p = parseHorarioPorDia(c.horario_por_dia);
      extra = {
        fecha_inicio: p.fecha_inicio || "",
        hora_inicio: p.hora_inicio || "",
        duracion: p.duracion ? toNum(p.duracion, 0) : 0,
      };
    } else {
      extra = {
        fecha_inicio: escStr(c.fecha_inicio || ""),
        hora_inicio: escStr(c.hora_inicio || ""),
        duracion: toNum(c.duracion, 0),
      };
    }

    const estadoAuto = calcularEstadoCurso({
      fecha_inicio: extra.fecha_inicio,
      dias: c.dias,
      nro_clases: c.nro_clases,
      inscritos: c.inscritos,
    });

    return res.json({
      ok: true,
      data: {
        ...c,
        ...extra,
        estado: estadoAuto, // 👈 calculado
      },
    });
  } catch (err) {
    console.error("[CURSOS][GET/:id]", err);
    return res.status(500).json({ ok: false, error: "Error al obtener curso" });
  }
});

// ================= POST /api/cursos =================
// ✅ NO acepta estado manual. Se guardará un estado base (Programado) en BD,
//    pero el GET lo sobrescribe con estado calculado.
router.post("/", async (req, res) => {
  try {
    const cols = await getCursosCols();
    const b = req.body || {};

    const nombre = escStr(b.nombre);
    const instructor_id = toInt(b.instructor_id, 0);

    const fecha_inicio = escStr(b.fecha_inicio) || "";
    const nro_clases = toInt(b.nro_clases, 0);
    const cupo = toInt(b.cupo, 0);

    const dias = escStr(b.dias);
    const hora_inicio = escStr(b.hora_inicio);
    const duracion = toInt(b.duracion, 0);

    const precio = toNum(b.precio, 0);

    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre del curso es obligatorio" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "Instructor requerido" });
    if (nro_clases < 1) return res.status(400).json({ ok: false, error: "nro_clases inválido" });
    if (cupo < 1) return res.status(400).json({ ok: false, error: "cupo inválido" });
    if (!dias) return res.status(400).json({ ok: false, error: "Días es obligatorio" });
    if (!hora_inicio) return res.status(400).json({ ok: false, error: "Hora inicio es obligatoria" });
    if (duracion < 1) return res.status(400).json({ ok: false, error: "Duración inválida" });

    // Estado en BD: base (Programado). El “real” se calcula al listar.
    const estadoBD = "Programado";

    if (hasCol(cols, "horario_por_dia")) {
      const horario_por_dia = buildHorarioPorDia({ fecha_inicio, hora_inicio, duracion });

      const r = await dbRun(
        `
        INSERT INTO cursos
        (nombre, nivel, nro_clases, dias, horario_por_dia, precio, cupo, estado, instructor_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [nombre, null, nro_clases, dias, horario_por_dia, precio, cupo, estadoBD, instructor_id]
      );

      return res.status(201).json({ ok: true, data: { id: r.lastID } });
    }

    // Variante con columnas separadas
    // (si tu tabla tiene fecha_inicio/hora_inicio/duracion, esto evitará el error)
    const fields = [];
    const vals = [];

    fields.push("nombre");
    vals.push(nombre);

    if (hasCol(cols, "nivel")) {
      fields.push("nivel");
      vals.push(null);
    }

    fields.push("nro_clases");
    vals.push(nro_clases);

    fields.push("dias");
    vals.push(dias);

    if (hasCol(cols, "fecha_inicio")) {
      fields.push("fecha_inicio");
      vals.push(fecha_inicio || null);
    }
    if (hasCol(cols, "hora_inicio")) {
      fields.push("hora_inicio");
      vals.push(hora_inicio || null);
    }
    if (hasCol(cols, "duracion")) {
      fields.push("duracion");
      vals.push(duracion);
    }

    fields.push("precio");
    vals.push(precio);

    fields.push("cupo");
    vals.push(cupo);

    fields.push("estado");
    vals.push(estadoBD);

    fields.push("instructor_id");
    vals.push(instructor_id);

    const placeholders = fields.map(() => "?").join(", ");
    const sql = `INSERT INTO cursos (${fields.join(", ")}) VALUES (${placeholders})`;

    const r2 = await dbRun(sql, vals);
    return res.status(201).json({ ok: true, data: { id: r2.lastID } });
  } catch (err) {
    console.error("[CURSOS][POST]", err);
    return res.status(500).json({ ok: false, error: "Error al crear curso" });
  }
});

// ================= PUT /api/cursos/:id =================
// ✅ NO permite editar estado manual. Solo actualiza datos del curso.
router.put("/:id", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const cols = await getCursosCols();
    const b = req.body || {};

    const nombre = escStr(b.nombre);
    const instructor_id = toInt(b.instructor_id, 0);

    const fecha_inicio = escStr(b.fecha_inicio) || "";
    const nro_clases = toInt(b.nro_clases, 0);
    const cupo = toInt(b.cupo, 0);

    const dias = escStr(b.dias);
    const hora_inicio = escStr(b.hora_inicio);
    const duracion = toInt(b.duracion, 0);

    const precio = toNum(b.precio, 0);

    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre del curso es obligatorio" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "Instructor requerido" });
    if (nro_clases < 1) return res.status(400).json({ ok: false, error: "nro_clases inválido" });
    if (cupo < 1) return res.status(400).json({ ok: false, error: "cupo inválido" });
    if (!dias) return res.status(400).json({ ok: false, error: "Días es obligatorio" });
    if (!hora_inicio) return res.status(400).json({ ok: false, error: "Hora inicio es obligatoria" });
    if (duracion < 1) return res.status(400).json({ ok: false, error: "Duración inválida" });

    if (hasCol(cols, "horario_por_dia")) {
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
            instructor_id = ?
        WHERE id = ?
        `,
        [nombre, nro_clases, dias || null, horario_por_dia || null, precio, cupo, instructor_id, id]
      );

      return res.json({ ok: true });
    }

    // Variante con columnas separadas: armamos UPDATE dinámico solo con columnas que existen
    const sets = [];
    const vals = [];

    sets.push("nombre = ?");
    vals.push(nombre);

    sets.push("nro_clases = ?");
    vals.push(nro_clases);

    sets.push("dias = ?");
    vals.push(dias || null);

    if (hasCol(cols, "fecha_inicio")) {
      sets.push("fecha_inicio = ?");
      vals.push(fecha_inicio || null);
    }
    if (hasCol(cols, "hora_inicio")) {
      sets.push("hora_inicio = ?");
      vals.push(hora_inicio || null);
    }
    if (hasCol(cols, "duracion")) {
      sets.push("duracion = ?");
      vals.push(duracion);
    }

    sets.push("precio = ?");
    vals.push(precio);

    sets.push("cupo = ?");
    vals.push(cupo);

    sets.push("instructor_id = ?");
    vals.push(instructor_id);

    vals.push(id);

    const sql = `UPDATE cursos SET ${sets.join(", ")} WHERE id = ?`;
    await dbRun(sql, vals);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[CURSOS][PUT]", err);
    return res.status(500).json({ ok: false, error: "Error al actualizar curso" });
  }
});

module.exports = router;

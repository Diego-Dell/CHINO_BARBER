// src/routes/asistencia.routes.js
const express = require("express");
const db = require("../db"); // debe exportar la instancia sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (si no existen globalmente, aquí quedan definidos)
// ===============================
function authRequired(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  if (req.session.user.rol !== "Admin") {
    return res.status(403).json({ ok: false, error: "Prohibido" });
  }
  next();
}

// Todas las rutas requieren sesión
router.use(authRequired);

// ===============================
// Helpers SQLite promisificados
// ===============================
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

// ===============================
// Utilidades
// ===============================
const ESTADOS_VALIDOS = new Set(["Asistio", "Falto", "Justificado"]);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  // Validación estricta para evitar 2025-02-30 etc.
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

async function ensureInscripcionActiva(inscripcion_id) {
  const row = await dbGet(
    `SELECT id, alumno_id, curso_id, estado
     FROM inscripciones
     WHERE id = ?`,
    [inscripcion_id]
  );
  if (!row) return { ok: false, code: 404, error: "La inscripción no existe" };
  if (row.estado !== "Activa") {
    return { ok: false, code: 400, error: "La inscripción está Inactiva" };
  }
  return { ok: true, data: row };
}

// UPSERT por código: (inscripcion_id, fecha) único lógico
async function upsertAsistencia({ inscripcion_id, fecha, estado, observacion }) {
  const existing = await dbGet(
    `SELECT id
     FROM asistencia
     WHERE inscripcion_id = ? AND fecha = ?`,
    [inscripcion_id, fecha]
  );

  if (existing) {
    await dbRun(
      `UPDATE asistencia
       SET estado = ?, observacion = ?
       WHERE id = ?`,
      [estado, observacion ?? null, existing.id]
    );
    const finalRow = await dbGet(`SELECT * FROM asistencia WHERE id = ?`, [existing.id]);
    return { mode: "updated", row: finalRow };
  } else {
    const r = await dbRun(
      `INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion)
       VALUES (?, ?, ?, ?)`,
      [inscripcion_id, fecha, estado, observacion ?? null]
    );
    const finalRow = await dbGet(`SELECT * FROM asistencia WHERE id = ?`, [r.lastID]);
    return { mode: "inserted", row: finalRow };
  }
}

// ===============================
// 1) GET /api/asistencia
// Caso principal: curso_id + fecha => lista inscripciones activas del curso con LEFT JOIN a asistencia del día
// ===============================
router.get("/api/asistencia", async (req, res) => {
  try {
    const curso_id = toInt(req.query.curso_id, null);
    const alumno_id = toInt(req.query.alumno_id, null);
    const inscripcion_id = toInt(req.query.inscripcion_id, null);

    const fecha = (req.query.fecha || todayISO()).trim();
    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });
    }

    // Caso principal para asistencia.html (cuando viene curso_id)
    if (curso_id !== null) {
      const rows = await dbAll(
        `
        SELECT
          i.id AS inscripcion_id,
          a.id AS alumno_id,
          a.nombre AS alumno_nombre,
          a.documento AS alumno_documento,
          c.id AS curso_id,
          c.nombre AS curso_nombre,
          ? AS fecha,
          s.id AS asistencia_id,
          s.estado AS estado,
          s.observacion AS observacion
        FROM inscripciones i
        JOIN alumnos a ON a.id = i.alumno_id
        JOIN cursos  c ON c.id = i.curso_id
        LEFT JOIN asistencia s
          ON s.inscripcion_id = i.id
         AND s.fecha = ?
        WHERE i.curso_id = ?
          AND i.estado = 'Activa'
        ORDER BY a.nombre ASC
        `,
        [fecha, fecha, curso_id]
      );

      // Nota: si no existe asistencia, "estado" vendrá null (el frontend decide qué mostrar).
      return res.json({ ok: true, data: rows });
    }

    // Caso alternativo (filtros generales)
    // Devuelve registros de asistencia existentes + joins, filtrable por alumno_id/inscripcion_id/fecha
    const where = [];
    const params = [];

    // Siempre filtramos por fecha (default hoy) si viene query (o no) para consistencia
    where.push("s.fecha = ?");
    params.push(fecha);

    if (inscripcion_id !== null) {
      where.push("s.inscripcion_id = ?");
      params.push(inscripcion_id);
    }
    if (alumno_id !== null) {
      where.push("i.alumno_id = ?");
      params.push(alumno_id);
    }

    const sql = `
      SELECT
        s.id AS asistencia_id,
        s.inscripcion_id,
        i.alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        i.curso_id,
        c.nombre AS curso_nombre,
        s.fecha,
        s.estado,
        s.observacion
      FROM asistencia s
      JOIN inscripciones i ON i.id = s.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.nombre ASC
    `;

    const rows = await dbAll(sql, params);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener asistencia" });
  }
});

// ===============================
// 2) POST /api/asistencia (Admin) - UPSERT por (inscripcion_id, fecha)
// ===============================
router.post("/api/asistencia", adminOnly, async (req, res) => {
  try {
    const inscripcion_id = toInt(req.body?.inscripcion_id, null);
    const fecha = String(req.body?.fecha || "").trim();
    const estado = String(req.body?.estado || "").trim();
    const observacion = req.body?.observacion ?? null;

    if (!inscripcion_id) {
      return res.status(400).json({ ok: false, error: "inscripcion_id es obligatorio" });
    }
    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });
    }
    if (!ESTADOS_VALIDOS.has(estado)) {
      return res.status(400).json({
        ok: false,
        error: "Estado inválido. Usa: Asistio | Falto | Justificado",
      });
    }

    const check = await ensureInscripcionActiva(inscripcion_id);
    if (!check.ok) {
      return res.status(check.code).json({ ok: false, error: check.error });
    }

    const result = await upsertAsistencia({ inscripcion_id, fecha, estado, observacion });
    return res.json({ ok: true, data: result.row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al guardar asistencia" });
  }
});

// ===============================
// 3) POST /api/asistencia/bulk (Admin) - Transacción + UPSERT por item
// ===============================
router.post("/api/asistencia/bulk", adminOnly, async (req, res) => {
  const fecha = String(req.body?.fecha || "").trim();
  const curso_id = toInt(req.body?.curso_id, null);
  const items = Array.isArray(req.body?.items) ? req.body.items : null;

  if (!isISODate(fecha)) {
    return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });
  }
  if (!curso_id) {
    return res.status(400).json({ ok: false, error: "curso_id es obligatorio" });
  }
  if (!items || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items debe ser un array con elementos" });
  }

  try {
    // Prevalidación: el curso existe (opcional pero útil)
    const curso = await dbGet(`SELECT id FROM cursos WHERE id = ?`, [curso_id]);
    if (!curso) {
      return res.status(404).json({ ok: false, error: "El curso no existe" });
    }

    // Prevalidación de items (sin tocar DB)
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx] || {};
      const inscId = toInt(it.inscripcion_id, null);
      const est = String(it.estado || "").trim();
      if (!inscId) {
        return res.status(400).json({ ok: false, error: `items[${idx}].inscripcion_id inválido` });
      }
      if (!ESTADOS_VALIDOS.has(est)) {
        return res.status(400).json({
          ok: false,
          error: `items[${idx}].estado inválido. Usa: Asistio | Falto | Justificado`,
        });
      }
    }

    await dbRun("BEGIN TRANSACTION");

    let inserted = 0;
    let updated = 0;

    try {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx] || {};
        const inscripcion_id = toInt(it.inscripcion_id, null);
        const estado = String(it.estado || "").trim();
        const observacion = it.observacion ?? null;

        // Validar que la inscripción exista, sea del curso y esté Activa
        const insc = await dbGet(
          `SELECT id, curso_id, estado
           FROM inscripciones
           WHERE id = ?`,
          [inscripcion_id]
        );

        if (!insc) {
          await dbRun("ROLLBACK");
          return res
            .status(404)
            .json({ ok: false, error: `Inscripción no existe (id=${inscripcion_id})` });
        }

        if (insc.curso_id !== curso_id) {
          await dbRun("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: `La inscripción ${inscripcion_id} no pertenece al curso ${curso_id}`,
          });
        }

        if (insc.estado !== "Activa") {
          await dbRun("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: `La inscripción ${inscripcion_id} está Inactiva`,
          });
        }

        // UPSERT por código
        const result = await upsertAsistencia({ inscripcion_id, fecha, estado, observacion });
        if (result.mode === "inserted") inserted++;
        else updated++;
      }

      await dbRun("COMMIT");
      return res.json({
        ok: true,
        data: { inserted, updated, total: items.length },
      });
    } catch (err) {
      await dbRun("ROLLBACK");
      return res.status(500).json({ ok: false, error: "Error al guardar asistencia en lote" });
    }
  } catch (err) {
    // Si falla antes del BEGIN o en checks generales
    return res.status(500).json({ ok: false, error: "Error al procesar asistencia en lote" });
  }
});

// ===============================
// 4) PUT /api/asistencia/:id (Admin)
// Edita estado/observacion/fecha, validando no romper el UNIQUE lógico (inscripcion_id, fecha)
// ===============================
router.put("/api/asistencia/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(`SELECT * FROM asistencia WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ ok: false, error: "Asistencia no encontrada" });

    const fecha = req.body?.fecha !== undefined ? String(req.body.fecha).trim() : current.fecha;
    const estado = req.body?.estado !== undefined ? String(req.body.estado).trim() : current.estado;
    const observacion = req.body?.observacion !== undefined ? req.body.observacion : current.observacion;

    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "Fecha inválida. Usa YYYY-MM-DD" });
    }
    if (!ESTADOS_VALIDOS.has(estado)) {
      return res.status(400).json({
        ok: false,
        error: "Estado inválido. Usa: Asistio | Falto | Justificado",
      });
    }

    // Validar que la inscripción exista y esté Activa (requisito crítico de “todo conecte”)
    const check = await ensureInscripcionActiva(current.inscripcion_id);
    if (!check.ok) {
      return res.status(check.code).json({ ok: false, error: check.error });
    }

    // Evitar colisión del UNIQUE lógico al cambiar fecha
    const conflict = await dbGet(
      `SELECT id
       FROM asistencia
       WHERE inscripcion_id = ? AND fecha = ? AND id <> ?`,
      [current.inscripcion_id, fecha, id]
    );
    if (conflict) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe asistencia para esa inscripción en esa fecha",
      });
    }

    await dbRun(
      `UPDATE asistencia
       SET fecha = ?, estado = ?, observacion = ?
       WHERE id = ?`,
      [fecha, estado, observacion ?? null, id]
    );

    const updatedRow = await dbGet(`SELECT * FROM asistencia WHERE id = ?`, [id]);
    return res.json({ ok: true, data: updatedRow });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar asistencia" });
  }
});

// ===============================
// 5) DELETE /api/asistencia/:id (Admin) - borrado físico (log)
// ===============================
router.delete("/api/asistencia/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM asistencia WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Asistencia no encontrada" });

    await dbRun(`DELETE FROM asistencia WHERE id = ?`, [id]);
    return res.json({ ok: true, data: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al eliminar asistencia" });
  }
});

// ===============================
// 6) GET /api/asistencia/resumen
// Query: curso_id, desde, hasta => conteos por alumno
// ===============================
router.get("/api/asistencia/resumen", async (req, res) => {
  try {
    const curso_id = toInt(req.query.curso_id, null);
    const desde = String(req.query.desde || "").trim();
    const hasta = String(req.query.hasta || "").trim();

    if (!curso_id) return res.status(400).json({ ok: false, error: "curso_id es obligatorio" });
    if (!isISODate(desde) || !isISODate(hasta)) {
      return res.status(400).json({ ok: false, error: "desde/hasta inválidos. Usa YYYY-MM-DD" });
    }

    // Resumen solo para inscripciones activas del curso (si quieres incluir inactivas, quita el filtro i.estado)
    const rows = await dbAll(
      `
      SELECT
        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,
        SUM(CASE WHEN s.estado = 'Asistio' THEN 1 ELSE 0 END) AS total_asistio,
        SUM(CASE WHEN s.estado = 'Falto' THEN 1 ELSE 0 END) AS total_falto,
        SUM(CASE WHEN s.estado = 'Justificado' THEN 1 ELSE 0 END) AS total_justificado,
        COUNT(s.id) AS total_registros
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      LEFT JOIN asistencia s
        ON s.inscripcion_id = i.id
       AND s.fecha BETWEEN ? AND ?
      WHERE i.curso_id = ?
        AND i.estado = 'Activa'
      GROUP BY a.id, a.nombre, a.documento
      ORDER BY a.nombre ASC
      `,
      [desde, hasta, curso_id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener resumen de asistencia" });
  }
});

module.exports = router;

/*
Endpoints incluidos:
- GET    /api/asistencia            (principal para frontend: curso_id + fecha => lista inscripciones activas + LEFT JOIN asistencia del día)
- POST   /api/asistencia            (Admin) UPSERT por (inscripcion_id, fecha)
- POST   /api/asistencia/bulk       (Admin) transacción BEGIN/COMMIT + UPSERT por item
- PUT    /api/asistencia/:id        (Admin) valida no romper UNIQUE lógico (inscripcion_id, fecha)
- DELETE /api/asistencia/:id        (Admin) borrado físico (log)
- GET    /api/asistencia/resumen    (curso_id + desde + hasta => conteos por alumno)

Qué espera el frontend:
- Llamar GET /api/asistencia?curso_id=X&fecha=YYYY-MM-DD para pintar la lista del día (incluye asistencia_id y estado si ya existe; si no, vienen null).

Estados válidos EXACTOS:
- Asistio | Falto | Justificado

Cómo asegura que “todo conecte”:
- Valida que la inscripción exista y esté Activa antes de registrar/editar.
- JOIN principal: inscripciones + alumnos + cursos y LEFT JOIN asistencia por (inscripcion_id + fecha).
- Evita duplicados con UPSERT por código (busca por inscripcion_id+fecha y hace INSERT o UPDATE).
*/

// src/utils/syncEstados.js
// Sincroniza automáticamente los estados de cursos, inscripciones e instructores
// basado en las fechas reales de inicio/fin calculadas.

const db = require("../db");

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

function parseISODate(iso) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();
  const map = [
    ["lunes", 1], ["martes", 2], ["miercoles", 3], ["miércoles", 3],
    ["jueves", 4], ["viernes", 5], ["sabado", 6], ["sábado", 6], ["domingo", 0],
  ];
  const out = new Set();
  for (const [name, idx] of map) {
    if (s.includes(name)) out.add(idx);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function calcFechaUltimaClase({ fecha_inicio, dias, nro_clases }) {
  const start = parseISODate(fecha_inicio);
  const n = toInt(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);
  if (!start || n <= 0 || weekdays.length === 0) return null;

  const fechas = [];
  let cursor = new Date(start);
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

  return fechas.length ? fechas[fechas.length - 1] : null;
}

function calcularEstadoCurso({ fecha_inicio, dias, nro_clases, estado_bd }) {
  const estBD = String(estado_bd || "").trim();
  if (estBD === "Cancelado") return "Cancelado";

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const fi = parseISODate(fecha_inicio);
  if (!fi) return "Programado";

  if (fi > hoy) return "Programado";

  // Ya inició (fi <= hoy)
  const last = calcFechaUltimaClase({ fecha_inicio, dias, nro_clases });
  if (last && hoy > last) return "Finalizado";

  return "En curso";
}

function parseFechaFromHorario(horario_por_dia, fecha_inicio_directo) {
  // Intenta extraer fecha_inicio del campo horario_por_dia o usa la columna directa
  if (fecha_inicio_directo) return fecha_inicio_directo;
  const txt = String(horario_por_dia || "");
  const m = txt.match(/Inicio:([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? m[1] : "";
}

const LOCK_NAME = "syncCursosFinalizados";

async function withDbLock({ name = LOCK_NAME, ttlMs = 60_000 }, fn) {
  // Lock persistente en DB (no en memoria)
  const owner = `${process.pid}-${Date.now()}`;
  const ttlSeconds = Math.max(5, Math.ceil((Number(ttlMs) || 60_000) / 1000));
  const acquired = await db.runInTransaction(async () => {
    // Limpieza de expirados
    await dbRun(`DELETE FROM app_locks WHERE expires_at <= datetime('now')`);

    // Intentar tomar lock si no existe
    await dbRun(
      `INSERT OR IGNORE INTO app_locks(name, acquired_at, expires_at, owner)
       VALUES(?, datetime('now'), datetime('now', '+' || ? || ' seconds'), ?)`,
      [name, ttlSeconds, owner]
    );

    // Si existe, solo reemplazar dueño cuando ya expiró
    await dbRun(
      `UPDATE app_locks
       SET acquired_at = datetime('now'),
           expires_at = datetime('now', '+' || ? || ' seconds'),
           owner = ?
       WHERE name = ?
         AND expires_at <= datetime('now')`,
      [ttlSeconds, owner, name]
    );

    const row = await dbGet(`SELECT owner FROM app_locks WHERE name = ?`, [name]);
    return !!(row && row.owner === owner);
  });
  if (!acquired) return; // lock ocupado

  try {
    return await fn();
  } finally {
    try {
      await db.runInTransaction(async () => {
        await dbRun(`DELETE FROM app_locks WHERE name = ? AND owner = ?`, [name, owner]);
      });
    } catch (_) {}
  }
}

/**
 * Sincroniza cursos finalizados:
 * - Marca cursos como 'Finalizado' si ya terminaron
 * - Marca inscripciones como 'Finalizada' para esos cursos
 * - Actualiza estado de instructores según si tienen cursos activos
 */
async function syncCursosFinalizados() {
  return withDbLock({ name: LOCK_NAME, ttlMs: 60_000 }, async () => {
    try {
      await db.runInTransaction(async () => {
        // Obtener todos los cursos no finalizados/cancelados
        const cursos = await dbAll(
          `SELECT id, estado, dias, nro_clases, horario_por_dia, fecha_inicio FROM cursos
           WHERE estado NOT IN ('Finalizado', 'Cancelado')`
        );

        for (const c of cursos) {
          const fecha_inicio = parseFechaFromHorario(c.horario_por_dia, c.fecha_inicio);
          const estadoCalc = calcularEstadoCurso({
            fecha_inicio,
            dias: c.dias,
            nro_clases: c.nro_clases,
            estado_bd: c.estado,
          });

          if (estadoCalc === "Finalizado") {
            // Actualizar estado del curso en BD
            await dbRun(`UPDATE cursos SET estado = 'Finalizado' WHERE id = ?`, [c.id]);
            // Finalizar inscripciones activas de este curso
            await dbRun(
              `UPDATE inscripciones SET estado = 'Finalizada' WHERE curso_id = ? AND estado = 'Activa'`,
              [c.id]
            );
          } else if (estadoCalc === "En curso" && c.estado === "Programado") {
            // Actualizar a "En curso" si ya inició
            await dbRun(`UPDATE cursos SET estado = 'En curso' WHERE id = ?`, [c.id]);
          }
        }

        // Actualizar estado de instructores automáticamente:
        // Activo = tiene al menos 1 curso en estado 'Programado' o 'En curso'
        // Inactivo = no tiene cursos vigentes
        await dbRun(`
          UPDATE instructores
          SET estado = CASE
            WHEN EXISTS (
              SELECT 1 FROM cursos c
              WHERE c.instructor_id = instructores.id
                AND c.estado IN ('Programado', 'En curso')
            ) THEN 'Activo'
            ELSE 'Inactivo'
          END
        `);
      });
    } catch (err) {
      console.error("[syncCursosFinalizados] Error:", err);
    }
  });
}

module.exports = { syncCursosFinalizados, calcularEstadoCurso, parseFechaFromHorario };

const express = require("express");
const router = express.Router();
const db = require("../db");

// ===============================
// Helpers
// ===============================
function bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

function normEstado(estado) {
  const e = String(estado || "").trim().toLowerCase();

  // soportar lo que manda el front (A/F/L o textos)
  if (e === "a" || e === "asistio" || e === "asistió" || e.includes("asist")) return "Asistio";
  if (e === "f" || e === "falto" || e === "faltó" || e.includes("falt")) return "Falto";
  if (e === "l" || e === "licencia" || e.includes("lic") || e === "justificado" || e.includes("justif"))
    return "Justificado";

  // default
  return "Asistio";
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // { changes, lastID }
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

// ===============================
// GET /api/asistencia?curso_id=1&fecha=YYYY-MM-DD
// Devuelve asistencia de un día para un curso
// ===============================
router.get("/", async (req, res) => {
  try {
    const { curso_id, fecha } = req.query;
    if (!curso_id || !fecha) return bad(res, "Faltan parámetros: curso_id y fecha");

    const sql = `
      SELECT
        a.id,
        a.inscripcion_id,
        a.fecha,
        a.estado,
        a.observacion
      FROM asistencia a
      JOIN inscripciones i ON i.id = a.inscripcion_id
      WHERE i.curso_id = ? AND a.fecha = ?
      ORDER BY a.id DESC
    `;

    const rows = await allAsync(sql, [curso_id, String(fecha).slice(0, 10)]);
    return res.json(rows);
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

// ===============================
// POST /api/asistencia
// Body: { inscripcion_id, fecha, estado, observacion? }
// Upsert manual (UPDATE primero, si no existe INSERT)
// ===============================
router.post("/", async (req, res) => {
  try {
    const { inscripcion_id, fecha, estado, observacion } = req.body || {};
    if (!inscripcion_id || !fecha) return bad(res, "Faltan campos: inscripcion_id y fecha");

    const inscId = Number(inscripcion_id);
    const f = String(fecha).slice(0, 10);
    const est = normEstado(estado);

    // 1) UPDATE
    const up = await runAsync(
      `
      UPDATE asistencia
      SET estado = ?, observacion = ?, updated_at = datetime('now')
      WHERE inscripcion_id = ? AND fecha = ?
      `,
      [est, observacion ?? null, inscId, f]
    );

    // 2) Si no actualizó nada => INSERT
    if (!up.changes) {
      await runAsync(
        `
        INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `,
        [inscId, f, est, observacion ?? null]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

// ===============================
// POST /api/asistencia/bulk
// Body: { items: [{inscripcion_id, fecha, estado, observacion?}, ...] }
// Upsert manual dentro de transacción
// ===============================
router.post("/bulk", (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return bad(res, "items es obligatorio");

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmtUpdate = db.prepare(`
      UPDATE asistencia
      SET estado = ?, observacion = ?, updated_at = datetime('now')
      WHERE inscripcion_id = ? AND fecha = ?
    `);

    const stmtInsert = db.prepare(`
      INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    try {
      let pend = 0;
      let failed = false;

      const done = (err) => {
        if (failed) return;
        if (err) {
          failed = true;
          stmtUpdate.finalize(() => {
            stmtInsert.finalize(() => {
              db.run("ROLLBACK");
              return bad(res, err.message || "Error bulk", 500);
            });
          });
          return;
        }

        pend--;
        if (pend <= 0) {
          stmtUpdate.finalize(() => {
            stmtInsert.finalize(() => {
              db.run("COMMIT", (err2) => {
                if (err2) return bad(res, err2.message, 500);
                return res.json({ ok: true });
              });
            });
          });
        }
      };

      // Ejecuta update y si no cambia nada, hace insert
      for (const it of items) {
        const insc = Number(it.inscripcion_id ?? it.inscripcionId ?? 0);
        const f = String(it.fecha || "").slice(0, 10);
        if (!insc || !f) continue;

        const est = normEstado(it.estado);
        const obs = it.observacion ?? null;

        pend++;
        stmtUpdate.run([est, obs, insc, f], function (err) {
          if (err) return done(err);

          if (this.changes && this.changes > 0) {
            return done(null);
          }

          // no existía => insert
          stmtInsert.run([insc, f, est, obs], (err2) => done(err2));
        });
      }

      if (pend === 0) {
        stmtUpdate.finalize(() => {
          stmtInsert.finalize(() => {
            db.run("COMMIT", () => res.json({ ok: true }));
          });
        });
      }
    } catch (e) {
      stmtUpdate.finalize(() => {
        stmtInsert.finalize(() => {
          db.run("ROLLBACK");
          return bad(res, e.message || "Error bulk", 500);
        });
      });
    }
  });
});

// ===============================
// GET /api/asistencia/resumen?curso_id=1
// Resumen por alumno: asistio/falto/licencia
// ===============================
router.get("/resumen", async (req, res) => {
  try {
    const { curso_id } = req.query;
    if (!curso_id) return bad(res, "Falta curso_id");

    const sql = `
      SELECT
        i.id AS inscripcion_id,
        al.nombre AS alumno_nombre,
        al.documento AS alumno_documento,
        SUM(CASE WHEN a.estado = 'Asistio' THEN 1 ELSE 0 END) AS asistio,
        SUM(CASE WHEN a.estado = 'Falto' THEN 1 ELSE 0 END) AS falto,
        SUM(CASE WHEN a.estado = 'Justificado' THEN 1 ELSE 0 END) AS licencia
      FROM inscripciones i
      JOIN alumnos al ON al.id = i.alumno_id
      LEFT JOIN asistencia a ON a.inscripcion_id = i.id
      WHERE i.curso_id = ? AND i.estado = 'Activa'
      GROUP BY i.id
      ORDER BY al.nombre ASC
    `;

    const rows = await allAsync(sql, [curso_id]);
    return res.json(rows);
  } catch (err) {
    return bad(res, err.message || "Error", 500);
  }
});

module.exports = router;

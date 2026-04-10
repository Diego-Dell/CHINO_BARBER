
// src/routes/egresos.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();
const { toCentavos, fromCentavos } = require("../lib/money");
const { boliviaTodayISO, isISODate } = require("../lib/dates");

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta ruta según tu estructura
// ===============================
function authRequired(req, res, next) {
  return next();
}

function adminOnly(req, res, next) {
  return next();
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
// Utilidades / validaciones
// ===============================
function normStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function toNum(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

// ===============================
// 1) GET /api/egresos
// Filtros: desde, hasta, categoria, q (detalle/comprobante), limit, offset
// Orden: fecha DESC, id DESC
// ===============================
router.get("/", async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    const categoria = normStr(req.query.categoria);
    const q = normStr(req.query.q);

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (desde || hasta) {
      const d = desde || "0000-01-01";
      const h = hasta || "9999-12-31";

      if (desde && !isISODate(desde)) {
        return res.status(400).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
      }
      if (hasta && !isISODate(hasta)) {
        return res.status(400).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });
      }
      where.push("e.fecha BETWEEN ? AND ?");
      params.push(d, h);
    }

    if (categoria) {
      where.push("e.categoria = ?");
      params.push(categoria);
    }

    if (q) {
      where.push("(e.detalle LIKE ? OR e.comprobante LIKE ?)");
      params.push(likeWrap(q), likeWrap(q));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Por defecto: solo activos (no borrado físico)
    where.push("e.estado = 'activo'");

    const totalRow = await dbGet(
      `
      SELECT COUNT(*) AS total
      FROM egresos e
      ${whereSql}
      `,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

    const rows = await dbAll(
      `
      SELECT
        e.id, e.fecha, e.categoria, e.detalle, e.monto, e.monto_centavos, e.comprobante,
        e.estado, e.motivo_anulacion, e.fecha_anulacion
      FROM egresos e
      ${whereSql}
      ORDER BY e.fecha DESC, e.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar egresos" });
  }
});

// ===============================
// 2) GET /api/egresos/:id
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, monto_centavos, comprobante,
              estado, motivo_anulacion, fecha_anulacion
       FROM egresos
       WHERE id = ?`,
      [id]
    );

    if (!row) return res.status(404).json({ ok: false, error: "Egreso no encontrado" });
    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener egreso" });
  }
});

// ===============================
// 3) POST /api/egresos (Admin)
// ===============================
router.post("/", adminOnly, async (req, res) => {
  try {
    const fecha = normStr(req.body?.fecha) || boliviaTodayISO();
    const categoria = normStr(req.body?.categoria);
    const detalle = normStr(req.body?.detalle);
    const comprobante = normStr(req.body?.comprobante);
    const monto = toNum(req.body?.monto, null);
    const monto_centavos = toCentavos(monto);

    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha obligatoria e inválida (YYYY-MM-DD)" });
    }
    if (!categoria) {
      return res.status(400).json({ ok: false, error: "categoria es obligatoria" });
    }
    if (monto === null || !(monto > 0)) {
      return res.status(400).json({ ok: false, error: "monto es obligatorio y debe ser > 0" });
    }
    if (monto_centavos === null || !(monto_centavos > 0)) {
      return res.status(400).json({ ok: false, error: "monto inválido" });
    }

    const r = await dbRun(
      `
      INSERT INTO egresos (fecha, categoria, detalle, monto_centavos, monto, comprobante)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [fecha, categoria, detalle, monto_centavos, fromCentavos(monto_centavos), comprobante]
    );

    const created = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, monto_centavos, comprobante,
              estado, motivo_anulacion, fecha_anulacion
       FROM egresos
       WHERE id = ?`,
      [r.lastID]
    );

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear egreso" });
  }
});

// ===============================
// 4) PUT /api/egresos/:id (Admin)
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, monto_centavos, comprobante, estado
       FROM egresos
       WHERE id = ?`,
      [id]
    );
    if (!current) return res.status(404).json({ ok: false, error: "Egreso no encontrado" });
    if (String(current.estado || "") === "anulado") {
      return res.status(409).json({ ok: false, error: "Egreso anulado no es editable" });
    }

    const fecha = req.body?.fecha !== undefined ? normStr(req.body.fecha) : current.fecha;
    const categoria = req.body?.categoria !== undefined ? normStr(req.body.categoria) : current.categoria;
    const detalle = req.body?.detalle !== undefined ? normStr(req.body.detalle) : current.detalle;
    const comprobante = req.body?.comprobante !== undefined ? normStr(req.body.comprobante) : current.comprobante;
    const monto = req.body?.monto !== undefined ? toNum(req.body.monto, null) : Number(current.monto);
    const monto_centavos = req.body?.monto !== undefined ? toCentavos(monto) : (toCentavos(current.monto) ?? null);

    if (!fecha || !isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    }
    if (!categoria) {
      return res.status(400).json({ ok: false, error: "categoria es obligatoria" });
    }
    if (monto === null || !(monto > 0)) {
      return res.status(400).json({ ok: false, error: "monto debe ser > 0" });
    }
    if (monto_centavos === null || !(monto_centavos > 0)) {
      return res.status(400).json({ ok: false, error: "monto inválido" });
    }

    await dbRun(
      `
      UPDATE egresos
      SET fecha = ?, categoria = ?, detalle = ?, monto_centavos = ?, monto = ?, comprobante = ?
      WHERE id = ?
      `,
      [fecha, categoria, detalle, monto_centavos, fromCentavos(monto_centavos), comprobante, id]
    );

    const updated = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, monto_centavos, comprobante,
              estado, motivo_anulacion, fecha_anulacion
       FROM egresos
       WHERE id = ?`,
      [id]
    );

    return res.json({ ok: true, data: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar egreso" });
  }
});

// ===============================
// 5) DELETE /api/egresos/:id (Admin) - físico
// ===============================
router.delete("/:id", adminOnly, async (req, res) => {
  return res.status(405).json({ ok: false, error: "Método no permitido. Usa PUT /api/egresos/:id/anular" });
});

// ===============================
// 5b) PUT /api/egresos/:id/anular (Admin) - NO borrado físico
// ===============================
router.put("/:id/anular", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const motivo = normStr(req.body?.motivo);
    if (!motivo || motivo.length < 2) {
      return res.status(400).json({ ok: false, error: "Motivo requerido" });
    }

    const current = await dbGet(`SELECT id, estado FROM egresos WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ ok: false, error: "Egreso no encontrado" });
    if (String(current.estado || "") === "anulado") return res.json({ ok: true, changes: 0 });

    await dbRun(
      `UPDATE egresos
       SET estado = 'anulado',
           motivo_anulacion = ?,
           fecha_anulacion = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [motivo, boliviaTodayISO(), id]
    );

    try {
      const { writeLog } = require("../lib/auditLog");
      await writeLog("egreso_anulado", JSON.stringify({ egreso_id: id, motivo }), "admin");
    } catch (_) {}

    return res.json({ ok: true, changes: 1 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al anular egreso" });
  }
});

// ===============================
// 6) GET /api/egresos/resumen
// Query: desde, hasta
// Devuelve total_egresos + por_categoria
// ===============================
router.get("/resumen", async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    // Por defecto: todo el rango si no envían
    const d = desde || "0000-01-01";
    const h = hasta || "9999-12-31";

    if (desde && !isISODate(desde)) {
      return res.status(400).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    }
    if (hasta && !isISODate(hasta)) {
      return res.status(400).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });
    }

    const totalRow = await dbGet(
      `
      SELECT COALESCE(SUM(COALESCE(monto_centavos, CAST(ROUND(monto * 100) AS INTEGER))), 0) AS total_centavos
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
        AND COALESCE(estado,'activo') = 'activo'
      `,
      [d, h]
    );

    const porCategoria = await dbAll(
      `
      SELECT categoria, COALESCE(SUM(COALESCE(monto_centavos, CAST(ROUND(monto * 100) AS INTEGER))), 0) AS total_centavos
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
        AND COALESCE(estado,'activo') = 'activo'
      GROUP BY categoria
      ORDER BY total_centavos DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        total_egresos: Number(totalRow?.total_centavos || 0) / 100,
        por_categoria: porCategoria.map((r) => ({
          categoria: r.categoria,
          total: Number(r.total_centavos || 0) / 100,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener resumen de egresos" });
  }
});

module.exports = router;

/*
Egresos = salidas de dinero reales del sistema (gastos de la academia).
Sirve directo para:
- Dashboard financiero y caja (sumar egresos por rango / categorías).
- Reportes ingresos vs egresos (combinas /api/egresos/resumen con tus ingresos/pagos).

Conexión con reportes/dashboard/caja:
- Endpoint clave: GET /api/egresos/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  devuelve total_egresos + totales por categoría (ideal para gráficos y KPIs).

Qué consume el frontend:
- Listado/filtrado: GET /api/egresos?desde&hasta&categoria&q&limit&offset
- Crear/editar: POST / PUT
- Resumen: GET /api/egresos/resumen

Seguridad:
- Todas las rutas requieren sesión activa (authRequired).
- Crear/editar/eliminar requieren rol Admin (adminOnly).
*/

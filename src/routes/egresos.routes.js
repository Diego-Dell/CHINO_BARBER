
// src/routes/egresos.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

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

function isISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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
        e.id, e.fecha, e.categoria, e.detalle, e.monto, e.comprobante
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
      `SELECT id, fecha, categoria, detalle, monto, comprobante
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
    const fecha = normStr(req.body?.fecha) || todayISO();
    const categoria = normStr(req.body?.categoria);
    const detalle = normStr(req.body?.detalle);
    const comprobante = normStr(req.body?.comprobante);
    const monto = toNum(req.body?.monto, null);

    if (!isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha obligatoria e inválida (YYYY-MM-DD)" });
    }
    if (!categoria) {
      return res.status(400).json({ ok: false, error: "categoria es obligatoria" });
    }
    if (monto === null || !(monto > 0)) {
      return res.status(400).json({ ok: false, error: "monto es obligatorio y debe ser > 0" });
    }

    const r = await dbRun(
      `
      INSERT INTO egresos (fecha, categoria, detalle, monto, comprobante)
      VALUES (?, ?, ?, ?, ?)
      `,
      [fecha, categoria, detalle, monto, comprobante]
    );

    const created = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, comprobante
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
      `SELECT id, fecha, categoria, detalle, monto, comprobante
       FROM egresos
       WHERE id = ?`,
      [id]
    );
    if (!current) return res.status(404).json({ ok: false, error: "Egreso no encontrado" });

    const fecha = req.body?.fecha !== undefined ? normStr(req.body.fecha) : current.fecha;
    const categoria = req.body?.categoria !== undefined ? normStr(req.body.categoria) : current.categoria;
    const detalle = req.body?.detalle !== undefined ? normStr(req.body.detalle) : current.detalle;
    const comprobante = req.body?.comprobante !== undefined ? normStr(req.body.comprobante) : current.comprobante;
    const monto = req.body?.monto !== undefined ? toNum(req.body.monto, null) : Number(current.monto);

    if (!fecha || !isISODate(fecha)) {
      return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    }
    if (!categoria) {
      return res.status(400).json({ ok: false, error: "categoria es obligatoria" });
    }
    if (monto === null || !(monto > 0)) {
      return res.status(400).json({ ok: false, error: "monto debe ser > 0" });
    }

    await dbRun(
      `
      UPDATE egresos
      SET fecha = ?, categoria = ?, detalle = ?, monto = ?, comprobante = ?
      WHERE id = ?
      `,
      [fecha, categoria, detalle, monto, comprobante, id]
    );

    const updated = await dbGet(
      `SELECT id, fecha, categoria, detalle, monto, comprobante
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
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await dbGet(`SELECT id FROM egresos WHERE id = ?`, [id]);
    if (!exists) return res.status(404).json({ ok: false, error: "Egreso no encontrado" });

    await dbRun(`DELETE FROM egresos WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al eliminar egreso" });
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
      SELECT COALESCE(SUM(monto), 0) AS total_egresos
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const porCategoria = await dbAll(
      `
      SELECT categoria, COALESCE(SUM(monto), 0) AS total
      FROM egresos
      WHERE fecha BETWEEN ? AND ?
      GROUP BY categoria
      ORDER BY total DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        total_egresos: Number(totalRow?.total_egresos || 0),
        por_categoria: porCategoria.map((r) => ({
          categoria: r.categoria,
          total: Number(r.total || 0),
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

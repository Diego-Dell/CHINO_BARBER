// src/routes/inventario.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

// ===== Middlewares (placeholder) =====
function authRequired(req, res, next) { return next(); }
function adminOnly(req, res, next) { return next(); }

router.use(authRequired);

// ===== Helpers SQLite promisificados =====
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

// ===== Utilidades =====
const ITEM_ESTADOS = new Set(["Activo", "Inactivo"]);
// ✅ Acepta "Ingreso" (DB) y también "Entrada" (compatibilidad)
const MOV_TIPOS = new Set(["Ingreso", "Entrada", "Salida", "Ajuste"]);

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
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  const [y, m, d] = s.split("-").map(Number);
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}
function likeWrap(s) { return `%${String(s || "").trim()}%`; }

// ✅ Normaliza tipo: Entrada -> Ingreso
function normalizeTipo(tipo) {
  if (tipo === "Entrada") return "Ingreso";
  return tipo;
}

// ===== Stock dinámico (según schema) =====
// stock = SUM(Ingreso) - SUM(Salida) + SUM(Ajuste)
async function getStockActual(item_id) {
  const row = await dbGet(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN tipo = 'Ingreso' THEN cantidad
          WHEN tipo = 'Salida' THEN -cantidad
          WHEN tipo = 'Ajuste' THEN cantidad
          ELSE 0
        END
      ), 0) AS stock_actual
    FROM inventario_movimientos
    WHERE item_id = ?
    `,
    [item_id]
  );
  return row ? Number(row.stock_actual || 0) : 0;
}

async function getItemById(item_id) {
  return await dbGet(
    `
    SELECT id, producto, categoria, unidad, stock_minimo, estado
    FROM inventario_items
    WHERE id = ?
    `,
    [item_id]
  );
}

async function validateCursoIfProvided(curso_id) {
  if (curso_id === null || curso_id === undefined) return { ok: true };
  const row = await dbGet(`SELECT id FROM cursos WHERE id = ?`, [curso_id]);
  if (!row) return { ok: false, code: 400, error: "curso_id no existe" };
  return { ok: true };
}

async function validateInstructorIfProvided(instructor_id) {
  if (instructor_id === null || instructor_id === undefined) return { ok: true };
  const row = await dbGet(`SELECT id FROM instructores WHERE id = ?`, [instructor_id]);
  if (!row) return { ok: false, code: 400, error: "instructor_id no existe" };
  return { ok: true };
}

// ===============================
// ITEMS
// ===============================

// GET /api/inventario/items
router.get("/items", async (req, res) => {
  try {
    const q = normStr(req.query.q);
    const estado = normStr(req.query.estado);

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (estado) {
      if (!ITEM_ESTADOS.has(estado)) {
        return res.status(400).json({ ok: false, error: "estado inválido (Activo|Inactivo)" });
      }
      where.push("it.estado = ?");
      params.push(estado);
    }

    if (q) {
      where.push("(it.producto LIKE ? OR it.categoria LIKE ?)");
      params.push(likeWrap(q), likeWrap(q));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await dbGet(
      `SELECT COUNT(*) AS total FROM inventario_items it ${whereSql}`,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

    const rows = await dbAll(
      `
      SELECT
        it.id, it.producto, it.categoria, it.unidad, it.stock_minimo, it.estado,
        COALESCE(m.stock_actual, 0) AS stock_actual
      FROM inventario_items it
      LEFT JOIN (
        SELECT
          item_id,
          COALESCE(SUM(
            CASE
              WHEN tipo='Ingreso' THEN cantidad
              WHEN tipo='Salida' THEN -cantidad
              WHEN tipo='Ajuste' THEN cantidad
              ELSE 0
            END
          ), 0) AS stock_actual
        FROM inventario_movimientos
        GROUP BY item_id
      ) m ON m.item_id = it.id
      ${whereSql}
      ORDER BY it.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar items" });
  }
});

// GET /api/inventario/items/:id
router.get("/items/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const item = await getItemById(id);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });

    const stock_actual = await getStockActual(id);
    return res.json({ ok: true, data: { ...item, stock_actual } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener item" });
  }
});

// POST /api/inventario/items (Admin)
router.post("/items", adminOnly, async (req, res) => {
  try {
    const producto = normStr(req.body?.producto);
    const categoria = normStr(req.body?.categoria);
    const unidad = normStr(req.body?.unidad);
    const stock_minimo = toInt(req.body?.stock_minimo, 0) ?? 0;
    const estado = normStr(req.body?.estado) || "Activo";

    if (!producto) return res.status(400).json({ ok: false, error: "producto es obligatorio" });
    if (stock_minimo < 0) return res.status(400).json({ ok: false, error: "stock_minimo inválido (>= 0)" });
    if (!ITEM_ESTADOS.has(estado)) return res.status(400).json({ ok: false, error: "estado inválido" });

    const r = await dbRun(
      `
      INSERT INTO inventario_items (producto, categoria, unidad, stock_minimo, estado)
      VALUES (?, ?, ?, ?, ?)
      `,
      [producto, categoria, unidad, stock_minimo, estado]
    );

    const created = await getItemById(r.lastID);
    const stock_actual = await getStockActual(r.lastID);

    return res.status(201).json({ ok: true, data: { ...created, stock_actual } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear item" });
  }
});

// PUT /api/inventario/items/:id (Admin)
router.put("/items/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await getItemById(id);
    if (!current) return res.status(404).json({ ok: false, error: "Item no encontrado" });

    const producto = req.body?.producto !== undefined ? normStr(req.body.producto) : current.producto;
    const categoria = req.body?.categoria !== undefined ? normStr(req.body.categoria) : current.categoria;
    const unidad = req.body?.unidad !== undefined ? normStr(req.body.unidad) : current.unidad;
    const stock_minimo =
      req.body?.stock_minimo !== undefined ? toInt(req.body.stock_minimo, null) : Number(current.stock_minimo || 0);
    const estado = req.body?.estado !== undefined ? normStr(req.body.estado) : current.estado;

    if (!producto) return res.status(400).json({ ok: false, error: "producto no puede quedar vacío" });
    if (stock_minimo === null || stock_minimo < 0) return res.status(400).json({ ok: false, error: "stock_minimo inválido" });
    if (!ITEM_ESTADOS.has(estado)) return res.status(400).json({ ok: false, error: "estado inválido" });

    await dbRun(
      `
      UPDATE inventario_items
      SET producto = ?, categoria = ?, unidad = ?, stock_minimo = ?, estado = ?
      WHERE id = ?
      `,
      [producto, categoria, unidad, stock_minimo, estado, id]
    );

    const updated = await getItemById(id);
    const stock_actual = await getStockActual(id);

    return res.json({ ok: true, data: { ...updated, stock_actual } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar item" });
  }
});

// DELETE /api/inventario/items/:id (Admin) -> soft delete
router.delete("/items/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const exists = await getItemById(id);
    if (!exists) return res.status(404).json({ ok: false, error: "Item no encontrado" });

    await dbRun(`UPDATE inventario_items SET estado = 'Inactivo' WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al inactivar item" });
  }
});

// ===============================
// MOVIMIENTOS
// ===============================

// POST /api/inventario/movimientos (Admin)
router.post("/movimientos", adminOnly, async (req, res) => {
  try {
    const item_id = toInt(req.body?.item_id, null);
    const fecha = normStr(req.body?.fecha) || todayISO();
    let tipo = normStr(req.body?.tipo);
    let cantidad = toInt(req.body?.cantidad, null);
    const costo_unitario = toNum(req.body?.costo_unitario, null);
    const motivo = normStr(req.body?.motivo);

    const curso_id = req.body?.curso_id !== undefined ? toInt(req.body.curso_id, null) : null;
    const instructor_id = req.body?.instructor_id !== undefined ? toInt(req.body.instructor_id, null) : null;

    if (!item_id) return res.status(400).json({ ok: false, error: "item_id es obligatorio" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    if (!tipo || !MOV_TIPOS.has(tipo)) return res.status(400).json({ ok: false, error: "tipo inválido (Ingreso|Salida|Ajuste)" });

    // ✅ Ajuste puede ser positivo o negativo (tu schema lo permite: cantidad <> 0)
    if (cantidad === null || cantidad === 0) return res.status(400).json({ ok: false, error: "cantidad no puede ser 0" });

    // ✅ Normalizamos tipo "Entrada" -> "Ingreso" y guardamos en DB como "Ingreso"
    tipo = normalizeTipo(tipo);

    const item = await getItemById(item_id);
    if (!item) return res.status(400).json({ ok: false, error: "item_id no existe" });
    if (item.estado !== "Activo") return res.status(400).json({ ok: false, error: "El item debe estar Activo" });

    const cCheck = await validateCursoIfProvided(curso_id);
    if (!cCheck.ok) return res.status(cCheck.code).json({ ok: false, error: cCheck.error });

    const iCheck = await validateInstructorIfProvided(instructor_id);
    if (!iCheck.ok) return res.status(iCheck.code).json({ ok: false, error: iCheck.error });

    await dbRun("BEGIN");
    try {
      const stockActual = await getStockActual(item_id);

      // Stock nuevo según regla:
      // Ingreso suma
      // Salida resta
      // Ajuste suma (puede ser negativo)
      const delta =
        tipo === "Ingreso" ? Math.abs(cantidad) :
        tipo === "Salida" ? -Math.abs(cantidad) :
        // Ajuste: se respeta signo
        cantidad;

      const stockNuevo = stockActual + delta;

      if (stockNuevo < 0) {
        await dbRun("ROLLBACK");
        return res.status(409).json({ ok: false, error: "Movimiento inválido: dejaría stock negativo" });
      }

      const r = await dbRun(
        `
        INSERT INTO inventario_movimientos
          (item_id, fecha, tipo, cantidad, costo_unitario, motivo, curso_id, instructor_id)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [item_id, fecha, tipo, delta, costo_unitario, motivo, curso_id, instructor_id]
      );

      await dbRun("COMMIT");

      const created = await dbGet(
        `
        SELECT
          m.id, m.item_id, m.fecha, m.tipo, m.cantidad, m.costo_unitario, m.motivo, m.curso_id, m.instructor_id,
          it.producto AS item_producto,
          c.nombre AS curso_nombre,
          ins.nombre AS instructor_nombre
        FROM inventario_movimientos m
        JOIN inventario_items it ON it.id = m.item_id
        LEFT JOIN cursos c ON c.id = m.curso_id
        LEFT JOIN instructores ins ON ins.id = m.instructor_id
        WHERE m.id = ?
        `,
        [r.lastID]
      );

      const stock_actual = await getStockActual(item_id);
      return res.status(201).json({ ok: true, data: { ...created, stock_actual } });
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al registrar movimiento" });
  }
});

// GET /api/inventario/movimientos
router.get("/movimientos", async (req, res) => {
  try {
    const item_id = toInt(req.query.item_id, null);
    const curso_id = toInt(req.query.curso_id, null);
    const instructor_id = toInt(req.query.instructor_id, null);
    const tipo = normStr(req.query.tipo);
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    const where = [];
    const params = [];

    if (item_id !== null) { where.push("m.item_id = ?"); params.push(item_id); }
    if (curso_id !== null) { where.push("m.curso_id = ?"); params.push(curso_id); }
    if (instructor_id !== null) { where.push("m.instructor_id = ?"); params.push(instructor_id); }

    if (tipo) {
      // Acepta "Entrada" pero filtra como "Ingreso"
      const t = normalizeTipo(tipo);
      if (!MOV_TIPOS.has(tipo) && !MOV_TIPOS.has(t)) {
        return res.status(400).json({ ok: false, error: "tipo inválido" });
      }
      where.push("m.tipo = ?");
      params.push(t);
    }

    if (desde || hasta) {
      const d = desde || "0000-01-01";
      const h = hasta || "9999-12-31";
      if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido" });
      if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido" });
      where.push("m.fecha BETWEEN ? AND ?");
      params.push(d, h);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await dbAll(
      `
      SELECT
        m.id, m.item_id, m.fecha, m.tipo, m.cantidad, m.costo_unitario, m.motivo, m.curso_id, m.instructor_id,
        it.producto AS item_producto,
        c.nombre AS curso_nombre,
        ins.nombre AS instructor_nombre
      FROM inventario_movimientos m
      JOIN inventario_items it ON it.id = m.item_id
      LEFT JOIN cursos c ON c.id = m.curso_id
      LEFT JOIN instructores ins ON ins.id = m.instructor_id
      ${whereSql}
      ORDER BY m.fecha DESC, m.id DESC
      `,
      params
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar movimientos" });
  }
});

// GET /api/inventario/items/:id/stock
router.get("/items/:id/stock", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const item = await getItemById(id);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });

    const stock_actual = await getStockActual(id);
    const stock_minimo = Number(item.stock_minimo || 0);
    const alerta = stock_actual <= stock_minimo;

    return res.json({ ok: true, data: { stock_actual, stock_minimo, alerta } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener stock" });
  }
});

// GET /api/inventario/alertas
router.get("/alertas", async (req, res) => {
  try {
    const rows = await dbAll(
      `
      SELECT
        it.id, it.producto, it.categoria, it.unidad, it.stock_minimo, it.estado,
        COALESCE(m.stock_actual, 0) AS stock_actual
      FROM inventario_items it
      LEFT JOIN (
        SELECT
          item_id,
          COALESCE(SUM(
            CASE
              WHEN tipo='Ingreso' THEN cantidad
              WHEN tipo='Salida' THEN -cantidad
              WHEN tipo='Ajuste' THEN cantidad
              ELSE 0
            END
          ), 0) AS stock_actual
        FROM inventario_movimientos
        GROUP BY item_id
      ) m ON m.item_id = it.id
      WHERE it.estado = 'Activo'
        AND COALESCE(m.stock_actual, 0) <= COALESCE(it.stock_minimo, 0)
      ORDER BY (COALESCE(it.stock_minimo, 0) - COALESCE(m.stock_actual, 0)) DESC, it.id DESC
      `
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener alertas" });
  }
});

// GET /api/inventario/resumen
router.get("/resumen", async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    const d = desde || "0000-01-01";
    const h = hasta || "9999-12-31";

    if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    const totales = await dbGet(
      `
      SELECT
        COALESCE(SUM(CASE WHEN tipo='Ingreso' THEN cantidad ELSE 0 END), 0) AS total_ingresos,
        COALESCE(SUM(CASE WHEN tipo='Salida' THEN ABS(cantidad) ELSE 0 END), 0) AS total_salidas,
        COALESCE(SUM(CASE WHEN tipo='Salida' THEN ABS(cantidad) * COALESCE(costo_unitario,0) ELSE 0 END), 0) AS costo_salidas
      FROM inventario_movimientos
      WHERE fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const porCurso = await dbAll(
      `
      SELECT
        m.curso_id,
        c.nombre AS curso_nombre,
        COALESCE(SUM(ABS(m.cantidad) * COALESCE(m.costo_unitario, 0)), 0) AS costo_total
      FROM inventario_movimientos m
      LEFT JOIN cursos c ON c.id = m.curso_id
      WHERE m.fecha BETWEEN ? AND ?
        AND m.tipo = 'Salida'
        AND m.curso_id IS NOT NULL
      GROUP BY m.curso_id
      ORDER BY costo_total DESC
      `,
      [d, h]
    );

    const porInstructor = await dbAll(
      `
      SELECT
        m.instructor_id,
        ins.nombre AS instructor_nombre,
        COALESCE(SUM(ABS(m.cantidad) * COALESCE(m.costo_unitario, 0)), 0) AS costo_total
      FROM inventario_movimientos m
      LEFT JOIN instructores ins ON ins.id = m.instructor_id
      WHERE m.fecha BETWEEN ? AND ?
        AND m.tipo = 'Salida'
        AND m.instructor_id IS NOT NULL
      GROUP BY m.instructor_id
      ORDER BY costo_total DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        desde: d,
        hasta: h,
        total_ingresos: Number(totales?.total_ingresos || 0),
        total_salidas: Number(totales?.total_salidas || 0),
        costo_salidas: Number(totales?.costo_salidas || 0),
        costo_total_por_curso: porCurso.map((r) => ({
          curso_id: r.curso_id,
          curso_nombre: r.curso_nombre,
          costo_total: Number(r.costo_total || 0),
        })),
        costo_total_por_instructor: porInstructor.map((r) => ({
          instructor_id: r.instructor_id,
          instructor_nombre: r.instructor_nombre,
          costo_total: Number(r.costo_total || 0),
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener resumen de inventario" });
  }
});

module.exports = router;

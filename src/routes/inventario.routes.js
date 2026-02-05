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
function s(v) {
  return String(v ?? "").trim();
}
function isoDate(v) {
  const x = s(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ================= esquema dinámico + migraciones ligeras =================
let _ITEMS_COLS = null;

async function getItemsCols() {
  if (_ITEMS_COLS) return _ITEMS_COLS;
  const rows = await dbAll("PRAGMA table_info(inventario_items)");
  _ITEMS_COLS = new Set(rows.map((r) => String(r.name || "").toLowerCase()));
  return _ITEMS_COLS;
}
function hasCol(cols, name) {
  return cols.has(String(name).toLowerCase());
}

// Precio del item (solo al crear/editar item). Si no existe la columna, la creamos.
async function ensurePrecioCol() {
  const cols = await getItemsCols();
  if (hasCol(cols, "precio")) return;

  await dbRun("ALTER TABLE inventario_items ADD COLUMN precio REAL DEFAULT 0");
  _ITEMS_COLS = null;
  await getItemsCols();
}

// ================= stock (calculado) =================
function stockFromMovs(movs) {
  // suma: Ingreso / Compra / Devolucion
  // resta: Egreso / Consumo / Prestamo
  let stock = 0;
  for (const m of movs) {
    const tipo = String(m.tipo || "").toLowerCase();
    const cant = toInt(m.cantidad, 0);
    const suma = tipo.includes("ing") || tipo.includes("comp") || tipo.includes("dev");
    const resta = tipo.includes("egr") || tipo.includes("cons") || tipo.includes("pres");
    if (suma) stock += cant;
    else if (resta) stock -= cant;
  }
  return stock;
}

async function getStockByItemId(itemId) {
  const movs = await dbAll(`SELECT tipo, cantidad FROM inventario_movimientos WHERE item_id = ?`, [itemId]);
  return stockFromMovs(movs);
}

// ================= GET /api/inventario/items =================
router.get("/items", async (req, res) => {
  try {
    await ensurePrecioCol();

    const q = s(req.query.q);
    const estado = s(req.query.estado);
    const params = [];
    let where = "WHERE 1=1";

    if (q) {
      where += " AND (producto LIKE ? OR categoria LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    if (estado) {
      where += " AND estado = ?";
      params.push(estado);
    }

    const items = await dbAll(
      `
      SELECT id, producto, categoria, unidad, stock_minimo, estado, COALESCE(precio,0) AS precio
      FROM inventario_items
      ${where}
      ORDER BY id DESC
      LIMIT 500
      `,
      params
    );

    const out = [];
    for (const it of items) {
      const stock = await getStockByItemId(it.id);
      out.push({ ...it, stock });
    }

    res.json({ ok: true, items: out });
  } catch (err) {
    console.error("[INVENTARIO][GET /items]", err);
    res.status(500).json({ ok: false, error: "Error al listar items" });
  }
});

// ================= POST /api/inventario/items =================
router.post("/items", async (req, res) => {
  try {
    await ensurePrecioCol();

    const b = req.body || {};
    const producto = s(b.producto);
    const categoria = s(b.categoria);
    const unidad = s(b.unidad);
    const stock_minimo = toInt(b.stock_minimo, 0);
    const precio = toNum(b.precio, 0);
    const estado = s(b.estado) || "Activo";

    if (!producto) return res.status(400).json({ ok: false, error: "Producto es obligatorio" });

    const r = await dbRun(
      `
      INSERT INTO inventario_items (producto, categoria, unidad, stock_minimo, precio, estado)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [producto, categoria || null, unidad || null, stock_minimo, precio, estado]
    );

    res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (err) {
    console.error("[INVENTARIO][POST /items]", err);
    res.status(500).json({ ok: false, error: "Error al crear item" });
  }
});

// ================= PUT /api/inventario/items/:id =================
router.put("/items/:id", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    await ensurePrecioCol();

    const b = req.body || {};
    const producto = s(b.producto);
    const categoria = s(b.categoria);
    const unidad = s(b.unidad);
    const stock_minimo = toInt(b.stock_minimo, 0);
    const precio = toNum(b.precio, 0);
    const estado = s(b.estado) || "Activo";

    if (!producto) return res.status(400).json({ ok: false, error: "Producto es obligatorio" });

    await dbRun(
      `
      UPDATE inventario_items
      SET producto = ?, categoria = ?, unidad = ?, stock_minimo = ?, precio = ?, estado = ?
      WHERE id = ?
      `,
      [producto, categoria || null, unidad || null, stock_minimo, precio, estado, id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[INVENTARIO][PUT /items/:id]", err);
    res.status(500).json({ ok: false, error: "Error al actualizar item" });
  }
});

// ================= GET /api/inventario/movimientos =================
router.get("/movimientos", async (req, res) => {
  try {
    const item_id = toInt(req.query.item_id, 0);

    const params = [];
    let where = "WHERE 1=1";
    if (item_id) {
      where += " AND m.item_id = ?";
      params.push(item_id);
    }

    const rows = await dbAll(
      `
      SELECT 
        m.*,
        COALESCE(it.producto,'') AS item_producto,
        COALESCE(i.nombre,'') AS instructor_nombre,
        COALESCE(c.nombre,'') AS curso_nombre
      FROM inventario_movimientos m
      LEFT JOIN inventario_items it ON it.id = m.item_id
      LEFT JOIN instructores i ON i.id = m.instructor_id
      LEFT JOIN cursos c ON c.id = m.curso_id
      ${where}
      ORDER BY m.id DESC
      LIMIT 1000
      `,
      params
    );

    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("[INVENTARIO][GET /movimientos]", err);
    res.status(500).json({ ok: false, error: "Error al listar movimientos" });
  }
});

// ================= POST /api/inventario/movimientos =================
router.post("/movimientos", async (req, res) => {
  try {
    await ensurePrecioCol();

    const b = req.body || {};
    const item_id = toInt(b.item_id, 0);
    const tipo = s(b.tipo); // Ingreso | Egreso | Prestamo | Devolucion
    const cantidad = toInt(b.cantidad, 0);
    const fecha = isoDate(b.fecha);
    const curso_id = toInt(b.curso_id, 0) || null;
    const instructor_id = toInt(b.instructor_id, 0) || null;
    const nota = s(b.nota) || null;

    if (!item_id) return res.status(400).json({ ok: false, error: "item_id requerido" });
    if (!tipo) return res.status(400).json({ ok: false, error: "tipo requerido" });
    if (cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });

    const item = await dbGet(`SELECT id, COALESCE(precio,0) AS precio FROM inventario_items WHERE id = ?`, [item_id]);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });

    const tipoLower = tipo.toLowerCase();
    const esSalida = tipoLower.includes("egr") || tipoLower.includes("pres") || tipoLower.includes("cons");
    if (esSalida) {
      const stock = await getStockByItemId(item_id);
      if (stock < cantidad) return res.status(400).json({ ok: false, error: "Stock insuficiente" });
    }

    let costo_total = 0;
    if (tipoLower.includes("egr") || tipoLower.includes("cons")) {
      costo_total = toNum(item.precio, 0) * cantidad;
    }

    const r = await dbRun(
      `
      INSERT INTO inventario_movimientos (item_id, tipo, cantidad, fecha, costo_total, curso_id, instructor_id, nota)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [item_id, tipo, cantidad, fecha, costo_total, curso_id, instructor_id, nota]
    );

    res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (err) {
    console.error("[INVENTARIO][POST /movimientos]", err);
    res.status(500).json({ ok: false, error: "Error al registrar movimiento" });
  }
});

// ================= PRESTAMOS =================
router.get("/prestamos", async (req, res) => {
  try {
    const estado = s(req.query.estado);
    const params = [];
    let where = "WHERE 1=1";
    if (estado) {
      where += " AND p.estado = ?";
      params.push(estado);
    }

    const rows = await dbAll(
      `
      SELECT 
        p.*,
        COALESCE(it.producto,'') AS item_producto,
        COALESCE(i.nombre,'') AS instructor_nombre,
        COALESCE(c.nombre,'') AS curso_nombre
      FROM inventario_prestamos p
      LEFT JOIN inventario_items it ON it.id = p.item_id
      LEFT JOIN instructores i ON i.id = p.instructor_id
      LEFT JOIN cursos c ON c.id = p.curso_id
      ${where}
      ORDER BY p.id DESC
      LIMIT 1000
      `,
      params
    );

    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("[INVENTARIO][GET /prestamos]", err);
    res.status(500).json({ ok: false, error: "Error al listar préstamos" });
  }
});

router.post("/prestamos", async (req, res) => {
  try {
    const b = req.body || {};
    const item_id = toInt(b.item_id, 0);
    const instructor_id = toInt(b.instructor_id, 0);
    const curso_id = toInt(b.curso_id, 0) || null;
    const cantidad = toInt(b.cantidad, 0);
    const fecha_salida = isoDate(b.fecha_salida);
    const nota = s(b.nota) || null;

    if (!item_id) return res.status(400).json({ ok: false, error: "item_id requerido" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "instructor_id requerido" });
    if (cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });

    const stock = await getStockByItemId(item_id);
    if (stock < cantidad) return res.status(400).json({ ok: false, error: "Stock insuficiente" });

    const r = await dbRun(
      `
      INSERT INTO inventario_prestamos (item_id, instructor_id, curso_id, cantidad, fecha_salida, estado, nota)
      VALUES (?, ?, ?, ?, ?, 'Pendiente', ?)
      `,
      [item_id, instructor_id, curso_id, cantidad, fecha_salida, nota]
    );

    await dbRun(
      `
      INSERT INTO inventario_movimientos (item_id, tipo, cantidad, fecha, costo_total, curso_id, instructor_id, nota)
      VALUES (?, 'Prestamo', ?, ?, 0, ?, ?, ?)
      `,
      [item_id, cantidad, fecha_salida, curso_id, instructor_id, `Préstamo #${r.lastID}${nota ? " — " + nota : ""}`]
    );

    res.status(201).json({ ok: true, data: { id: r.lastID } });
  } catch (err) {
    console.error("[INVENTARIO][POST /prestamos]", err);
    res.status(500).json({ ok: false, error: "Error al registrar préstamo" });
  }
});

router.post("/prestamos/:id/devolver", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const p = await dbGet(`SELECT * FROM inventario_prestamos WHERE id = ?`, [id]);
    if (!p) return res.status(404).json({ ok: false, error: "Préstamo no encontrado" });
    if (String(p.estado) !== "Pendiente") return res.status(400).json({ ok: false, error: "El préstamo no está pendiente" });

    const fecha_devolucion = isoDate(req.body?.fecha_devolucion);

    await dbRun(`UPDATE inventario_prestamos SET estado='Devuelto', fecha_devolucion=? WHERE id=?`, [fecha_devolucion, id]);

    await dbRun(
      `
      INSERT INTO inventario_movimientos (item_id, tipo, cantidad, fecha, costo_total, curso_id, instructor_id, nota)
      VALUES (?, 'Devolucion', ?, ?, 0, ?, ?, ?)
      `,
      [p.item_id, p.cantidad, fecha_devolucion, p.curso_id || null, p.instructor_id || null, `Devolución préstamo #${id}`]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[INVENTARIO][POST /prestamos/:id/devolver]", err);
    res.status(500).json({ ok: false, error: "Error al devolver préstamo" });
  }
});

router.post("/prestamos/:id/cobrar", async (req, res) => {
  const id = toInt(req.params.id, 0);
  if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    const p = await dbGet(`SELECT * FROM inventario_prestamos WHERE id = ?`, [id]);
    if (!p) return res.status(404).json({ ok: false, error: "Préstamo no encontrado" });
    if (String(p.estado) !== "Pendiente") return res.status(400).json({ ok: false, error: "El préstamo no está pendiente" });

    await dbRun(`UPDATE inventario_prestamos SET estado='Cobrado' WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[INVENTARIO][POST /prestamos/:id/cobrar]", err);
    res.status(500).json({ ok: false, error: "Error al marcar como cobrado" });
  }
});

// ================= GET /api/inventario/alertas =================
router.get("/alertas", async (req, res) => {
  try {
    await ensurePrecioCol();

    const items = await dbAll(
      `SELECT id, producto, categoria, unidad, stock_minimo, estado, COALESCE(precio,0) AS precio
       FROM inventario_items
       WHERE estado='Activo'
       ORDER BY id DESC
       LIMIT 500`
    );

    const out = [];
    for (const it of items) {
      const stock = await getStockByItemId(it.id);
      if (stock <= toInt(it.stock_minimo, 0)) out.push({ ...it, stock });
    }

    res.json({ ok: true, items: out });
  } catch (err) {
    console.error("[INVENTARIO][GET /alertas]", err);
    res.status(500).json({ ok: false, error: "Error al listar alertas" });
  }
});

module.exports = router;

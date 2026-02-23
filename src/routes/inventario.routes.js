// src/routes/inventario.routes.js
const express = require("express");
const db = require("../db");
const router = express.Router();

function authRequired(req, res, next) { return next(); }
function adminOnly(req, res, next) { return next(); }
router.use(authRequired);

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
function dbExec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

const ITEM_ESTADOS = new Set(["Activo", "Inactivo"]);
const MOV_TIPOS = new Set(["Ingreso", "Entrada", "Salida", "Ajuste", "Prestamo", "Devolucion", "Venta"]);

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
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}
function likeWrap(s) { return `%${String(s || "").trim()}%`; }
function normalizeTipo(tipo) {
  if (tipo === "Entrada") return "Ingreso";
  return tipo;
}

// ===== Schema flags =====
let FLAGS_READY = false;
let HAS_MOV_PRECIO_UNITARIO = false;
let HAS_PRESTAMOS_TABLE = false;
let P_HAS_NOTA = false;
let P_HAS_CANT_DEV = false;
let P_HAS_FECHA_DEV = false;

async function tableExists(name) {
  const r = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]);
  return !!r;
}
async function tableCols(name) {
  try {
    const cols = await dbAll(`PRAGMA table_info(${name})`);
    return new Set((cols || []).map(c => c && c.name).filter(Boolean));
  } catch (_) { return new Set(); }
}
async function ensureFlags() {
  if (FLAGS_READY) return;
  const movCols = await tableCols("inventario_movimientos");
  HAS_MOV_PRECIO_UNITARIO = movCols.has("precio_unitario");
  HAS_PRESTAMOS_TABLE = await tableExists("inventario_prestamos");
  if (HAS_PRESTAMOS_TABLE) {
    const pCols = await tableCols("inventario_prestamos");
    P_HAS_NOTA = pCols.has("nota");
    P_HAS_CANT_DEV = pCols.has("cantidad_devuelta");
    P_HAS_FECHA_DEV = pCols.has("fecha_devolucion");
  }
  FLAGS_READY = true;
}

function precioExpr(alias = "m") {
  return HAS_MOV_PRECIO_UNITARIO ? `COALESCE(${alias}.precio_unitario,0)` : "0";
}

async function getStockActual(item_id) {
  await ensureFlags();
  const row = await dbGet(
    `SELECT COALESCE(SUM(
      CASE
        WHEN tipo IN ('Ingreso','Devolucion') THEN cantidad
        WHEN tipo IN ('Salida','Prestamo','Venta') THEN -cantidad
        WHEN tipo = 'Ajuste' THEN cantidad
        ELSE 0
      END
    ), 0) AS stock
    FROM inventario_movimientos WHERE item_id = ?`, [item_id]);
  return row ? Number(row.stock || 0) : 0;
}

async function getItemById(id) {
  return dbGet(`SELECT id, producto, categoria, unidad, stock_minimo, estado FROM inventario_items WHERE id = ?`, [id]);
}

// Construye INSERT para movimientos compatible con ambas versiones de DB
async function insertMovimiento({ item_id, fecha, tipo, cantidad, costo_unitario, precio_unitario, motivo, curso_id, instructor_id }) {
  await ensureFlags();
  const tipoNorm = normalizeTipo(tipo);
  if (HAS_MOV_PRECIO_UNITARIO) {
    return dbRun(
      `INSERT INTO inventario_movimientos (item_id,fecha,tipo,cantidad,costo_unitario,precio_unitario,motivo,curso_id,instructor_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [item_id, fecha, tipoNorm, cantidad, costo_unitario ?? 0, precio_unitario ?? 0, motivo, curso_id ?? null, instructor_id ?? null]
    );
  } else {
    return dbRun(
      `INSERT INTO inventario_movimientos (item_id,fecha,tipo,cantidad,costo_unitario,motivo,curso_id,instructor_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [item_id, fecha, tipoNorm, cantidad, costo_unitario ?? 0, motivo, curso_id ?? null, instructor_id ?? null]
    );
  }
}

// ==========================
// ITEMS CRUD
// ==========================

// GET /api/inventario/items
router.get("/items", async (req, res) => {
  try {
    const q = normStr(req.query.q);
    const estado = normStr(req.query.estado);
    const limit = Math.max(1, toInt(req.query.limit, 500) ?? 500);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);
    const where = [], params = [];
    if (estado) {
      if (!ITEM_ESTADOS.has(estado)) return res.status(400).json({ ok: false, error: "estado inválido" });
      where.push("it.estado = ?"); params.push(estado);
    }
    if (q) { where.push("(it.producto LIKE ? OR it.categoria LIKE ?)"); params.push(likeWrap(q), likeWrap(q)); }
    const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await dbAll(
      `SELECT it.id, it.producto, it.categoria, it.unidad, it.stock_minimo, it.estado,
        COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('Ingreso','Devolucion') THEN m.cantidad WHEN m.tipo IN ('Salida','Prestamo','Venta') THEN -m.cantidad WHEN m.tipo='Ajuste' THEN m.cantidad ELSE 0 END) FROM inventario_movimientos m WHERE m.item_id = it.id), 0) AS stock_actual
      FROM inventario_items it ${wh} ORDER BY it.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error listando items" });
  }
});

// POST /api/inventario/items
router.post("/items", adminOnly, async (req, res) => {
  try {
    const producto = normStr(req.body?.producto);
    const categoria = normStr(req.body?.categoria);
    const unidad = normStr(req.body?.unidad);
    const stock_minimo = Math.max(0, toInt(req.body?.stock_minimo, 0) ?? 0);
    const estado = normStr(req.body?.estado) || "Activo";
    if (!producto) return res.status(400).json({ ok: false, error: "producto es obligatorio" });
    if (!ITEM_ESTADOS.has(estado)) return res.status(400).json({ ok: false, error: "estado inválido" });
    const r = await dbRun(
      `INSERT INTO inventario_items (producto,categoria,unidad,stock_minimo,estado,created_at,updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`,
      [producto, categoria, unidad, stock_minimo, estado]);
    const item = await dbGet(`SELECT * FROM inventario_items WHERE id=?`, [r.lastID]);
    return res.status(201).json({ ok: true, data: item });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error creando item" });
  }
});

// GET /api/inventario/items/:id
router.get("/items/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });
    const item = await dbGet(
      `SELECT it.id, it.producto, it.categoria, it.unidad, it.stock_minimo, it.estado,
        COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('Ingreso','Devolucion') THEN m.cantidad WHEN m.tipo IN ('Salida','Prestamo','Venta') THEN -m.cantidad WHEN m.tipo='Ajuste' THEN m.cantidad ELSE 0 END) FROM inventario_movimientos m WHERE m.item_id = it.id), 0) AS stock_actual
      FROM inventario_items it WHERE it.id=?`, [id]);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    return res.json({ ok: true, data: item });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error obteniendo item" });
  }
});

// PUT /api/inventario/items/:id
router.put("/items/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });
    const existing = await getItemById(id);
    if (!existing) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    const producto = normStr(req.body?.producto) ?? existing.producto;
    const categoria = normStr(req.body?.categoria) ?? existing.categoria;
    const unidad = normStr(req.body?.unidad) ?? existing.unidad;
    const stock_minimo = req.body?.stock_minimo !== undefined ? Math.max(0, toInt(req.body.stock_minimo, 0) ?? 0) : existing.stock_minimo;
    const estado = normStr(req.body?.estado) ?? existing.estado;
    if (!producto) return res.status(400).json({ ok: false, error: "producto es obligatorio" });
    if (!ITEM_ESTADOS.has(estado)) return res.status(400).json({ ok: false, error: "estado inválido" });
    await dbRun(
      `UPDATE inventario_items SET producto=?,categoria=?,unidad=?,stock_minimo=?,estado=?,updated_at=datetime('now') WHERE id=?`,
      [producto, categoria, unidad, stock_minimo, estado, id]);
    const updated = await dbGet(`SELECT * FROM inventario_items WHERE id=?`, [id]);
    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error actualizando item" });
  }
});

// DELETE /api/inventario/items/:id (inactivar)
router.delete("/items/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });
    const existing = await getItemById(id);
    if (!existing) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    await dbRun(`UPDATE inventario_items SET estado='Inactivo', updated_at=datetime('now') WHERE id=?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error eliminando item" });
  }
});

// ==========================
// MOVIMIENTOS (KARDEX)
// ==========================

// GET /api/inventario/movimientos
router.get("/movimientos", async (req, res) => {
  try {
    await ensureFlags();
    const item_id = toInt(req.query.item_id, null);
    const tipo = normStr(req.query.tipo);
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    if (tipo && !MOV_TIPOS.has(tipo)) return res.status(400).json({ ok: false, error: "tipo inválido" });
    if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido" });
    if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido" });
    const where = [], params = [];
    if (item_id) { where.push("m.item_id = ?"); params.push(item_id); }
    if (tipo) { where.push("m.tipo = ?"); params.push(normalizeTipo(tipo)); }
    if (desde) { where.push("m.fecha >= ?"); params.push(desde); }
    if (hasta) { where.push("m.fecha <= ?"); params.push(hasta); }
    const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await dbAll(
      `SELECT m.id, m.item_id, m.fecha, m.tipo, m.cantidad, m.costo_unitario,
        ${precioExpr("m")} AS precio_unitario,
        m.motivo, m.curso_id, m.instructor_id,
        it.producto AS item_producto, c.nombre AS curso_nombre, ins.nombre AS instructor_nombre
      FROM inventario_movimientos m
      JOIN inventario_items it ON it.id = m.item_id
      LEFT JOIN cursos c ON c.id = m.curso_id
      LEFT JOIN instructores ins ON ins.id = m.instructor_id
      ${wh} ORDER BY m.fecha DESC, m.id DESC LIMIT 2000`, params);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error listando movimientos" });
  }
});

// POST /api/inventario/movimientos (ingreso/ajuste)
router.post("/movimientos", adminOnly, async (req, res) => {
  try {
    await ensureFlags();
    const item_id = toInt(req.body?.item_id, null);
    const tipo = normStr(req.body?.tipo) || "Ingreso";
    const cantidad = toInt(req.body?.cantidad, null);
    const costo_unitario = Math.max(0, toNum(req.body?.costo_unitario, 0) ?? 0);
    const fecha = normStr(req.body?.fecha) || todayISO();
    const motivo = normStr(req.body?.motivo);
    const curso_id = toInt(req.body?.curso_id, null);
    const instructor_id = toInt(req.body?.instructor_id, null);
    if (!item_id) return res.status(400).json({ ok: false, error: "item_id obligatorio" });
    if (!MOV_TIPOS.has(tipo)) return res.status(400).json({ ok: false, error: "tipo inválido" });
    if (!cantidad || cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida" });
    const item = await getItemById(item_id);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    if (["Salida","Prestamo","Venta"].includes(tipo)) {
      const stock = await getStockActual(item_id);
      if (stock - cantidad < 0) return res.status(400).json({ ok: false, error: `Stock insuficiente (${stock} disponibles)` });
    }
    const r = await insertMovimiento({ item_id, fecha, tipo, cantidad, costo_unitario, precio_unitario: 0, motivo, curso_id, instructor_id });
    return res.status(201).json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error registrando movimiento: " + err.message });
  }
});

// ==========================
// ALERTAS
// ==========================

router.get("/alertas", async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT * FROM (
        SELECT it.id, it.producto, it.categoria, it.unidad, it.stock_minimo, it.estado,
          COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('Ingreso','Devolucion') THEN m.cantidad WHEN m.tipo IN ('Salida','Prestamo','Venta') THEN -m.cantidad WHEN m.tipo='Ajuste' THEN m.cantidad ELSE 0 END) FROM inventario_movimientos m WHERE m.item_id = it.id), 0) AS stock_actual
        FROM inventario_items it WHERE it.estado='Activo'
      ) t WHERE t.stock_actual <= t.stock_minimo ORDER BY t.stock_actual ASC, t.producto ASC LIMIT 500`);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error listando alertas" });
  }
});

// ==========================
// RESUMEN (por_curso + por_instructor)
// ==========================

router.get("/resumen", async (req, res) => {
  try {
    await ensureFlags();
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido" });
    if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido" });
    const where = [], params = [];
    if (desde) { where.push("m.fecha >= ?"); params.push(desde); }
    if (hasta) { where.push("m.fecha <= ?"); params.push(hasta); }
    const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const movimientos = await dbAll(
      `SELECT m.id, m.item_id, m.fecha, m.tipo, m.cantidad, m.costo_unitario,
        ${precioExpr("m")} AS precio_unitario,
        m.motivo, m.curso_id, m.instructor_id,
        it.producto AS item_producto, c.nombre AS curso_nombre, ins.nombre AS instructor_nombre
      FROM inventario_movimientos m
      JOIN inventario_items it ON it.id = m.item_id
      LEFT JOIN cursos c ON c.id = m.curso_id
      LEFT JOIN instructores ins ON ins.id = m.instructor_id
      ${wh} ORDER BY m.fecha DESC, m.id DESC LIMIT 5000`, params);

    const DESCUENTAN = ["Salida", "Prestamo", "Venta"];
    const porCursoMap = {}, porInstructorMap = {};
    for (const m of movimientos) {
      if (!DESCUENTAN.includes(m.tipo)) continue;
      const cant = Number(m.cantidad || 0);
      if (m.curso_id) {
        if (!porCursoMap[m.curso_id]) porCursoMap[m.curso_id] = { curso_id: m.curso_id, curso_nombre: m.curso_nombre || "Sin nombre", salidas: 0 };
        porCursoMap[m.curso_id].salidas += cant;
      }
      if (m.instructor_id) {
        if (!porInstructorMap[m.instructor_id]) porInstructorMap[m.instructor_id] = { instructor_id: m.instructor_id, instructor_nombre: m.instructor_nombre || "Sin nombre", salidas: 0 };
        porInstructorMap[m.instructor_id].salidas += cant;
      }
    }

    return res.json({
      ok: true,
      data: {
        movimientos,
        por_curso: Object.values(porCursoMap).sort((a, b) => b.salidas - a.salidas),
        por_instructor: Object.values(porInstructorMap).sort((a, b) => b.salidas - a.salidas)
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error generando resumen" });
  }
});

// ==========================
// VENTAS
// ==========================

// GET /api/inventario/ventas/resumen
router.get("/ventas/resumen", async (req, res) => {
  try {
    await ensureFlags();
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido" });
    if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido" });
    const where = ["m.tipo = 'Venta'"], params = [];
    if (desde) { where.push("m.fecha >= ?"); params.push(desde); }
    if (hasta) { where.push("m.fecha <= ?"); params.push(hasta); }
    const row = await dbGet(
      `SELECT COUNT(*) AS total_ventas, COALESCE(SUM(m.cantidad * (${precioExpr("m")})), 0) AS monto_ventas
       FROM inventario_movimientos m WHERE ${where.join(" AND ")}`, params);
    return res.json({ ok: true, data: row || { total_ventas: 0, monto_ventas: 0 } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error resumen ventas" });
  }
});

// POST /api/inventario/ventas
router.post("/ventas", adminOnly, async (req, res) => {
  try {
    await ensureFlags();
    const item_id = toInt(req.body?.item_id, null);
    const cantidad = toInt(req.body?.cantidad, null);
    const precio_unitario = Math.max(0, toNum(req.body?.precio_unitario, 0) ?? 0);
    const fecha = normStr(req.body?.fecha) || todayISO();
    const nota = normStr(req.body?.nota) || "Venta";
    const curso_id = toInt(req.body?.curso_id, null);
    const instructor_id = toInt(req.body?.instructor_id, null);
    if (!item_id) return res.status(400).json({ ok: false, error: "item_id obligatorio" });
    if (!cantidad || cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida" });
    const item = await getItemById(item_id);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    const stock = await getStockActual(item_id);
    if (stock - cantidad < 0) return res.status(400).json({ ok: false, error: `Stock insuficiente (${stock} disponibles)` });
    const r = await insertMovimiento({ item_id, fecha, tipo: "Venta", cantidad, costo_unitario: 0, precio_unitario, motivo: nota, curso_id, instructor_id });
    return res.status(201).json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error registrando venta: " + err.message });
  }
});

// ==========================
// PRÉSTAMOS
// ==========================

router.get("/prestamos", async (req, res) => {
  try {
    await ensureFlags();
    if (!HAS_PRESTAMOS_TABLE) return res.json({ ok: true, data: [] });
    const estado = normStr(req.query.estado);
    const where = [], params = [];
    if (estado) { where.push("p.estado = ?"); params.push(estado); }
    const wh = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const notaSel = P_HAS_NOTA ? "COALESCE(p.nota,'') AS nota" : "'' AS nota";
    const cantDevSel = P_HAS_CANT_DEV ? "COALESCE(p.cantidad_devuelta,0) AS cantidad_devuelta" : "0 AS cantidad_devuelta";
    const fechaDevSel = P_HAS_FECHA_DEV ? "p.fecha_devolucion AS fecha_devolucion" : "NULL AS fecha_devolucion";
    const rows = await dbAll(
      `SELECT p.id, p.item_id, p.cantidad, p.instructor_id, p.curso_id, p.fecha,
        ${notaSel}, p.estado, ${cantDevSel}, ${fechaDevSel},
        it.producto AS item_producto, c.nombre AS curso_nombre, ins.nombre AS instructor_nombre
      FROM inventario_prestamos p
      JOIN inventario_items it ON it.id = p.item_id
      LEFT JOIN cursos c ON c.id = p.curso_id
      LEFT JOIN instructores ins ON ins.id = p.instructor_id
      ${wh} ORDER BY p.estado ASC, p.fecha DESC, p.id DESC LIMIT 2000`, params);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error listando préstamos" });
  }
});

router.post("/prestamos", adminOnly, async (req, res) => {
  try {
    await ensureFlags();
    const item_id = toInt(req.body?.item_id, null);
    const cantidad = toInt(req.body?.cantidad, null);
    const instructor_id = toInt(req.body?.instructor_id, null);
    const curso_id = toInt(req.body?.curso_id, null);
    const fecha = normStr(req.body?.fecha) || todayISO();
    const nota = normStr(req.body?.nota) || "Préstamo en clase";
    const costo_unitario = Math.max(0, toNum(req.body?.costo_unitario, 0) ?? 0);
    if (!item_id) return res.status(400).json({ ok: false, error: "item_id obligatorio" });
    if (!cantidad || cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });
    if (!instructor_id) return res.status(400).json({ ok: false, error: "instructor_id obligatorio" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida" });
    const item = await getItemById(item_id);
    if (!item) return res.status(404).json({ ok: false, error: "Item no encontrado" });
    const stock = await getStockActual(item_id);
    if (stock - cantidad < 0) return res.status(400).json({ ok: false, error: `Stock insuficiente (${stock} disponibles)` });

    await dbRun("BEGIN IMMEDIATE");
    try {
      const movR = await insertMovimiento({ item_id, fecha, tipo: "Prestamo", cantidad, costo_unitario, precio_unitario: 0, motivo: nota, curso_id, instructor_id });
      let prestamoId = null;
      if (HAS_PRESTAMOS_TABLE) {
        const r2 = await dbRun(
          `INSERT INTO inventario_prestamos (item_id,cantidad,instructor_id,curso_id,fecha,${P_HAS_NOTA?"nota,":""}estado,${P_HAS_CANT_DEV?"cantidad_devuelta,":""}created_at,updated_at)
           VALUES (?,?,?,?,?,${P_HAS_NOTA?"?,":""}'Pendiente',${P_HAS_CANT_DEV?"0,":""}datetime('now'),datetime('now'))`,
          [item_id, cantidad, instructor_id, curso_id, fecha, ...(P_HAS_NOTA ? [nota] : [])]);
        prestamoId = r2.lastID;
      }
      await dbRun("COMMIT");
      return res.status(201).json({ ok: true, id: prestamoId || movR.lastID });
    } catch (e) {
      await dbRun("ROLLBACK").catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error registrando préstamo: " + err.message });
  }
});

router.post("/prestamos/:id/devolver", adminOnly, async (req, res) => {
  try {
    await ensureFlags();
    if (!HAS_PRESTAMOS_TABLE) return res.status(500).json({ ok: false, error: "Tabla inventario_prestamos no existe" });
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "id inválido" });
    const fecha = normStr(req.body?.fecha) || todayISO();
    const cantidad = toInt(req.body?.cantidad, null);
    const nota = normStr(req.body?.nota) || "Devolución";
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida" });
    if (!cantidad || cantidad <= 0) return res.status(400).json({ ok: false, error: "cantidad inválida" });
    const p = await dbGet(`SELECT * FROM inventario_prestamos WHERE id = ?`, [id]);
    if (!p) return res.status(404).json({ ok: false, error: "Préstamo no encontrado" });
    const total = Number(p.cantidad || 0);
    if (!P_HAS_CANT_DEV) {
      if (cantidad !== total) return res.status(400).json({ ok: false, error: "Debe devolver la cantidad completa." });
    } else {
      const pendiente = Math.max(0, total - Number(p.cantidad_devuelta || 0));
      if (pendiente <= 0) return res.status(400).json({ ok: false, error: "Préstamo ya devuelto" });
      if (cantidad > pendiente) return res.status(400).json({ ok: false, error: "Supera lo pendiente" });
    }
    await dbRun("BEGIN IMMEDIATE");
    try {
      await insertMovimiento({ item_id: p.item_id, fecha, tipo: "Devolucion", cantidad: Math.abs(cantidad), costo_unitario: 0, precio_unitario: 0, motivo: nota, curso_id: p.curso_id, instructor_id: p.instructor_id });
      const sets = [], params = [];
      if (P_HAS_CANT_DEV) {
        const newDev = Number(p.cantidad_devuelta || 0) + Math.abs(cantidad);
        const newEst = newDev >= total ? "Devuelto" : "Pendiente";
        sets.push("cantidad_devuelta = ?"); params.push(newDev);
        sets.push("estado = ?"); params.push(newEst);
        if (P_HAS_FECHA_DEV) { sets.push("fecha_devolucion = CASE WHEN ?='Devuelto' THEN ? ELSE fecha_devolucion END"); params.push(newEst, fecha); }
      } else {
        sets.push("estado = 'Devuelto'");
        if (P_HAS_FECHA_DEV) { sets.push("fecha_devolucion = ?"); params.push(fecha); }
      }
      sets.push("updated_at = datetime('now')");
      await dbRun(`UPDATE inventario_prestamos SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
      await dbRun("COMMIT");
      return res.json({ ok: true });
    } catch (e) {
      await dbRun("ROLLBACK").catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error registrando devolución" });
  }
});

module.exports = router;

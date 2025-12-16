
// src/routes/pagos.routes.js
const express = require("express");
const db = require("../db"); // sqlite3.Database()
const router = express.Router();

// ===============================
// Middlewares (locales)
// Si ya los exportas desde auth.routes.js, puedes usar:
// const { authRequired, adminOnly } = require("./auth.routes"); // ajusta la ruta según tu estructura
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
    return res.status(403).json({ ok: false, error: "Solo Admin" });
  }
  next();
}

// En este módulo permitimos crear pagos a Admin y Caja (más realista para caja).
function cajaOrAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  const rol = req.session.user.rol;
  if (rol !== "Admin" && rol !== "Caja") {
    return res.status(403).json({ ok: false, error: "Solo Admin o Caja" });
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
// Utilidades / validaciones
// ===============================
const ESTADOS_PAGO = new Set(["Pagado", "Pendiente", "Anulado"]);
const METODOS = new Set(["Efectivo", "Transferencia", "QR", "Tarjeta"]);

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
  const dt = new Date(`${s}T00:00:00Z`);
  return (
    Number.isFinite(y) &&
    Number.isFinite(m) &&
    Number.isFinite(d) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function likeWrap(s) {
  return `%${String(s || "").trim()}%`;
}

// ===============================
// Helpers de negocio: inscripción / precio / pagado / deuda
// ===============================
async function getInscripcionJoin(inscripcion_id) {
  return await dbGet(
    `
    SELECT
      i.id AS inscripcion_id,
      i.estado AS inscripcion_estado,
      i.alumno_id,
      i.curso_id,
      a.nombre AS alumno_nombre,
      a.documento AS alumno_documento,
      c.nombre AS curso_nombre,
      c.precio AS curso_precio
    FROM inscripciones i
    JOIN alumnos a ON a.id = i.alumno_id
    JOIN cursos  c ON c.id = i.curso_id
    WHERE i.id = ?
    `,
    [inscripcion_id]
  );
}

async function getTotalPagado(inscripcion_id, excludePagoId = null) {
  const params = [inscripcion_id];
  let sql = `
    SELECT COALESCE(SUM(monto), 0) AS total_pagado
    FROM pagos
    WHERE inscripcion_id = ?
      AND estado = 'Pagado'
  `;
  if (excludePagoId !== null) {
    sql += ` AND id <> ?`;
    params.push(excludePagoId);
  }
  const row = await dbGet(sql, params);
  return Number(row?.total_pagado || 0);
}

async function getResumenInscripcion(inscripcion_id) {
  const join = await getInscripcionJoin(inscripcion_id);
  if (!join) return null;
  const precio = Number(join.curso_precio || 0);
  const total_pagado = await getTotalPagado(inscripcion_id);
  const deuda = Math.max(0, precio - total_pagado);
  return { precio, total_pagado, deuda };
}

async function getPagoById(pago_id) {
  return await dbGet(
    `
    SELECT id, inscripcion_id, fecha, monto, estado, metodo, observaciones
    FROM pagos
    WHERE id = ?
    `,
    [pago_id]
  );
}

// ===============================
// 1) GET /api/pagos
// Filtros: inscripcion_id, alumno_id, curso_id, estado, metodo, desde, hasta, q, limit, offset
// JOIN: alumno + curso
// ===============================
router.get("/", async (req, res) => {
  try {
    const inscripcion_id = toInt(req.query.inscripcion_id, null);
    const alumno_id = toInt(req.query.alumno_id, null);
    const curso_id = toInt(req.query.curso_id, null);
    const estado = normStr(req.query.estado);
    const metodo = normStr(req.query.metodo);
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);
    const q = normStr(req.query.q);

    const limit = Math.max(1, toInt(req.query.limit, 50) ?? 50);
    const offset = Math.max(0, toInt(req.query.offset, 0) ?? 0);

    const where = [];
    const params = [];

    if (inscripcion_id !== null) {
      where.push("p.inscripcion_id = ?");
      params.push(inscripcion_id);
    }
    if (alumno_id !== null) {
      where.push("i.alumno_id = ?");
      params.push(alumno_id);
    }
    if (curso_id !== null) {
      where.push("i.curso_id = ?");
      params.push(curso_id);
    }
    if (estado) {
      if (!ESTADOS_PAGO.has(estado)) {
        return res.status(400).json({ ok: false, error: "estado inválido (Pagado|Pendiente|Anulado)" });
      }
      where.push("p.estado = ?");
      params.push(estado);
    }
    if (metodo) {
      if (!METODOS.has(metodo)) {
        return res.status(400).json({ ok: false, error: "metodo inválido (Efectivo|Transferencia|QR|Tarjeta)" });
      }
      where.push("p.metodo = ?");
      params.push(metodo);
    }
    if (desde || hasta) {
      const d = desde || "0000-01-01";
      const h = hasta || "9999-12-31";
      if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
      if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });
      where.push("p.fecha BETWEEN ? AND ?");
      params.push(d, h);
    }
    if (q) {
      where.push("(a.nombre LIKE ? OR a.documento LIKE ?)");
      params.push(likeWrap(q), likeWrap(q));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = await dbGet(
      `
      SELECT COUNT(*) AS total
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      ${whereSql}
      `,
      params
    );
    const total = totalRow ? Number(totalRow.total || 0) : 0;

    const rows = await dbAll(
      `
      SELECT
        p.id AS pago_id,
        p.inscripcion_id,
        p.fecha,
        p.monto,
        p.estado AS pago_estado,
        p.metodo,
        p.observaciones,

        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,

        c.nombre AS curso_nombre
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      ${whereSql}
      ORDER BY p.fecha DESC, p.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ ok: true, data: rows, meta: { limit, offset, total } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar pagos" });
  }
});

// ===============================
// 6) GET /api/pagos/inscripcion/:inscripcion_id/resumen
// (Se pone antes que "/:id" para evitar colisión)
// ===============================
router.get("/inscripcion/:inscripcion_id/resumen", async (req, res) => {
  try {
    const inscripcion_id = toInt(req.params.inscripcion_id, null);
    if (!inscripcion_id) return res.status(400).json({ ok: false, error: "inscripcion_id inválido" });

    const resumen = await getResumenInscripcion(inscripcion_id);
    if (!resumen) return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });

    return res.json({ ok: true, data: resumen });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al calcular resumen" });
  }
});

// ===============================
// 7) GET /api/pagos/deudores
// Lista de inscripciones con deuda > 0 (solo suma pagos estado='Pagado')
// ===============================
router.get("/deudores", async (req, res) => {
  try {
    // Deudores sobre inscripciones activas (más útil). Si quieres incluir inactivas, quita el filtro i.estado.
    const rows = await dbAll(
      `
      SELECT
        i.id AS inscripcion_id,

        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,

        c.nombre AS curso_nombre,
        c.precio AS precio,

        COALESCE(p.total_pagado, 0) AS total_pagado,
        (c.precio - COALESCE(p.total_pagado, 0)) AS deuda
      FROM inscripciones i
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      LEFT JOIN (
        SELECT inscripcion_id, COALESCE(SUM(monto), 0) AS total_pagado
        FROM pagos
        WHERE estado = 'Pagado'
        GROUP BY inscripcion_id
      ) p ON p.inscripcion_id = i.id
      WHERE i.estado = 'Activa'
        AND (c.precio - COALESCE(p.total_pagado, 0)) > 0
      ORDER BY deuda DESC, i.id DESC
      `
    );

    // Normalizar números
    const data = rows.map((r) => ({
      inscripcion_id: r.inscripcion_id,
      alumno_nombre: r.alumno_nombre,
      alumno_documento: r.alumno_documento,
      curso_nombre: r.curso_nombre,
      precio: Number(r.precio || 0),
      total_pagado: Number(r.total_pagado || 0),
      deuda: Number(r.deuda || 0),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al listar deudores" });
  }
});

// ===============================
// 8) GET /api/pagos/resumen
// Query: desde, hasta
// Devuelve: total_ingresos (Pagado), por método, por curso
// ===============================
router.get("/resumen", async (req, res) => {
  try {
    const desde = normStr(req.query.desde);
    const hasta = normStr(req.query.hasta);

    const d = desde || "0000-01-01";
    const h = hasta || "9999-12-31";

    if (desde && !isISODate(desde)) return res.status(400).json({ ok: false, error: "desde inválido (YYYY-MM-DD)" });
    if (hasta && !isISODate(hasta)) return res.status(400).json({ ok: false, error: "hasta inválido (YYYY-MM-DD)" });

    const totalRow = await dbGet(
      `
      SELECT COALESCE(SUM(monto), 0) AS total_ingresos
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha BETWEEN ? AND ?
      `,
      [d, h]
    );

    const porMetodo = await dbAll(
      `
      SELECT metodo, COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE estado = 'Pagado'
        AND fecha BETWEEN ? AND ?
      GROUP BY metodo
      ORDER BY total DESC
      `,
      [d, h]
    );

    const porCurso = await dbAll(
      `
      SELECT
        c.id AS curso_id,
        c.nombre AS curso_nombre,
        COALESCE(SUM(p.monto), 0) AS total
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN cursos c ON c.id = i.curso_id
      WHERE p.estado = 'Pagado'
        AND p.fecha BETWEEN ? AND ?
      GROUP BY c.id
      ORDER BY total DESC
      `,
      [d, h]
    );

    return res.json({
      ok: true,
      data: {
        desde: d,
        hasta: h,
        total_ingresos: Number(totalRow?.total_ingresos || 0),
        ingresos_por_metodo: porMetodo.map((r) => ({
          metodo: r.metodo,
          total: Number(r.total || 0),
        })),
        ingresos_por_curso: porCurso.map((r) => ({
          curso_id: r.curso_id,
          curso_nombre: r.curso_nombre,
          total: Number(r.total || 0),
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener resumen de pagos" });
  }
});

// ===============================
// 2) GET /api/pagos/:id
// Pago con alumno/curso + estado de inscripción
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const row = await dbGet(
      `
      SELECT
        p.id AS pago_id,
        p.inscripcion_id,
        p.fecha,
        p.monto,
        p.estado AS pago_estado,
        p.metodo,
        p.observaciones,

        i.estado AS inscripcion_estado,

        a.id AS alumno_id,
        a.nombre AS alumno_nombre,
        a.documento AS alumno_documento,

        c.id AS curso_id,
        c.nombre AS curso_nombre,
        c.precio AS curso_precio
      FROM pagos p
      JOIN inscripciones i ON i.id = p.inscripcion_id
      JOIN alumnos a ON a.id = i.alumno_id
      JOIN cursos  c ON c.id = i.curso_id
      WHERE p.id = ?
      `,
      [id]
    );

    if (!row) return res.status(404).json({ ok: false, error: "Pago no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al obtener pago" });
  }
});

// ===============================
// 3) POST /api/pagos (Admin/Caja) -> transacción
// Reglas: inscripción existe y Activa, monto>0, metodo válido, estado default Pagado
// No permitir sobrepago (Pagado) que supere precio del curso
// Devuelve pago creado + resumen (deuda)
// ===============================
router.post("/", cajaOrAdmin, async (req, res) => {
  try {
    const inscripcion_id = toInt(req.body?.inscripcion_id, null);
    const fecha = normStr(req.body?.fecha) || todayISO();
    const monto = toNum(req.body?.monto, null);
    const metodo = normStr(req.body?.metodo);
    const observaciones = normStr(req.body?.observaciones);
    const estado = normStr(req.body?.estado) || "Pagado";

    if (!inscripcion_id) return res.status(400).json({ ok: false, error: "inscripcion_id es obligatorio" });
    if (!isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    if (monto === null || !(monto > 0)) return res.status(400).json({ ok: false, error: "monto debe ser > 0" });
    if (!metodo || !METODOS.has(metodo)) {
      return res.status(400).json({ ok: false, error: "metodo inválido (Efectivo|Transferencia|QR|Tarjeta)" });
    }
    if (!ESTADOS_PAGO.has(estado)) {
      return res.status(400).json({ ok: false, error: "estado inválido (Pagado|Pendiente|Anulado)" });
    }

    const insc = await getInscripcionJoin(inscripcion_id);
    if (!insc) return res.status(400).json({ ok: false, error: "La inscripción no existe" });
    if (insc.inscripcion_estado !== "Activa") {
      return res.status(400).json({ ok: false, error: "La inscripción debe estar Activa" });
    }

    await dbRun("BEGIN");
    try {
      // Validar sobrepago solo si el nuevo pago cuenta como Pagado
      if (estado === "Pagado") {
        const precio = Number(insc.curso_precio || 0);
        const totalPagadoActual = await getTotalPagado(inscripcion_id);
        if (totalPagadoActual + monto > precio) {
          await dbRun("ROLLBACK");
          return res.status(409).json({ ok: false, error: "Sobrepago: el total pagado superaría el precio del curso" });
        }
      }

      const r = await dbRun(
        `
        INSERT INTO pagos (inscripcion_id, fecha, monto, estado, metodo, observaciones)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [inscripcion_id, fecha, monto, estado, metodo, observaciones]
      );

      await dbRun("COMMIT");

      const created = await dbGet(
        `
        SELECT id AS pago_id, inscripcion_id, fecha, monto, estado AS pago_estado, metodo, observaciones
        FROM pagos
        WHERE id = ?
        `,
        [r.lastID]
      );

      const resumen = await getResumenInscripcion(inscripcion_id);

      return res.status(201).json({
        ok: true,
        data: {
          ...created,
          resumen,
        },
      });
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al crear pago" });
  }
});

// ===============================
// 4) PUT /api/pagos/:id (Admin) -> transacción
// Edita: fecha, monto, metodo, observaciones (no cambia inscripcion_id ni estado aquí)
// Validar monto > 0 y no romper sobrepago si el pago está Pagado
// ===============================
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await getPagoById(id);
    if (!current) return res.status(404).json({ ok: false, error: "Pago no encontrado" });

    const fecha = req.body?.fecha !== undefined ? normStr(req.body.fecha) : current.fecha;
    const monto = req.body?.monto !== undefined ? toNum(req.body.monto, null) : Number(current.monto);
    const metodo = req.body?.metodo !== undefined ? normStr(req.body.metodo) : current.metodo;
    const observaciones =
      req.body?.observaciones !== undefined ? normStr(req.body.observaciones) : current.observaciones;

    if (!fecha || !isISODate(fecha)) return res.status(400).json({ ok: false, error: "fecha inválida (YYYY-MM-DD)" });
    if (monto === null || !(monto > 0)) return res.status(400).json({ ok: false, error: "monto debe ser > 0" });
    if (!metodo || !METODOS.has(metodo)) {
      return res.status(400).json({ ok: false, error: "metodo inválido (Efectivo|Transferencia|QR|Tarjeta)" });
    }

    const insc = await getInscripcionJoin(current.inscripcion_id);
    if (!insc) return res.status(400).json({ ok: false, error: "La inscripción asociada ya no existe" });

    await dbRun("BEGIN");
    try {
      // Validar sobrepago si este pago cuenta como Pagado (y no está Anulado/Pendiente)
      if (current.estado === "Pagado") {
        const precio = Number(insc.curso_precio || 0);
        const totalPagadoSinEste = await getTotalPagado(current.inscripcion_id, id);
        if (totalPagadoSinEste + monto > precio) {
          await dbRun("ROLLBACK");
          return res.status(409).json({ ok: false, error: "Sobrepago: el total pagado superaría el precio del curso" });
        }
      }

      await dbRun(
        `
        UPDATE pagos
        SET fecha = ?, monto = ?, metodo = ?, observaciones = ?
        WHERE id = ?
        `,
        [fecha, monto, metodo, observaciones, id]
      );

      await dbRun("COMMIT");

      const updated = await dbGet(
        `
        SELECT id AS pago_id, inscripcion_id, fecha, monto, estado AS pago_estado, metodo, observaciones
        FROM pagos
        WHERE id = ?
        `,
        [id]
      );

      const resumen = await getResumenInscripcion(current.inscripcion_id);

      return res.json({ ok: true, data: { ...updated, resumen } });
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al actualizar pago" });
  }
});

// ===============================
// 5) POST /api/pagos/:id/anular (Admin) -> transacción
// Set estado = Anulado (no borrar físico)
// ===============================
router.post("/:id/anular", adminOnly, async (req, res) => {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const current = await getPagoById(id);
    if (!current) return res.status(404).json({ ok: false, error: "Pago no encontrado" });

    if (current.estado === "Anulado") {
      // idempotente
      const resumen = await getResumenInscripcion(current.inscripcion_id);
      return res.json({ ok: true, data: { pago_id: id, estado: "Anulado", resumen } });
    }

    await dbRun("BEGIN");
    try {
      await dbRun(`UPDATE pagos SET estado = 'Anulado' WHERE id = ?`, [id]);
      await dbRun("COMMIT");

      const resumen = await getResumenInscripcion(current.inscripcion_id);
      return res.json({ ok: true, data: { pago_id: id, estado: "Anulado", resumen } });
    } catch (e) {
      await dbRun("ROLLBACK");
      throw e;
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error al anular pago" });
  }
});

module.exports = router;

/*
PAGOS depende directamente de INSCRIPCIONES:
- Cada pago pertenece a una inscripción (pagos.inscripcion_id), que conecta ALUMNOS y CURSOS.

Cálculo de deuda:
- deuda = cursos.precio - SUM(pagos WHERE estado='Pagado')
- Pagos 'Anulado' NO cuentan para ingresos ni para reducir deuda (solo 'Pagado' suma).

Endpoints que consume el frontend:
- Lista general con filtros: GET /api/pagos
- Detalle de pago: GET /api/pagos/:id
- Resumen por inscripción (precio/total_pagado/deuda):
  GET /api/pagos/inscripcion/:inscripcion_id/resumen
- Deudores (inscripciones con deuda>0): GET /api/pagos/deudores
- Resumen financiero (dashboard): GET /api/pagos/resumen?desde&hasta

Conexión con reportes / dashboard:
- /api/pagos/resumen entrega ingresos totales (solo Pagado), por método y por curso.
- /api/pagos/deudores alimenta “pendientes” por alumno/curso.

Seguridad:
- Todas las rutas requieren sesión (authRequired).
- Crear pagos: Admin o Caja (cajaOrAdmin).
- Editar / anular: solo Admin (adminOnly).
*/

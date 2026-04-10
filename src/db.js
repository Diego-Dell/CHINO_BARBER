// src/db.js
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const config = require("../services/config");

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

ensureDir(path.dirname(config.DB_PATH));

const db = new sqlite3.Database(config.DB_PATH, (err) => {
  if (err) console.error("[DB] open error:", err.message);
  else console.log("[DB] OK:", config.DB_PATH);
  try { db.configure("busyTimeout", 5000); } catch (_) {}
  try { db.run("PRAGMA busy_timeout = 5000;"); } catch (_) {}
});

// WAL y synchronous se aplican ahora (NO foreign_keys todavia - se activa despues de reparar)
db.serialize(() => {
  try { db.run("PRAGMA journal_mode = WAL;"); } catch (_) {}
  try { db.run("PRAGMA synchronous = NORMAL;"); } catch (_) {}
});

// ==== HELPERS DB ====
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      err ? reject(err) : resolve(this);
    });
  });
}
function dbExec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Ejecuta una transaccion anidable sobre la misma conexion sqlite.
 * - Nivel 0: BEGIN [IMMEDIATE]
 * - Nivel >0: SAVEPOINT
 * Esto evita "cannot start a transaction within a transaction".
 */
let txnDepth = 0;
async function runInTransaction(fn, opts = {}) {
  const immediate = opts && opts.immediate !== false;
  const spName = `sp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const isOuter = txnDepth === 0;

  if (isOuter) {
    await dbRun(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
  } else {
    await dbRun(`SAVEPOINT ${spName}`);
  }
  txnDepth += 1;

  try {
    const result = await fn();
    txnDepth -= 1;
    if (isOuter) {
      await dbRun("COMMIT");
    } else {
      await dbRun(`RELEASE SAVEPOINT ${spName}`);
    }
    return result;
  } catch (err) {
    txnDepth = Math.max(0, txnDepth - 1);
    try {
      if (isOuter) {
        await dbRun("ROLLBACK");
      } else {
        await dbRun(`ROLLBACK TO SAVEPOINT ${spName}`);
        await dbRun(`RELEASE SAVEPOINT ${spName}`);
      }
    } catch (_) {}
    throw err;
  }
}

async function tableExists(tableName) {
  try {
    const result = await dbAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?;",
      [tableName]
    );
    return result.length > 0;
  } catch (e) { return false; }
}

async function ensureColumn(table, colName, colType) {
  const cols = await dbAll("PRAGMA table_info(" + table + ");");
  const names = new Set(cols.map(c => String(c.name || "").toLowerCase()));
  if (!names.has(colName.toLowerCase())) {
    await dbRun("ALTER TABLE " + table + " ADD COLUMN " + colName + " " + colType + ";");
    console.log("[DB] Migracion: agregado " + table + "." + colName);
  }
}

async function ensureIndex(indexName, createSql) {
  if (!indexName || !createSql) return;
  try {
    await dbRun(createSql);
    console.log("[DB] Index ok:", indexName);
  } catch (e) {
    // Si ya existe o SQLite no soporta algo en versiones antiguas, no tumbar el arranque.
    console.warn("[DB] Index warn:", indexName, e.message);
  }
}

/**
 * Legado: columna estado = Pagado/Pendiente/Anulado -> cobro_estado.
 * Nuevo estado = 'activo'|'anulado' (ciclo de vida financiero).
 */
async function migratePagosEstadoCobro() {
  if (!(await tableExists("pagos"))) return;

  const cols = await dbAll("PRAGMA table_info(pagos);");
  const names = new Set(cols.map((c) => String(c.name || "").toLowerCase()));
  const hasCobro = names.has("cobro_estado");
  const hasEstado = names.has("estado");

  const legacyRow = await dbGet(
    `SELECT id FROM pagos WHERE estado IN ('Pagado','Pendiente','Anulado') LIMIT 1`
  );

  if (!legacyRow && hasCobro && hasEstado) {
    await ensureColumn("pagos", "motivo_anulacion", "TEXT");
    await dbRun(
      `UPDATE pagos SET motivo_anulacion = anulado_motivo WHERE motivo_anulacion IS NULL AND anulado_motivo IS NOT NULL`
    );
    await dbRun("DROP INDEX IF EXISTS ux_pagos_insc_cuota_pagado;");
    await dbRun(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pagos_insc_cuota_pagado
      ON pagos(inscripcion_id, cuota_nro)
      WHERE estado = 'activo' AND cobro_estado = 'Pagado' AND cuota_nro IS NOT NULL
    `);
    return;
  }

  await dbRun("DROP INDEX IF EXISTS ux_pagos_insc_cuota_pagado;");
  await dbRun("DROP INDEX IF EXISTS ix_pagos_estado;");
  await dbRun("DROP INDEX IF EXISTS ix_pagos_fecha_estado;");
  await dbRun("DROP INDEX IF EXISTS ix_pagos_insc_estado_fecha;");

  if (!hasCobro && hasEstado) {
    try {
      await dbRun("ALTER TABLE pagos RENAME COLUMN estado TO cobro_estado;");
      console.log("[DB] pagos: renombrado estado -> cobro_estado");
    } catch (e) {
      console.warn("[DB] RENAME estado->cobro_estado:", e.message);
      await ensureColumn("pagos", "cobro_estado", "TEXT");
      await dbRun(
        `UPDATE pagos SET cobro_estado = estado WHERE cobro_estado IS NULL OR trim(COALESCE(cobro_estado,'')) = ''`
      );
      try {
        await dbRun("ALTER TABLE pagos DROP COLUMN estado;");
      } catch (e2) {
        console.error("[DB] No se pudo DROP COLUMN estado:", e2.message);
        throw e2;
      }
    }
  }

  await ensureColumn("pagos", "estado", "TEXT NOT NULL DEFAULT 'activo'");
  await ensureColumn("pagos", "motivo_anulacion", "TEXT");

  try {
    await dbRun(`UPDATE pagos SET registro_estado = 'anulado'
      WHERE (cobro_estado = 'Anulado' OR anulado_at IS NOT NULL OR (anulado_motivo IS NOT NULL AND trim(anulado_motivo) != ''))
        AND COALESCE(registro_estado,'activo') = 'activo'`);
  } catch (_) {}

  await dbRun(`
    UPDATE pagos SET estado = 'anulado'
    WHERE cobro_estado = 'Anulado'
       OR IFNULL(registro_estado,'') = 'anulado'
  `);
  // Legacy: antes se reescribía cobro_estado='Pagado' al anular.
  // Regla vigente: NO mutar cobro_estado al anular; solo usar estado='anulado' como ciclo de vida.
  await dbRun(
    `UPDATE pagos SET motivo_anulacion = anulado_motivo WHERE motivo_anulacion IS NULL AND anulado_motivo IS NOT NULL`
  );
  // Backfill: si hay legacy anulado_at, derivar fecha_anulacion si falta
  await dbRun(`
    UPDATE pagos SET fecha_anulacion = COALESCE(fecha_anulacion, date(substr(anulado_at,1,10)))
    WHERE estado = 'anulado' AND anulado_at IS NOT NULL
      AND (fecha_anulacion IS NULL OR trim(fecha_anulacion) = '')
  `);
  await dbRun(
    `UPDATE pagos SET monto_centavos = CAST(ROUND(monto * 100) AS INTEGER) WHERE monto_centavos IS NULL`
  );

  await dbRun(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pagos_insc_cuota_pagado
    ON pagos(inscripcion_id, cuota_nro)
    WHERE estado = 'activo' AND cobro_estado = 'Pagado' AND cuota_nro IS NOT NULL
  `);
  console.log("[DB] pagos: migración estado/cobro_estado aplicada");
}

async function runMigrations() {
  try {
    console.log("[DB] Ejecutando migraciones...");

    // ==== PASO 1: DESACTIVAR FK para poder reparar sin interferencias ====
    await dbRun("PRAGMA foreign_keys = OFF;");

    // ==== BOOTSTRAP (DB nueva): aplicar schema.sql antes de ensureColumn ====
    // Si la DB está vacía, muchas migraciones asumen tablas base existentes.
    try {
      const hasCursos = await tableExists("cursos");
      const hasAlumnos = await tableExists("alumnos");
      if (!hasCursos && !hasAlumnos) {
        const schemaPath0 = findSchemaPath();
        if (schemaPath0) {
          const schema0 = fs.readFileSync(schemaPath0, "utf8");
          await new Promise((resolve, reject) => {
            db.exec(schema0, (err) => (err ? reject(err) : resolve()));
          });
          console.log("[DB] bootstrap schema aplicado:", schemaPath0);
        }
      }
    } catch (e) {
      console.warn("[DB] bootstrap schema warn:", e.message);
    }

    // ==== PASO 2: LIMPIAR TRIGGERS HUERFANOS ====
    // Cuando una migracion anterior hizo RENAME TABLE inventario_movimientos -> _old
    // y fue interrumpida, SQLite deja triggers internos apuntando a _old.
    try {
      const orphanTriggers = await dbAll(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND " +
        "(sql LIKE '%inventario_movimientos_old%' OR tbl_name='inventario_movimientos_old')"
      );
      for (const t of orphanTriggers) {
        await dbRun("DROP TRIGGER IF EXISTS \"" + t.name + "\"");
        console.log("[DB] Trigger huerfano eliminado:", t.name);
      }
    } catch (e) {
      console.warn("[DB] No se pudieron limpiar triggers:", e.message);
    }

    // ==== PASO 3: REPARAR inventario_prestamos si su FK apunta a _old ====
    // Cuando SQLite hace RENAME TABLE, actualiza el CREATE TABLE almacenado
    // en sqlite_master de todas las tablas que referencian la renombrada.
    // Si la migracion quedo a medias, inventario_prestamos tiene FK a _old.
    try {
      const prestRow = await dbGet(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='inventario_prestamos'"
      );
      const prestSql = String(prestRow && prestRow.sql || "");
      if (prestSql.includes("inventario_movimientos_old") || prestSql.includes("movimientos_old")) {
        console.log("[DB] inventario_prestamos tiene FK rota. Reparando...");
        let rows = [];
        try { rows = await dbAll("SELECT * FROM inventario_prestamos"); } catch (_) {}
        await dbRun("DROP TABLE IF EXISTS inventario_prestamos");
        await dbRun(`CREATE TABLE inventario_prestamos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          instructor_id INTEGER NOT NULL,
          curso_id INTEGER,
          fecha TEXT NOT NULL DEFAULT (date('now')),
          cantidad INTEGER NOT NULL CHECK(cantidad > 0),
          nota TEXT,
          estado TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Devuelto')),
          cantidad_devuelta INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_devuelta >= 0),
          fecha_devolucion TEXT,
          mov_salida_id INTEGER,
          mov_devolucion_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (item_id) REFERENCES inventario_items(id) ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY (instructor_id) REFERENCES instructores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          FOREIGN KEY (curso_id) REFERENCES cursos(id) ON UPDATE CASCADE ON DELETE SET NULL,
          FOREIGN KEY (mov_salida_id) REFERENCES inventario_movimientos(id) ON UPDATE CASCADE ON DELETE SET NULL,
          FOREIGN KEY (mov_devolucion_id) REFERENCES inventario_movimientos(id) ON UPDATE CASCADE ON DELETE SET NULL
        )`);
        for (const r of rows) {
          try {
            await dbRun(
              "INSERT OR IGNORE INTO inventario_prestamos " +
              "(id,item_id,instructor_id,curso_id,fecha,cantidad,nota,estado,cantidad_devuelta," +
              "fecha_devolucion,mov_salida_id,mov_devolucion_id,created_at,updated_at) " +
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [r.id, r.item_id, r.instructor_id, r.curso_id, r.fecha, r.cantidad,
               r.nota, r.estado, r.cantidad_devuelta != null ? r.cantidad_devuelta : 0,
               r.fecha_devolucion, r.mov_salida_id, r.mov_devolucion_id, r.created_at, r.updated_at]
            );
          } catch (_) {}
        }
        await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_item ON inventario_prestamos(item_id)");
        await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_estado ON inventario_prestamos(estado)");
        await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_instructor ON inventario_prestamos(instructor_id)");
        await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_fecha ON inventario_prestamos(fecha)");
        console.log("[DB] inventario_prestamos reparada (" + rows.length + " registros restaurados)");
      }
    } catch (e) {
      console.warn("[DB] No se pudo reparar inventario_prestamos:", e.message);
    }

    // ==== PASO 4: SI inventario_movimientos_old EXISTE, completar migracion ====
    const oldTableExists = await tableExists("inventario_movimientos_old");
    if (oldTableExists) {
      console.log("[DB] Migracion interrumpida detectada: inventario_movimientos_old existe. Completando...");
      try {
        const countOld = await dbAll("SELECT COUNT(*) as cnt FROM inventario_movimientos_old;");
        console.log("[DB] Migrando " + (countOld[0] && countOld[0].cnt || 0) + " registros...");
        await dbRun(`INSERT OR IGNORE INTO inventario_movimientos
            (id, item_id, fecha, tipo, cantidad, costo_unitario, precio_unitario, precio_venta, motivo, curso_id, instructor_id, created_at, updated_at)
          SELECT id, item_id,
            COALESCE(fecha, date('now')), tipo, COALESCE(cantidad, 0),
            COALESCE(costo_unitario, 0), COALESCE(precio_unitario, 0), precio_venta,
            motivo, curso_id, instructor_id,
            COALESCE(created_at, datetime('now')), COALESCE(updated_at, datetime('now'))
          FROM inventario_movimientos_old
          WHERE NOT EXISTS (SELECT 1 FROM inventario_movimientos m WHERE m.id = inventario_movimientos_old.id)`);
        await dbRun("DROP TABLE IF EXISTS inventario_movimientos_old;");
        console.log("[DB] inventario_movimientos_old eliminada");
      } catch (e) {
        console.warn("[DB] Error completando migracion _old:", e.message);
      }
    }

    // ==== PASO 5: MIGRACIONES DE COMPATIBILIDAD DE COLUMNAS ====
    await ensureColumn("cursos", "fecha_inicio", "TEXT");
    await ensureColumn("cursos", "fecha_fin", "TEXT");
    // Dinero: centavos como fuente de verdad (se conserva REAL legacy por compatibilidad)
    await ensureColumn("cursos", "precio_centavos", "INTEGER");
    // Plan de cuotas por inscripción (alumno+curso)
    await ensureColumn("inscripciones", "nro_cuotas", "INTEGER NOT NULL DEFAULT 1 CHECK(nro_cuotas >= 1)");
    // Cuotas y auditoría de anulación en pagos
    await ensureColumn("pagos", "cuota_nro", "INTEGER");
    await ensureColumn("pagos", "anulado_motivo", "TEXT");
    await ensureColumn("pagos", "anulado_at", "TEXT");
    await ensureColumn("pagos", "registro_estado", "TEXT NOT NULL DEFAULT 'activo'");
    await ensureColumn("pagos", "fecha_anulacion", "TEXT");
    await ensureColumn("pagos", "monto_centavos", "INTEGER");
    await ensureColumn("alumnos", "fecha_vencimiento", "TEXT");
    await ensureColumn("egresos", "monto_centavos", "INTEGER");
    await ensureColumn("egresos", "estado", "TEXT NOT NULL DEFAULT 'activo'");
    await ensureColumn("egresos", "motivo_anulacion", "TEXT");
    await ensureColumn("egresos", "fecha_anulacion", "TEXT");
    await ensureColumn("inventario_items", "precio_minimo_centavos", "INTEGER");
    await ensureColumn("inventario_movimientos", "costo_unitario_centavos", "INTEGER");
    await ensureColumn("inventario_movimientos", "precio_unitario_centavos", "INTEGER");
    await ensureColumn("inventario_movimientos", "precio_venta_centavos", "INTEGER");
    await ensureColumn("agenda_turnos", "precio_centavos", "INTEGER");

    try {
      await dbRun(`UPDATE pagos SET registro_estado = 'anulado'
        WHERE (estado = 'Anulado' OR anulado_at IS NOT NULL OR anulado_motivo IS NOT NULL)
          AND COALESCE(registro_estado,'activo') = 'activo'`);
      await dbRun(`UPDATE pagos SET registro_estado = 'activo' WHERE registro_estado IS NULL`);
      await dbRun(`UPDATE pagos SET fecha_anulacion = anulado_at WHERE fecha_anulacion IS NULL AND anulado_at IS NOT NULL`);
    } catch (e) {
      console.warn("[DB] backfill pagos.registro_estado:", e.message);
    }

    // ==== BACKFILL CENTAVOS (dinero) ====
    try {
      await dbRun(`UPDATE cursos SET precio_centavos = CAST(ROUND(precio * 100) AS INTEGER) WHERE precio_centavos IS NULL`);
    } catch (e) { console.warn("[DB] backfill cursos.precio_centavos:", e.message); }
    try {
      await dbRun(`UPDATE egresos SET monto_centavos = CAST(ROUND(monto * 100) AS INTEGER) WHERE monto_centavos IS NULL`);
    } catch (e) { console.warn("[DB] backfill egresos.monto_centavos:", e.message); }
    try {
      await dbRun(`UPDATE inventario_items SET precio_minimo_centavos = CAST(ROUND(precio_minimo * 100) AS INTEGER) WHERE precio_minimo_centavos IS NULL`);
    } catch (e) { console.warn("[DB] backfill inventario_items.precio_minimo_centavos:", e.message); }
    try {
      await dbRun(`UPDATE inventario_movimientos SET costo_unitario_centavos = CAST(ROUND(costo_unitario * 100) AS INTEGER) WHERE costo_unitario_centavos IS NULL`);
      await dbRun(`UPDATE inventario_movimientos SET precio_unitario_centavos = CAST(ROUND(precio_unitario * 100) AS INTEGER) WHERE precio_unitario_centavos IS NULL`);
      await dbRun(`UPDATE inventario_movimientos SET precio_venta_centavos = CAST(ROUND(precio_venta * 100) AS INTEGER) WHERE precio_venta_centavos IS NULL AND precio_venta IS NOT NULL`);
    } catch (e) { console.warn("[DB] backfill inventario_movimientos.*_centavos:", e.message); }
    try {
      await dbRun(`UPDATE agenda_turnos SET precio_centavos = CAST(ROUND(precio * 100) AS INTEGER) WHERE precio_centavos IS NULL`);
    } catch (e) { console.warn("[DB] backfill agenda_turnos.precio_centavos:", e.message); }

    try {
      await dbRun(`
        UPDATE alumnos SET fecha_vencimiento = (
          SELECT strftime('%Y-%m-%d', MAX(
            COALESCE(
              NULLIF(trim(c.fecha_fin), ''),
              NULLIF(trim(c.fecha_inicio), ''),
              date('now')
            )
          ))
          FROM inscripciones i
          JOIN cursos c ON c.id = i.curso_id
          WHERE i.alumno_id = alumnos.id AND i.estado = 'Activa'
        )
        WHERE (fecha_vencimiento IS NULL OR trim(fecha_vencimiento) = '')
          AND EXISTS (SELECT 1 FROM inscripciones i2 WHERE i2.alumno_id = alumnos.id AND i2.estado = 'Activa')
      `);
      await dbRun(`
        UPDATE alumnos SET fecha_vencimiento = date(COALESCE(fecha_ingreso, substr(created_at,1,10), date('now')), '+365 days')
        WHERE fecha_vencimiento IS NULL OR trim(fecha_vencimiento) = ''
      `);
    } catch (e) {
      console.warn("[DB] backfill alumnos.fecha_vencimiento:", e.message);
    }

    try {
      await dbExec(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accion TEXT NOT NULL,
        fecha TEXT NOT NULL DEFAULT (datetime('now')),
        detalle TEXT,
        actor TEXT NOT NULL DEFAULT 'admin',
        usuario TEXT NOT NULL DEFAULT 'admin'
      );`);
      await dbRun("CREATE INDEX IF NOT EXISTS ix_logs_fecha ON logs(fecha);");
    } catch (e) {
      console.warn("[DB] logs:", e.message);
    }
    await ensureColumn("logs", "usuario", "TEXT NOT NULL DEFAULT 'admin'");

    // Locks persistentes (evita locks en memoria para jobs críticos)
    try {
      await dbExec(`CREATE TABLE IF NOT EXISTS app_locks (
        name TEXT PRIMARY KEY,
        acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        owner TEXT NOT NULL
      );`);
      await dbRun("CREATE INDEX IF NOT EXISTS ix_app_locks_expires ON app_locks(expires_at);");
    } catch (e) {
      console.warn("[DB] app_locks:", e.message);
    }

    try {
      const cols = await dbAll("PRAGMA table_info(pagos);");
      const names = new Set(cols.map(c => String(c.name || "").toLowerCase()));
      if (!names.has("fecha_pago")) {
        await dbRun("ALTER TABLE pagos ADD COLUMN fecha_pago TEXT;");
        console.log("[DB] Migracion: agregado pagos.fecha_pago");
      }
      if (names.has("fecha") && names.has("fecha_pago")) {
        await dbRun(`UPDATE pagos SET fecha_pago = fecha WHERE (fecha_pago IS NULL OR fecha_pago = '') AND (fecha IS NOT NULL AND fecha <> '')`);
      }
    } catch (e) {
      console.warn("[DB] Migracion pagos warn:", e.message);
    }

    await migratePagosEstadoCobro();

    await ensureIndex(
      "ix_pagos_insc_fecha",
      "CREATE INDEX IF NOT EXISTS ix_pagos_insc_fecha ON pagos(inscripcion_id, fecha_pago);"
    );
    await ensureIndex(
      "ix_pagos_fecha_cobro",
      "CREATE INDEX IF NOT EXISTS ix_pagos_fecha_cobro ON pagos(fecha_pago, cobro_estado);"
    );
    await ensureIndex(
      "ix_pagos_insc_cobro_fecha",
      "CREATE INDEX IF NOT EXISTS ix_pagos_insc_cobro_fecha ON pagos(inscripcion_id, cobro_estado, fecha_pago);"
    );
    await ensureIndex(
      "ix_pagos_vida",
      "CREATE INDEX IF NOT EXISTS ix_pagos_vida ON pagos(estado, fecha_pago);"
    );

    // Limpieza: evitar índice duplicado de asistencia (solo si existe)
    try {
      await dbRun("DROP INDEX IF EXISTS ux_asistencia_inscripcion_fecha;");
    } catch (_) {}

    await ensureColumn("inventario_items", "precio_minimo", "REAL NOT NULL DEFAULT 0 CHECK(precio_minimo >= 0)");
    await ensureColumn("inventario_movimientos", "precio_venta", "REAL");
    await ensureColumn("inventario_movimientos", "precio_unitario", "REAL NOT NULL DEFAULT 0");

    // ==== PASO 6: CREAR inventario_prestamos SI NO EXISTE ====
    const prestamosExists = await tableExists("inventario_prestamos");
    if (!prestamosExists) {
      console.log("[DB] Creando tabla inventario_prestamos...");
      await dbExec(`CREATE TABLE IF NOT EXISTS inventario_prestamos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          instructor_id INTEGER NOT NULL,
          curso_id INTEGER,
          fecha TEXT NOT NULL DEFAULT (date('now')),
          cantidad INTEGER NOT NULL CHECK(cantidad > 0),
          nota TEXT,
          estado TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Devuelto')),
          cantidad_devuelta INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_devuelta >= 0),
          fecha_devolucion TEXT,
          mov_salida_id INTEGER,
          mov_devolucion_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (item_id) REFERENCES inventario_items(id) ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY (instructor_id) REFERENCES instructores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          FOREIGN KEY (curso_id) REFERENCES cursos(id) ON UPDATE CASCADE ON DELETE SET NULL,
          FOREIGN KEY (mov_salida_id) REFERENCES inventario_movimientos(id) ON UPDATE CASCADE ON DELETE SET NULL,
          FOREIGN KEY (mov_devolucion_id) REFERENCES inventario_movimientos(id) ON UPDATE CASCADE ON DELETE SET NULL
        )`);
      await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_item ON inventario_prestamos(item_id);");
      await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_estado ON inventario_prestamos(estado);");
      await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_instructor ON inventario_prestamos(instructor_id);");
      await dbRun("CREATE INDEX IF NOT EXISTS ix_prest_fecha ON inventario_prestamos(fecha);");
      console.log("[DB] Tabla inventario_prestamos creada");
    } else {
      console.log("[DB] Tabla inventario_prestamos ya existe");
    }

    // ==== PASO 7: schema.sql (después de migraciones; evita índices sobre columnas aún inexistentes) ====
    const schemaPath = findSchemaPath();
    if (schemaPath) {
      const schema = fs.readFileSync(schemaPath, "utf8");
      await new Promise((resolve, reject) => {
        db.exec(schema, (err) => (err ? reject(err) : resolve()));
      });
      console.log("[DB] schema aplicado/ok:", schemaPath);
    }

    // ==== PASO 8: REACTIVAR foreign_keys ====
    await dbRun("PRAGMA foreign_keys = ON;");

    console.log("[DB] Migraciones completadas");
  } catch (e) {
    console.error("[DB] Error en migraciones:", e.message);
    console.error(e.stack);
    try { await dbRun("PRAGMA foreign_keys = ON;"); } catch (_) {}
  }
}

function findSchemaPath() {
  const cands = [];
  if (process.env.SCHEMA_PATH) cands.push(process.env.SCHEMA_PATH);
  cands.push(path.join(config.ROOT_DIR, "db", "schema.sql"));
  cands.push(path.join(__dirname, "..", "db", "schema.sql"));
  for (const p of cands) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

const migrationPromise = runMigrations().catch((err) => {
  console.error("[DB] Error critico en migraciones:", err.message);
  throw err;
});

module.exports = db;
module.exports.migrationPromise = migrationPromise;
module.exports.runInTransaction = runInTransaction;
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

async function runMigrations() {
  try {
    console.log("[DB] Ejecutando migraciones...");

    // ==== PASO 1: DESACTIVAR FK para poder reparar sin interferencias ====
    await dbRun("PRAGMA foreign_keys = OFF;");

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

    // ==== PASO 7: REACTIVAR foreign_keys ya con DB limpia ====
    await dbRun("PRAGMA foreign_keys = ON;");

    console.log("[DB] Migraciones completadas");
  } catch (e) {
    console.error("[DB] Error en migraciones:", e.message);
    console.error(e.stack);
    // Reactivar FK aunque haya error
    try { await dbRun("PRAGMA foreign_keys = ON;"); } catch (_) {}
  }
}

// Ejecutar migraciones al iniciar
runMigrations().catch(err => {
  console.error("[DB] Error critico en migraciones:", err.message);
});

// schema.sql: aplicar despues de migraciones (en la misma cola de sqlite3)
function findSchemaPath() {
  const cands = [];
  if (process.env.SCHEMA_PATH) cands.push(process.env.SCHEMA_PATH);
  cands.push(path.join(config.ROOT_DIR, "db", "schema.sql"));
  cands.push(path.join(__dirname, "..", "db", "schema.sql"));
  for (const p of cands) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

try {
  const schemaPath = findSchemaPath();
  if (!schemaPath) {
    console.warn("[DB] schema.sql no encontrado");
  } else {
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema, (err) => {
      if (err) console.error("[DB] schema error:", err.message);
      else console.log("[DB] schema aplicado/ok:", schemaPath);
    });
  }
} catch (e) {
  console.error("[DB] schema init error:", e.message);
}

module.exports = db;
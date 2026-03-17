/**
 * repair-db.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de reparación de emergencia para el error:
 *   SQLITE_ERROR: no such table: main.inventario_movimientos_old
 *
 * Ejecutar UNA VEZ desde la raíz del proyecto:
 *   node tools/repair-db.js
 *
 * El script detecta y repara directamente el archivo .sqlite sin necesidad
 * de arrancar el servidor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// ── Detectar ruta de la DB (igual que config.js) ──────────────────────────
const ROOT_DIR = path.resolve(__dirname, "..");

function findDbPath() {
  // 1. Variable de entorno
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  if (process.env.SQLITE_PATH) return path.resolve(process.env.SQLITE_PATH);

  // 2. Ruta estándar del proyecto
  const local = path.join(ROOT_DIR, "db", "database.sqlite");
  if (fs.existsSync(local)) return local;

  // 3. AppData (Electron en Windows)
  const appData = process.env.APPDATA || process.env.HOME;
  if (appData) {
    const appDir = path.join(appData, "chino-barber", "db", "database.sqlite");
    if (fs.existsSync(appDir)) return appDir;
    const appDir2 = path.join(appData, "Roaming", "chino-barber", "db", "database.sqlite");
    if (fs.existsSync(appDir2)) return appDir2;
  }
  return null;
}

const DB_PATH = findDbPath();

if (!DB_PATH) {
  console.error("❌  No se encontró el archivo database.sqlite.");
  console.error("   Pasalo como argumento: node tools/repair-db.js C:\\ruta\\database.sqlite");
  process.exit(1);
}

// Si se pasa como argumento, usar ese
const TARGET = process.argv[2] ? path.resolve(process.argv[2]) : DB_PATH;

console.log("🔍  Base de datos:", TARGET);

// ── Helpers ───────────────────────────────────────────────────────────────
const db = new sqlite3.Database(TARGET, (err) => {
  if (err) { console.error("❌  No se pudo abrir la DB:", err.message); process.exit(1); }
});

function run(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function (err) { err ? rej(err) : res(this); })
  );
}
function all(sql, params = []) {
  return new Promise((res, rej) =>
    db.all(sql, params, (err, rows) => { err ? rej(err) : res(rows || []); })
  );
}
function get(sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (err, row) => { err ? rej(err) : res(row || null); })
  );
}
function exec(sql) {
  return new Promise((res, rej) =>
    db.exec(sql, (err) => { err ? rej(err) : res(); })
  );
}

// ── Reparación ────────────────────────────────────────────────────────────
async function repair() {
  let fixed = false;

  // 1. Desactivar FK para poder operar libremente
  await run("PRAGMA foreign_keys = OFF");
  console.log("✅  PRAGMA foreign_keys = OFF");

  // 2. Listar todos los triggers que mencionan inventario_movimientos_old
  const allTriggers = await all(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'`
  );
  const badTriggers = allTriggers.filter(t =>
    (t.sql || "").includes("inventario_movimientos_old") ||
    (t.tbl_name || "") === "inventario_movimientos_old"
  );

  if (badTriggers.length) {
    console.log(`\n⚠️   Se encontraron ${badTriggers.length} trigger(s) corruptos:`);
    for (const t of badTriggers) {
      console.log(`    DROP TRIGGER: ${t.name} (tabla: ${t.tbl_name})`);
      try {
        await run(`DROP TRIGGER IF EXISTS "${t.name}"`);
        console.log(`    ✅  Eliminado: ${t.name}`);
        fixed = true;
      } catch (e) {
        console.warn(`    ⚠️   No se pudo eliminar ${t.name}: ${e.message}`);
      }
    }
  } else {
    console.log("✅  No hay triggers corruptos");
  }

  // 3. Verificar si inventario_prestamos tiene FK rota a _old
  const prestRow = await get(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='inventario_prestamos'`
  );
  const prestSql = String(prestRow && prestRow.sql || "");

  if (prestSql.includes("movimientos_old")) {
    console.log("\n⚠️   inventario_prestamos tiene FK rota apuntando a _old. Reparando...");

    // Guardar datos
    let rows = [];
    try { rows = await all("SELECT * FROM inventario_prestamos"); } catch (_) {}
    console.log(`    Guardando ${rows.length} registro(s)...`);

    await run("DROP TABLE IF EXISTS inventario_prestamos");
    await run(`CREATE TABLE inventario_prestamos (
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
        await run(
          `INSERT OR IGNORE INTO inventario_prestamos
           (id,item_id,instructor_id,curso_id,fecha,cantidad,nota,estado,
            cantidad_devuelta,fecha_devolucion,mov_salida_id,mov_devolucion_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.item_id, r.instructor_id, r.curso_id, r.fecha, r.cantidad,
           r.nota, r.estado, r.cantidad_devuelta ?? 0, r.fecha_devolucion,
           r.mov_salida_id, r.mov_devolucion_id, r.created_at, r.updated_at]
        );
      } catch (_) {}
    }

    await run("CREATE INDEX IF NOT EXISTS ix_prest_item ON inventario_prestamos(item_id)");
    await run("CREATE INDEX IF NOT EXISTS ix_prest_estado ON inventario_prestamos(estado)");
    await run("CREATE INDEX IF NOT EXISTS ix_prest_instructor ON inventario_prestamos(instructor_id)");
    await run("CREATE INDEX IF NOT EXISTS ix_prest_fecha ON inventario_prestamos(fecha)");
    console.log(`    ✅  inventario_prestamos recreada con ${rows.length} registro(s)`);
    fixed = true;
  } else if (prestSql) {
    console.log("✅  inventario_prestamos FK está bien");
  } else {
    console.log("ℹ️   inventario_prestamos no existe (se creará al iniciar la app)");
  }

  // 4. Verificar si aún existe inventario_movimientos_old
  const oldExists = await get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='inventario_movimientos_old'`
  );
  if (oldExists) {
    console.log("\n⚠️   inventario_movimientos_old existe. Eliminando...");
    try {
      await run("DROP TABLE IF EXISTS inventario_movimientos_old");
      console.log("    ✅  Eliminada");
      fixed = true;
    } catch (e) {
      console.warn("    ⚠️   No se pudo eliminar:", e.message);
    }
  } else {
    console.log("✅  inventario_movimientos_old no existe");
  }

  // 5. Verificar integridad FK de inventario_movimientos
  console.log("\n🔍  Verificando integridad de FK...");
  try {
    const fkErrors = await all("PRAGMA foreign_key_check(inventario_movimientos)");
    if (fkErrors.length) {
      console.warn(`⚠️   FK errors en inventario_movimientos: ${fkErrors.length}`);
    } else {
      console.log("✅  FK de inventario_movimientos OK");
    }
  } catch (e) {
    console.warn("⚠️   No se pudo verificar FK:", e.message);
  }

  // 6. Verificar todos los triggers restantes
  const remainingTriggers = await all(
    `SELECT name, tbl_name FROM sqlite_master WHERE type='trigger'`
  );
  console.log(`\n📋  Triggers en la DB (${remainingTriggers.length} total):`);
  remainingTriggers.forEach(t => console.log(`    - ${t.name} (en tabla: ${t.tbl_name})`));

  // 7. Reactivar FK
  await run("PRAGMA foreign_keys = ON");
  console.log("\n✅  PRAGMA foreign_keys = ON");

  if (fixed) {
    console.log("\n🎉  REPARACIÓN COMPLETADA. Podés iniciar la app normalmente.");
  } else {
    console.log("\nℹ️   No se encontraron problemas conocidos en la DB.");
    console.log("    Si el error persiste, enviá el output completo para diagnóstico.");
  }

  db.close();
}

repair().catch(err => {
  console.error("\n❌  Error durante la reparación:", err.message);
  console.error(err.stack);
  db.close();
  process.exit(1);
});

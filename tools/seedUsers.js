const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "..", "src", "db", "database.sqlite");
const db = new sqlite3.Database(dbPath);

async function run() {
  const adminHash = await bcrypt.hash("123456", 10);
  const cajaHash = await bcrypt.hash("123456", 10);

  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");

    db.run(
      "INSERT OR IGNORE INTO usuarios (usuario, pass_hash, rol) VALUES (?,?,?)",
      ["admin", adminHash, "Admin"]
    );

    db.run(
      "INSERT OR IGNORE INTO usuarios (usuario, pass_hash, rol) VALUES (?,?,?)",
      ["caja", cajaHash, "Caja"]
    );

    db.close(() => console.log("OK: usuarios seed (admin/caja = 123456)"));
  });
}

run().catch(e => { console.error(e); process.exit(1); });

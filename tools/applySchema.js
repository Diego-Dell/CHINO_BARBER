const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "..", "src", "db", "database.sqlite");
const schemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");

const schema = fs.readFileSync(schemaPath, "utf8");
const db = new sqlite3.Database(dbPath);

db.exec("PRAGMA foreign_keys = ON;", (e) => {
  if (e) { console.error(e); process.exit(1); }

  db.exec(schema, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log("OK: schema aplicado");
    db.close();
  });
});

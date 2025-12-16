// =============================================
// CHINO_BARBER - Server Principal
// Develop by Diego Dell
// =============================================

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// DB
// ==============================
const DB_PATH = path.join(__dirname, "db", "database.sqlite");
const db = new sqlite3.Database(DB_PATH);

// ==============================
// Middlewares base
// ==============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "CHINO_BARBER_SESSION",
    secret: process.env.SESSION_SECRET || "CHINO_BARBER_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

// ==============================
// Helpers
// ==============================
function authRequired(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.session.user || req.session.user.rol !== "Admin") {
    return res.status(403).send("Acceso denegado");
  }
  next();
}

// ==============================
// BLOQUEO SUAVE (antitamper)
// ==============================
let SISTEMA_BLOQUEADO = false; // luego se conectará con licencia

app.use((req, res, next) => {
  if (SISTEMA_BLOQUEADO && !req.path.startsWith("/login")) {
    return res.send(`
      <html>
        <head><title>Sistema bloqueado</title></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:80px">
          <h2>Sistema bloqueado por manipulación</h2>
          <p>Contacte al desarrollador</p>
          <p><b>Diego Dell</b></p>
          <p>WhatsApp: +59173613759</p>
        </body>
      </html>
    `);
  }
  next();
});

// ==============================
// LOGIN
// ==============================
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  db.get(
    "SELECT * FROM usuarios WHERE usuario=? AND estado='Activo'",
    [usuario],
    async (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.status(401).json({ error: "Credenciales incorrectas" });

      const ok = await bcrypt.compare(password, row.pass_hash);
      if (!ok) return res.status(401).json({ error: "Credenciales incorrectas" });

      req.session.user = {
        id: row.id,
        usuario: row.usuario,
        rol: row.rol,
      };

      res.json({ ok: true, rol: row.rol });
    }
  );
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ==============================
// INFO SESION
// ==============================
app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ logged: false });
  res.json({ logged: true, user: req.session.user });
});

app.get("/home", authRequired, (req, res) => {
  const rol = req.session.user?.rol;

  if (rol === "Admin") return res.redirect("/index.html");
  return res.redirect("/pagos.html");
});


// ==============================
// EJEMPLO RUTA PROTEGIDA
// ==============================
app.get("/api/reportes", authRequired, adminOnly, (req, res) => {
  res.json({ ok: true, data: [] });
});

// ==============================
// FRONTEND
// ==============================
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.get("/__debug_public", (req, res) => {
  res.json({
    PUBLIC_DIR,
    loginExists: require("fs").existsSync(path.join(PUBLIC_DIR, "login.html"))
  });
});

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});




// ==============================
// START
// ==============================
app.get("/__ping", (req, res) => res.send("OK CHINO_BARBER"));
app.listen(PORT, () => {
  console.log(`✅ Barber Chino corriendo en http://localhost:${PORT}`);
});

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/home");
  return res.redirect("/login.html");
});


// ==============================
// API: ALUMNOS (CRUD real)
// ==============================
app.get("/api/alumnos", authRequired, (req, res) => {
  db.all("SELECT * FROM alumnos ORDER BY nombre ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/alumnos/search", authRequired, (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return db.all("SELECT * FROM alumnos ORDER BY nombre ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  }

  const like = `%${q}%`;
  db.all(
    "SELECT * FROM alumnos WHERE nombre LIKE ? OR documento LIKE ? ORDER BY nombre ASC",
    [like, like],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.post("/api/alumnos", authRequired, (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();

  if (!nombre || !documento) {
    return res.status(400).json({ error: "Nombre y documento son obligatorios" });
  }

  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const fecha_ingreso = b.fecha_ingreso ? String(b.fecha_ingreso).trim() : new Date().toISOString().slice(0, 10);
  const estado = String(b.estado || "Activo").trim();

  const sql = `
    INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [nombre, documento, telefono, email, fecha_ingreso, estado], function (err) {
    if (err) {
      // Documento único
      if (String(err.message || "").includes("UNIQUE")) {
        return res.status(409).json({ error: "Ya existe un alumno con ese documento" });
      }
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ ok: true, id: this.lastID });
  });
});

app.put("/api/alumnos/:id", authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();

  if (!nombre || !documento) {
    return res.status(400).json({ error: "Nombre y documento son obligatorios" });
  }

  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const fecha_ingreso = b.fecha_ingreso ? String(b.fecha_ingreso).trim() : null;
  const estado = String(b.estado || "Activo").trim();

  const sql = `
    UPDATE alumnos
    SET nombre=?,
        documento=?,
        telefono=?,
        email=?,
        fecha_ingreso=COALESCE(?, fecha_ingreso),
        estado=?,
        updated_at=datetime('now')
    WHERE id=?
  `;

  db.run(sql, [nombre, documento, telefono, email, fecha_ingreso, estado, id], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) {
        return res.status(409).json({ error: "Ya existe otro alumno con ese documento" });
      }
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ error: "Alumno no encontrado" });
    res.json({ ok: true });
  });
});

// (Opcional) eliminar alumno (solo Admin)
app.delete("/api/alumnos/:id", authRequired, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  db.run("DELETE FROM alumnos WHERE id=?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Alumno no encontrado" });
    res.json({ ok: true });
  });
});

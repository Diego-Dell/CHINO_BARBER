// =============================================
// CHINO_BARBER - Server Principal
// Develop by Diego Dell
// =============================================

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// DB
// ==============================
const DB_PATH = path.join(__dirname, "db", "database.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
  if (!req.session.user) return res.status(401).json({ error: "No autenticado" });
  next();
}

function adminOnly(req, res, next) {
  if (!req.session.user || req.session.user.rol !== "Admin") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  next();
}

// ==============================
// BLOQUEO SUAVE (antitamper)
// ==============================
let SISTEMA_BLOQUEADO = false; // luego lo conectas con licencia

app.use((req, res, next) => {
  if (SISTEMA_BLOQUEADO && !req.path.startsWith("/login") && !req.path.startsWith("/api/login")) {
    return res.status(423).send(`
      <html>
        <head><title>Sistema bloqueado</title></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:80px">
          <h2>Sistema bloqueado por manipulación</h2>
          <p>Contacte al desarrollador</p>
          <p><b>${process.env.SUPPORT_NAME || "Diego Dell"}</b></p>
          <p>WhatsApp: ${process.env.SUPPORT_WHATSAPP || "+59173613759"}</p>
        </body>
      </html>
    `);
  }
  next();
});

// PROTEGER HTML (excepto login/activate/assets/css/js)
app.use((req, res, next) => {
  const p = req.path;

  // permitir recursos públicos
  if (
    p === "/" ||
    p === "/login.html" ||
    p === "/activate.html" ||
    p.startsWith("/css/") ||
    p.startsWith("/js/") ||
    p.startsWith("/assets/") ||
    p.startsWith("/api/login") ||
    p.startsWith("/api/logout") ||
    p.startsWith("/api/session")
  ) return next();

  // bloquear cualquier .html si no hay sesión
  if (p.endsWith(".html") && !req.session.user) {
    return res.redirect("/login.html");
  }

  next();
});



// ==============================
// FRONTEND STATIC
// ==============================
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

// raíz
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/home");
  return res.redirect("/login.html");
});

// home según rol
app.get("/home", (req, res) => {
  const rol = req.session.user?.rol;
  if (!rol) return res.redirect("/login.html");

  if (rol === "Admin") return res.redirect("/index.html");
  return res.redirect("/pagos.html"); // Caja
});

// debug
app.get("/__ping", (req, res) => res.send("OK CHINO_BARBER"));
app.get("/__debug_public", (req, res) => {
  res.json({
    PUBLIC_DIR,
    loginExists: fs.existsSync(path.join(PUBLIC_DIR, "login.html")),
  });
});

// ==============================
// LOGIN / SESSION
// ==============================
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: "Datos incompletos" });

  db.get(
    "SELECT * FROM usuarios WHERE usuario=? AND estado='Activo'",
    [String(usuario).trim()],
    async (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.status(401).json({ error: "Credenciales incorrectas" });

      const ok = await bcrypt.compare(password, row.pass_hash);
      if (!ok) return res.status(401).json({ error: "Credenciales incorrectas" });

      req.session.user = { id: row.id, usuario: row.usuario, rol: row.rol };
      res.json({ ok: true, rol: row.rol });
    }
  );
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ logged: false });
  res.json({ logged: true, user: req.session.user });
});

// ==============================
// API: INSTRUCTORES
// ==============================
app.get("/api/instructores", authRequired, (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();

  const where = [];
  const params = [];

  if (q) {
    where.push("(nombre LIKE ? OR documento LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }
  if (estado) {
    where.push("estado = ?");
    params.push(estado);
  }

  const sql = `
    SELECT * FROM instructores
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY nombre ASC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/instructores", authRequired, adminOnly, (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const especialidad = String(b.especialidad || "").trim();
  const estado = String(b.estado || "Activo").trim();
  const fecha_alta = b.fecha_alta ? String(b.fecha_alta).trim() : new Date().toISOString().slice(0, 10);

  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });

  const sql = `
    INSERT INTO instructores (nombre, documento, telefono, email, especialidad, fecha_alta, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [nombre, documento, telefono, email, especialidad, fecha_alta, estado], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Documento duplicado" });
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ ok: true, id: this.lastID });
  });
});

app.put("/api/instructores/:id", authRequired, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  const documento = String(b.documento || "").trim();
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const especialidad = String(b.especialidad || "").trim();
  const estado = String(b.estado || "Activo").trim();

  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });

  const sql = `
    UPDATE instructores
    SET nombre=?, documento=?, telefono=?, email=?, especialidad=?, estado=?
    WHERE id=?
  `;
  db.run(sql, [nombre, documento, telefono, email, especialidad, estado, id], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Documento duplicado" });
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ error: "Instructor no encontrado" });
    res.json({ ok: true });
  });
});

// ==============================
// API: ALUMNOS
// ==============================
app.get("/api/alumnos", authRequired, (req, res) => {
  db.all("SELECT * FROM alumnos ORDER BY nombre ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/alumnos/search", authRequired, (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);

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
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const fecha_ingreso = b.fecha_ingreso ? String(b.fecha_ingreso).trim() : new Date().toISOString().slice(0, 10);
  const estado = String(b.estado || "Activo").trim();

  if (!nombre || !documento) return res.status(400).json({ error: "Nombre y documento son obligatorios" });

  const sql = `
    INSERT INTO alumnos (nombre, documento, telefono, email, fecha_ingreso, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [nombre, documento, telefono, email, fecha_ingreso, estado], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Documento duplicado" });
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
  const telefono = String(b.telefono || "").trim();
  const email = String(b.email || "").trim();
  const fecha_ingreso = b.fecha_ingreso ? String(b.fecha_ingreso).trim() : null;
  const estado = String(b.estado || "Activo").trim();

  if (!nombre || !documento) return res.status(400).json({ error: "Nombre y documento son obligatorios" });

  const sql = `
    UPDATE alumnos
    SET nombre=?,
        documento=?,
        telefono=?,
        email=?,
        fecha_ingreso=COALESCE(?, fecha_ingreso),
        estado=?
    WHERE id=?
  `;
  db.run(sql, [nombre, documento, telefono, email, fecha_ingreso, estado, id], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Documento duplicado" });
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ error: "Alumno no encontrado" });
    res.json({ ok: true });
  });
});

// ==============================
// API: CURSOS (con inscritos + instructor_nombre)
// ==============================
app.get("/api/cursos", authRequired, (req, res) => {
  const q = String(req.query.q || "").trim();
  const estado = String(req.query.estado || "").trim();

  const where = [];
  const params = [];

  if (q) {
    where.push("c.nombre LIKE ?");
    params.push(`%${q}%`);
  }
  if (estado) {
    where.push("c.estado = ?");
    params.push(estado);
  }

  const sql = `
    SELECT
      c.*,
      COALESCE(i.nombre,'') AS instructor_nombre,
      (SELECT COUNT(*) FROM inscripciones x WHERE x.curso_id=c.id AND x.estado='Activa') AS inscritos
    FROM cursos c
    LEFT JOIN instructores i ON i.id = c.instructor_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY c.id DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/cursos", authRequired, adminOnly, (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });

  const instructor_id = b.instructor_id ? Number(b.instructor_id) : null;
  const fecha_inicio = b.fecha_inicio ? String(b.fecha_inicio).trim() : null;
  const nro_clases = b.nro_clases ? Number(b.nro_clases) : null;
  const dias = String(b.dias || "").trim();
  const horario_por_dia = String(b.horario_por_dia || "").trim();
  const precio = Number(b.precio || 0);
  const cupo = b.cupo ? Number(b.cupo) : null;
  const estado = String(b.estado || "Programado").trim();

  const sql = `
    INSERT INTO cursos
      (nombre, instructor_id, fecha_inicio, nro_clases, dias, horario_por_dia, precio, cupo, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [nombre, instructor_id, fecha_inicio, nro_clases, dias, horario_por_dia, precio, cupo, estado],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID });
    }
  );
});

app.put("/api/cursos/:id", authRequired, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  const b = req.body || {};
  const nombre = String(b.nombre || "").trim();
  if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });

  const instructor_id = b.instructor_id ? Number(b.instructor_id) : null;
  const fecha_inicio = b.fecha_inicio ? String(b.fecha_inicio).trim() : null;
  const nro_clases = b.nro_clases ? Number(b.nro_clases) : null;
  const dias = String(b.dias || "").trim();
  const horario_por_dia = String(b.horario_por_dia || "").trim();
  const precio = Number(b.precio || 0);
  const cupo = b.cupo ? Number(b.cupo) : null;
  const estado = String(b.estado || "Programado").trim();

  const sql = `
    UPDATE cursos
    SET nombre=?,
        instructor_id=?,
        fecha_inicio=?,
        nro_clases=?,
        dias=?,
        horario_por_dia=?,
        precio=?,
        cupo=?,
        estado=?
    WHERE id=?
  `;

  db.run(
    sql,
    [nombre, instructor_id, fecha_inicio, nro_clases, dias, horario_por_dia, precio, cupo, estado, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Curso no encontrado" });
      res.json({ ok: true });
    }
  );
});

// ==============================
// API: INSCRIPCIONES
// ==============================
app.get("/api/inscripciones", authRequired, (req, res) => {
  const curso_id = Number(req.query.curso_id || 0);
  const estado = String(req.query.estado || "").trim();
  const q = String(req.query.q || "").trim();

  if (!curso_id) return res.status(400).json({ error: "curso_id es obligatorio" });

  const where = ["i.curso_id = ?"];
  const params = [curso_id];

  if (estado) {
    where.push("i.estado = ?");
    params.push(estado);
  }

  if (q) {
    where.push("(a.nombre LIKE ? OR a.documento LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }

  const sql = `
    SELECT
      i.id AS inscripcion_id,
      i.alumno_id,
      i.curso_id,
      i.fecha_inscripcion,
      i.estado AS estado_inscripcion,
      a.nombre AS alumno_nombre,
      a.documento AS alumno_documento,
      a.telefono AS alumno_telefono,
      a.email AS alumno_email
    FROM inscripciones i
    JOIN alumnos a ON a.id = i.alumno_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.nombre ASC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/inscripciones", authRequired, adminOnly, (req, res) => {
  const { alumno_id, curso_id, estado } = req.body || {};
  if (!alumno_id || !curso_id) return res.status(400).json({ error: "alumno_id y curso_id son obligatorios" });

  const sql = `
    INSERT INTO inscripciones (alumno_id, curso_id, estado)
    VALUES (?, ?, ?)
  `;

  db.run(sql, [Number(alumno_id), Number(curso_id), String(estado || "Activa")], function (err) {
    if (err) {
      if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Ya inscrito en este curso" });
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ ok: true, id: this.lastID });
  });
});

// ==============================
// API: ASISTENCIA (bulk con UPSERT)
// ==============================
app.post("/api/asistencia/bulk", authRequired, adminOnly, (req, res) => {
  const { fecha, curso_id, registros } = req.body || {};

  if (!fecha || !curso_id || !Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: "fecha, curso_id y registros son obligatorios" });
  }

  const clean = registros
    .map(r => ({
      inscripcion_id: Number(r.inscripcion_id),
      estado: String(r.estado || "").trim(),
      observacion: String(r.observacion || "").trim()
    }))
    .filter(r => r.inscripcion_id > 0 && r.estado);

  if (!clean.length) return res.status(400).json({ error: "registros inválidos" });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmt = db.prepare(`
      INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(inscripcion_id, fecha)
      DO UPDATE SET estado=excluded.estado, observacion=excluded.observacion
    `);

    let failed = null;

    for (const r of clean) {
      stmt.run([r.inscripcion_id, fecha, r.estado, r.observacion], (err) => {
        if (err && !failed) failed = err;
      });
    }

    stmt.finalize((errFinal) => {
      if (failed || errFinal) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: (failed || errFinal).message });
      }

      db.run("COMMIT", (errCommit) => {
        if (errCommit) return res.status(500).json({ error: errCommit.message });
        res.json({ ok: true, fecha, total: clean.length });
      });
    });
  });
});




// ==============================
// Reportes (ejemplo protegido)
// ==============================
app.get("/api/reportes", authRequired, adminOnly, (req, res) => {
  res.json({ ok: true, data: [] });
});

// ==============================
// START
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Barber Chino corriendo en http://localhost:${PORT}`);
});



app.get("/api/dashboard", authRequired, (req, res) => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM alumnos) AS alumnos,
      (SELECT COUNT(*) FROM instructores) AS instructores,
      (SELECT COUNT(*) FROM cursos) AS cursos,
      (SELECT COUNT(*) FROM inscripciones WHERE estado='Activa') AS inscripciones_activas
  `;

  db.get(sql, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

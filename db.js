const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database", "barber_school.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // ALUMNOS
  db.run(`CREATE TABLE IF NOT EXISTS alumnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    documento TEXT NOT NULL UNIQUE,
    telefono TEXT,
    email TEXT,
    fecha_ingreso TEXT,
    estado TEXT DEFAULT 'Activo'
  )`);

  // INSTRUCTORES
  db.run(`CREATE TABLE IF NOT EXISTS instructores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    especialidad TEXT,
    telefono TEXT,
    email TEXT,
    estado TEXT DEFAULT 'Activo'
  )`);

  // CURSOS
  db.run(`CREATE TABLE IF NOT EXISTS cursos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    nivel TEXT,
    nro_clases INTEGER,
    dias TEXT,
    horario_por_dia TEXT,
    precio REAL,
    cupo INTEGER,
    instructor_id INTEGER,
    estado TEXT,
    FOREIGN KEY(instructor_id) REFERENCES instructores(id)
  )`);

  // PAGOS
  db.run(`CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alumno_id INTEGER NOT NULL,
    curso_id INTEGER,
    fecha TEXT,
    monto REAL NOT NULL,
    estado TEXT,
    observaciones TEXT,
    FOREIGN KEY(alumno_id) REFERENCES alumnos(id),
    FOREIGN KEY(curso_id) REFERENCES cursos(id)
  )`);

  // ASISTENCIA
  db.run(`CREATE TABLE IF NOT EXISTS asistencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    curso_id INTEGER,
    alumno_id INTEGER,
    fecha TEXT,
    presente INTEGER,
    FOREIGN KEY(curso_id) REFERENCES cursos(id),
    FOREIGN KEY(alumno_id) REFERENCES alumnos(id)
  )`);

  // INVENTARIO
  db.run(`CREATE TABLE IF NOT EXISTS inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto TEXT,
    cantidad INTEGER,
    responsable TEXT,
    curso TEXT,
    fecha TEXT
  )`);
});

module.exports = db;

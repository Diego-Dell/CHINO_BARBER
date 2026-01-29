PRAGMA foreign_keys = ON;

-- =========================
-- SETTINGS (Sistema / Marca / Soporte)
-- =========================
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

INSERT OR IGNORE INTO settings (k,v) VALUES ('barber_name','Barber Chino');
INSERT OR IGNORE INTO settings (k,v) VALUES ('app_version','1.0.0');
INSERT OR IGNORE INTO settings (k,v) VALUES ('support_name','Diego Dell');
INSERT OR IGNORE INTO settings (k,v) VALUES ('support_whatsapp','+59173613759');

-- =========================
-- USUARIOS (Login / Roles)
-- =========================
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK(rol IN ('Admin','Caja')),
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo','Inactivo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================
-- ALUMNOS
-- =========================
CREATE TABLE IF NOT EXISTS alumnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  fecha_ingreso TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo','Inactivo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_documento ON alumnos(documento);
CREATE INDEX IF NOT EXISTS ix_alumnos_nombre ON alumnos(nombre);
CREATE INDEX IF NOT EXISTS ix_alumnos_estado ON alumnos(estado);

-- =========================
-- INSTRUCTORES
-- =========================
CREATE TABLE IF NOT EXISTS instructores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  especialidad TEXT,
  fecha_alta TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo','Inactivo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_instructores_documento ON instructores(documento);
CREATE INDEX IF NOT EXISTS ix_instructores_nombre ON instructores(nombre);
CREATE INDEX IF NOT EXISTS ix_instructores_estado ON instructores(estado);

-- =========================
-- CURSOS
-- =========================
CREATE TABLE IF NOT EXISTS cursos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  nivel TEXT,
  nro_clases INTEGER NOT NULL DEFAULT 0 CHECK(nro_clases >= 0),
  dias TEXT,
  horario_por_dia TEXT,
  precio REAL NOT NULL DEFAULT 0 CHECK(precio >= 0),
  cupo INTEGER NOT NULL DEFAULT 0 CHECK(cupo >= 0),
  estado TEXT NOT NULL DEFAULT 'Programado'
    CHECK(estado IN ('Programado','En curso','Finalizado','Cancelado')),
  instructor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instructor_id)
    REFERENCES instructores(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_cursos_nombre ON cursos(nombre);
CREATE INDEX IF NOT EXISTS ix_cursos_estado ON cursos(estado);
CREATE INDEX IF NOT EXISTS ix_cursos_instructor ON cursos(instructor_id);

-- =========================
-- INSCRIPCIONES
-- =========================
CREATE TABLE IF NOT EXISTS inscripciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alumno_id INTEGER NOT NULL,
  curso_id INTEGER NOT NULL,
  fecha_inscripcion TEXT NOT NULL DEFAULT (date('now')),
  estado TEXT NOT NULL DEFAULT 'Activa'
    CHECK(estado IN ('Activa','Finalizada','Cancelada')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (alumno_id)
    REFERENCES alumnos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (curso_id)
    REFERENCES cursos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_insc_activa
ON inscripciones(alumno_id, curso_id)
WHERE estado='Activa';

CREATE INDEX IF NOT EXISTS ix_insc_alumno ON inscripciones(alumno_id);
CREATE INDEX IF NOT EXISTS ix_insc_curso ON inscripciones(curso_id);
CREATE INDEX IF NOT EXISTS ix_insc_estado ON inscripciones(estado);

-- =========================
-- ASISTENCIA
-- =========================
CREATE TABLE IF NOT EXISTS asistencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inscripcion_id INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  estado TEXT NOT NULL DEFAULT 'Asistio'
    CHECK(estado IN ('Asistio','Falto','Justificado')),
  observacion TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inscripcion_id)
    REFERENCES inscripciones(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asistencia_fecha
ON asistencia(inscripcion_id, fecha);

CREATE INDEX IF NOT EXISTS ix_asistencia_estado ON asistencia(estado);
CREATE INDEX IF NOT EXISTS ix_asistencia_fecha ON asistencia(fecha);

-- =========================
-- PAGOS
-- =========================
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inscripcion_id INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  monto REAL NOT NULL CHECK(monto >= 0),
  estado TEXT NOT NULL DEFAULT 'Pagado'
    CHECK(estado IN ('Pagado','Pendiente','Anulado')),
  metodo TEXT NOT NULL DEFAULT 'Efectivo'
    CHECK(metodo IN ('Efectivo','Transferencia','QR','Tarjeta','Otro')),
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inscripcion_id)
    REFERENCES inscripciones(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);



CREATE INDEX IF NOT EXISTS ix_pagos_inscripcion ON pagos(inscripcion_id);
CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON pagos(fecha);
CREATE INDEX IF NOT EXISTS ix_pagos_estado ON pagos(estado);

-- =========================
-- EGRESOS
-- =========================
CREATE TABLE IF NOT EXISTS egresos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  categoria TEXT NOT NULL,
  detalle TEXT,
  monto REAL NOT NULL CHECK(monto >= 0),
  comprobante TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_egresos_fecha ON egresos(fecha);
CREATE INDEX IF NOT EXISTS ix_egresos_categoria ON egresos(categoria);

-- =========================
-- INVENTARIO ITEMS
-- =========================
CREATE TABLE IF NOT EXISTS inventario_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto TEXT NOT NULL,
  categoria TEXT,
  unidad TEXT,
  stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK(stock_minimo >= 0),
  estado TEXT NOT NULL DEFAULT 'Activo'
    CHECK(estado IN ('Activo','Inactivo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_items_producto ON inventario_items(producto);
CREATE INDEX IF NOT EXISTS ix_items_categoria ON inventario_items(categoria);
CREATE INDEX IF NOT EXISTS ix_items_estado ON inventario_items(estado);

-- =========================
-- INVENTARIO MOVIMIENTOS
-- =========================
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  tipo TEXT NOT NULL CHECK(tipo IN ('Ingreso','Salida','Ajuste')),
  cantidad INTEGER NOT NULL CHECK(cantidad <> 0),
  costo_unitario REAL NOT NULL DEFAULT 0 CHECK(costo_unitario >= 0),
  motivo TEXT,
  curso_id INTEGER,
  instructor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id)
    REFERENCES inventario_items(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (curso_id)
    REFERENCES cursos(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  FOREIGN KEY (instructor_id)
    REFERENCES instructores(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_mov_item ON inventario_movimientos(item_id);
CREATE INDEX IF NOT EXISTS ix_mov_fecha ON inventario_movimientos(fecha);
CREATE INDEX IF NOT EXISTS ix_mov_tipo ON inventario_movimientos(tipo);

-- =========================
-- AGENDA / TURNOS
-- =========================
CREATE TABLE IF NOT EXISTS agenda_turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  hora TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Cita'
    CHECK(tipo IN ('Cita','Clase','Evento','Otro')),
  cliente_nombre TEXT,
  cliente_telefono TEXT,
  alumno_id INTEGER,
  instructor_id INTEGER,
  servicio TEXT,
  precio REAL NOT NULL DEFAULT 0 CHECK(precio >= 0),
  estado TEXT NOT NULL DEFAULT 'Programado'
    CHECK(estado IN ('Programado','Confirmado','Atendido','Cancelado','No asistio')),
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (alumno_id)
    REFERENCES alumnos(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  FOREIGN KEY (instructor_id)
    REFERENCES instructores(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_turnos_fecha ON agenda_turnos(fecha);
CREATE INDEX IF NOT EXISTS ix_turnos_estado ON agenda_turnos(estado);
CREATE INDEX IF NOT EXISTS ix_turnos_instructor ON agenda_turnos(instructor_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asistencia_inscripcion_fecha
ON asistencia(inscripcion_id, fecha);

ALTER TABLE cursos ADD COLUMN fecha_inicio TEXT;

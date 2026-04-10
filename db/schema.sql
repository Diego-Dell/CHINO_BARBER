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
  -- LEGADO (no usado por negocio): el estado real se calcula por fecha_vencimiento vs “hoy Bolivia”
  -- Se conserva por compatibilidad con DBs existentes, pero no debe usarse como fuente de verdad.
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo','Inactivo')),
  -- Fuente de verdad de vigencia (YYYY-MM-DD): activo si fecha_vencimiento >= hoy(Bolivia UTC-4)
  fecha_vencimiento TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_documento ON alumnos(documento);
CREATE INDEX IF NOT EXISTS ix_alumnos_nombre ON alumnos(nombre);
-- Índice legado removido: no consultar por alumnos.estado en negocio
-- CREATE INDEX IF NOT EXISTS ix_alumnos_estado ON alumnos(estado);

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
  fecha_inicio TEXT,
fecha_fin TEXT,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  nivel TEXT,
  nro_clases INTEGER NOT NULL DEFAULT 0 CHECK(nro_clases >= 0),
  dias TEXT,
  horario_por_dia TEXT,
  -- Dinero: centavos como fuente de verdad (REAL se conserva por compatibilidad/UI legacy)
  precio_centavos INTEGER,
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
  nro_cuotas INTEGER NOT NULL DEFAULT 1 CHECK(nro_cuotas >= 1),
  estado TEXT NOT NULL DEFAULT 'Activa'
    CHECK(estado IN ('Activa','Finalizada','Cancelada')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (alumno_id)
    REFERENCES alumnos(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  FOREIGN KEY (curso_id)
    REFERENCES cursos(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
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
  fecha_pago TEXT NOT NULL DEFAULT (date('now')),
  monto_centavos INTEGER,
  monto REAL NOT NULL CHECK(monto >= 0),
  cuota_nro INTEGER,
  estado TEXT NOT NULL DEFAULT 'activo'
    CHECK(estado IN ('activo','anulado')),
  cobro_estado TEXT NOT NULL DEFAULT 'Pagado'
    CHECK(cobro_estado IN ('Pagado','Pendiente')),
  metodo TEXT NOT NULL DEFAULT 'Efectivo'
    CHECK(metodo IN ('Efectivo','Transferencia','QR','Tarjeta','Otro')),
  observaciones TEXT,
  motivo_anulacion TEXT,
  fecha_anulacion TEXT,
  -- LEGADO: compat con DBs antiguas (no usar en flujo vigente)
  anulado_motivo TEXT,
  anulado_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inscripcion_id) REFERENCES inscripciones(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);


CREATE INDEX IF NOT EXISTS ix_pagos_inscripcion ON pagos(inscripcion_id);
DROP INDEX IF EXISTS ix_pagos_fecha;
CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON pagos(fecha_pago);
-- Índices adicionales de pagos (estado/cobro_estado) los crea src/db.js tras migrar columnas.

-- =========================
-- EGRESOS
-- =========================
CREATE TABLE IF NOT EXISTS egresos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  categoria TEXT NOT NULL,
  detalle TEXT,
  monto_centavos INTEGER,
  monto REAL NOT NULL CHECK(monto >= 0),
  comprobante TEXT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','anulado')),
  motivo_anulacion TEXT,
  fecha_anulacion TEXT,
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
  precio_minimo_centavos INTEGER,
  precio_minimo REAL NOT NULL DEFAULT 0 CHECK(precio_minimo >= 0),
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
  tipo TEXT NOT NULL CHECK(tipo IN ('Ingreso','Salida','Ajuste','Prestamo','Devolucion','Venta')),
  cantidad INTEGER NOT NULL CHECK(cantidad <> 0),
  costo_unitario_centavos INTEGER,
  precio_unitario_centavos INTEGER,
  precio_venta_centavos INTEGER,
  costo_unitario REAL NOT NULL DEFAULT 0 CHECK(costo_unitario >= 0),
  precio_unitario REAL NOT NULL DEFAULT 0 CHECK(precio_unitario >= 0),
  precio_venta REAL,
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
  precio_centavos INTEGER,
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

-- =========================
-- INVENTARIO PRESTAMOS
-- =========================
CREATE TABLE IF NOT EXISTS inventario_prestamos (
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
);

CREATE INDEX IF NOT EXISTS ix_prest_item ON inventario_prestamos(item_id);
CREATE INDEX IF NOT EXISTS ix_prest_estado ON inventario_prestamos(estado);
CREATE INDEX IF NOT EXISTS ix_prest_instructor ON inventario_prestamos(instructor_id);
CREATE INDEX IF NOT EXISTS ix_prest_fecha ON inventario_prestamos(fecha);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asistencia_inscripcion_fecha
ON asistencia(inscripcion_id, fecha);

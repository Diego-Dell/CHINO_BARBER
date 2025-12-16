// ===============================
// INSCRIPCIONES (por curso) + filtro
// GET /api/inscripciones?curso_id=1&estado=Activa&q=juan
// ===============================
app.get("/api/inscripciones", (req, res) => {
  const curso_id = Number(req.query.curso_id);
  const estado = (req.query.estado || "").trim();  // ejemplo: "Activa"
  const q = (req.query.q || "").trim();

  if (!curso_id) return res.status(400).json({ error: "curso_id es obligatorio" });

  const where = ["i.curso_id = ?"];
  const params = [curso_id];

  if (estado) { where.push("i.estado = ?"); params.push(estado); }

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
    res.json(rows);
  });
});


// ===============================
// ASISTENCIA BULK
// POST /api/asistencia/bulk
// body: { fecha, curso_id, registros:[{inscripcion_id, estado, observacion}] }
// ===============================
app.post("/api/asistencia/bulk", (req, res) => {
  const { fecha, curso_id, registros } = req.body || {};

  if (!fecha || !curso_id || !Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: "fecha, curso_id y registros son obligatorios" });
  }

  // Validación rápida
  const clean = registros
    .map(r => ({
      inscripcion_id: Number(r.inscripcion_id),
      estado: String(r.estado || "").trim(),
      observacion: String(r.observacion || "").trim()
    }))
    .filter(r => r.inscripcion_id > 0 && r.estado);

  if (!clean.length) {
    return res.status(400).json({ error: "registros inválidos" });
  }

  // Usamos transacción para que sea rápido y seguro
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmt = db.prepare(`
      INSERT INTO asistencia (inscripcion_id, fecha, estado, observacion)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(inscripcion_id, fecha)
      DO UPDATE SET
        estado = excluded.estado,
        observacion = excluded.observacion
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

// POST /api/inscripciones
// body: { alumno_id, curso_id, estado }
app.post("/api/inscripciones", (req, res) => {
  const { alumno_id, curso_id, estado } = req.body || {};
  if (!alumno_id || !curso_id) {
    return res.status(400).json({ error: "alumno_id y curso_id son obligatorios" });
  }

  const sql = `
    INSERT INTO inscripciones (alumno_id, curso_id, estado)
    VALUES (?, ?, ?)
  `;
  const params = [Number(alumno_id), Number(curso_id), estado || "Activa"];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID });
  });
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chino_barber_test_"));
}

function waitForLine(proc, predicate, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for server")), timeoutMs);
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const line of lines) {
        const v = predicate(line);
        if (v) {
          clearTimeout(t);
          resolve(v);
          return;
        }
      }
    });
    proc.stderr.on("data", () => {});
  });
}

async function httpJson(baseUrl, method, urlPath, body) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) {}
  return { status: res.status, json, text: txt };
}

async function startServer({ dbPath, backupDir }) {
  const serverJs = path.resolve(__dirname, "..", "services", "server.js");
  const proc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      DB_PATH: dbPath,
      BACKUP_DIR: backupDir,
      ALLOW_MISSING_MODULES: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await waitForLine(proc, (line) => {
    const m = line.match(/Running on http:\/\/127\.0\.0\.1:(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    proc,
    baseUrl,
    async stop() {
      try { proc.kill(); } catch (_) {}
    },
  };
}

test("regresión: pagos (crear, duplicado, anular, resumen) + alumno activo/inactivo + dashboard-v2", async (t) => {
  const dir = mkTempDir();
  const dbPath = path.join(dir, "database.sqlite");
  const backupDir = path.join(dir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const srv = await startServer({ dbPath, backupDir });
  t.after(async () => srv.stop());

  // health
  {
    const r = await httpJson(srv.baseUrl, "GET", "/api/health");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  }

  // instructor
  let instructorId = null;
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/instructores", {
      nombre: "Profe Test",
      documento: "I-1",
      telefono: null,
      email: null,
    });
    assert.equal(r.status, 201, `POST /api/instructores failed: ${r.status} ${r.text}`);

    const list = await httpJson(srv.baseUrl, "GET", "/api/instructores");
    const found = (list.json || []).find((x) => x.documento === "I-1");
    assert.ok(found);
    instructorId = found.id;
  }

  // curso
  let cursoId = null;
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/cursos", {
      nombre: "Curso Test",
      instructor_id: instructorId,
      fecha_inicio: "2026-01-01",
      nro_clases: 4,
      cupo: 10,
      dias: "Lunes",
      hora_inicio: "10:00",
      duracion: 60,
      precio: 100,
    });
    assert.equal(r.status, 201, `POST /api/cursos failed: ${r.status} ${r.text}`);
    cursoId = r.json?.data?.id;
    assert.ok(cursoId);
  }

  // alumno
  let alumnoId = null;
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/alumnos", {
      nombre: "Alumno Test",
      documento: "A-1",
      telefono: null,
      email: null,
      fecha_ingreso: "2026-01-01",
    });
    assert.equal(r.status, 201);
    alumnoId = r.json?.data?.id;
    assert.ok(alumnoId);
  }

  // inscripcion
  let inscId = null;
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/inscripciones", {
      alumno_id: alumnoId,
      curso_id: cursoId,
      fecha_inscripcion: "2026-01-01",
      estado: "Activa",
      nro_cuotas: 2,
    });
    assert.equal(r.status, 201);
    const list = await httpJson(
      srv.baseUrl,
      "GET",
      `/api/inscripciones?alumno_id=${alumnoId}&curso_id=${cursoId}&estado=Activa&limit=10`
    );
    const arr = list.json?.data || list.json || [];
    const found = arr.find(
      (x) =>
        String(x.alumno_id) === String(alumnoId) &&
        String(x.curso_id) === String(cursoId) &&
        String(x.inscripcion_estado || x.estado) === "Activa"
    );
    assert.ok(found, `No se encontró inscripcion activa: ${list.status} ${list.text}`);
    inscId = found.inscripcion_id || found.id;
    assert.ok(inscId);
  }

  // resumen inicial (0 pagado)
  {
    const r = await httpJson(srv.baseUrl, "GET", `/api/pagos/inscripcion/${inscId}/resumen`);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.pagado_centavos, 0);
    assert.equal(r.json.precio_centavos, 10000);
    assert.equal(r.json.saldo_centavos, 10000);
  }

  // crear pago cuota 1
  let pagoId = null;
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/pagos", {
      inscripcion_id: inscId,
      fecha: "2026-01-02",
      monto: 50,
      cuota_nro: 1,
      cobro_estado: "Pagado",
      metodo: "Efectivo",
    });
    assert.ok(r.status === 200 || r.status === 201, `POST /api/pagos failed: ${r.status} ${r.text}`);
    pagoId = r.json?.pago?.id || r.json?.pago_id || null;
    assert.ok(pagoId);
  }

  // edición bloqueada
  {
    const r = await httpJson(srv.baseUrl, "PUT", `/api/pagos/${pagoId}`, { monto: 99 });
    assert.equal(r.status, 405);
  }

  // duplicado (misma cuota) debe fallar 409
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/pagos", {
      inscripcion_id: inscId,
      fecha: "2026-01-03",
      monto: 50,
      cuota_nro: 1,
      cobro_estado: "Pagado",
      metodo: "Efectivo",
    });
    assert.equal(r.status, 409);
  }

  // resumen tras pago
  {
    const r = await httpJson(srv.baseUrl, "GET", `/api/pagos/inscripcion/${inscId}/resumen`);
    assert.equal(r.status, 200);
    assert.equal(r.json.pagado_centavos, 5000);
    assert.equal(r.json.saldo_centavos, 5000);
  }

  // anular pago
  {
    const r = await httpJson(srv.baseUrl, "PUT", `/api/pagos/${pagoId}/anular`, { motivo: "error" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  }

  // pago anulado sigue visible y muestra motivo/fecha
  {
    const list = await httpJson(srv.baseUrl, "GET", `/api/pagos?vida=anulado&buscar=A-1`);
    assert.equal(list.status, 200);
    const rows = Array.isArray(list.json) ? list.json : [];
    const found = rows.find((x) => String(x.id) === String(pagoId));
    assert.ok(found, "Pago anulado no aparece en /api/pagos");
    assert.equal(String(found.estado).toLowerCase(), "anulado");
    assert.ok(found.motivo_anulacion && String(found.motivo_anulacion).length >= 2);
    assert.ok(found.fecha_anulacion, "fecha_anulacion faltante");
  }

  // resumen tras anulación vuelve a 0 pagado
  {
    const r = await httpJson(srv.baseUrl, "GET", `/api/pagos/inscripcion/${inscId}/resumen`);
    assert.equal(r.status, 200);
    assert.equal(r.json.pagado_centavos, 0);
    assert.equal(r.json.saldo_centavos, 10000);
  }

  // validación monetaria: monto <= 0 debe fallar
  {
    const r = await httpJson(srv.baseUrl, "POST", "/api/pagos", {
      inscripcion_id: inscId,
      fecha: "2026-01-04",
      monto: 0,
      cuota_nro: 2,
      cobro_estado: "Pagado",
      metodo: "Efectivo",
    });
    assert.equal(r.status, 400);
  }

  // baja alumno -> debe quedar inactivo (estado dinámico se calcula por fecha_vencimiento)
  {
    const r = await httpJson(srv.baseUrl, "PUT", `/api/alumnos/${alumnoId}/baja`, { motivo: "test" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  }

  // dashboard-v2 (no debe romper)
  {
    const r = await httpJson(srv.baseUrl, "GET", "/api/reportes/dashboard-v2");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.data);
  }
});


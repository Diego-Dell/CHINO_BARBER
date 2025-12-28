// public/js/cursos.js

// ===============================
// Helpers
// ===============================
async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (r.status === 401) {
    window.location.href = "/login.html";
    return null;
  }

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = isJson ? await r.json() : await r.text();
      msg = body?.error || body?.message || body || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  return isJson ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bs(n) {
  const v = toNum(n, 0);
  return "Bs " + v.toFixed(2);
}

function badgeEstadoCurso(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "activo") return "bg-success";
  if (e === "en curso") return "bg-primary";
  if (e === "finalizado") return "bg-secondary";
  if (e === "cancelado") return "bg-danger";
  return "bg-warning text-dark"; // Programado u otros
}

function badgeEstadoInscripcion(estado) {
  const st = String(estado || "");
  const cls = st === "Activa" ? "bg-success" : "bg-secondary";
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function horarioTexto(c) {
  const dias = (c.dias || "").trim();
  const h = (c.hora_inicio || c.horaInicio || "").trim();
  const dur = c.duracion != null ? String(c.duracion) : "";
  const parts = [];
  if (dias) parts.push(dias);
  if (h) parts.push(h);
  if (dur) parts.push(`Dur ${dur}`);
  return parts.join(" · ");
}

// ===============================
// DOM (tabla + filtros)
// ===============================
const tbody = document.querySelector("#tablaCursos tbody");
const cBuscar = document.getElementById("cBuscar");
const cEstado = document.getElementById("cEstado");
const cResumen = document.getElementById("cResumen");
const btnFiltrarCursos = document.getElementById("btnFiltrarCursos");
const btnRefrescarCursos = document.getElementById("btnRefrescarCursos");

// ===============================
// DOM (crear)
// ===============================
const formCurso = document.getElementById("formCurso");
const msgCurso = document.getElementById("msgCurso");

const cursoNombre = document.getElementById("cursoNombre");
const cursoInstructorId = document.getElementById("cursoInstructorId");
const cursoFechaInicio = document.getElementById("cursoFechaInicio");
const cursoNroClases = document.getElementById("cursoNroClases");
const cursoCupo = document.getElementById("cursoCupo");
const cursoDias = document.getElementById("cursoDias");
const cursoHoraInicio = document.getElementById("cursoHoraInicio");
const cursoDuracion = document.getElementById("cursoDuracion");
const cursoPrecio = document.getElementById("cursoPrecio");
const cursoEstado = document.getElementById("cursoEstado");

// ===============================
// DOM (editar)
// ===============================
const formCursoEdit = document.getElementById("formCursoEdit");
const msgEditCurso = document.getElementById("msgEditCurso");

const cEditId = document.getElementById("cEditId");
const cEditNombre = document.getElementById("cEditNombre");
const cEditInstructorId = document.getElementById("cEditInstructorId");
const cEditFechaInicio = document.getElementById("cEditFechaInicio");
const cEditNroClases = document.getElementById("cEditNroClases");
const cEditCupo = document.getElementById("cEditCupo");
const cEditDias = document.getElementById("cEditDias");
const cEditHoraInicio = document.getElementById("cEditHoraInicio");
const cEditDuracion = document.getElementById("cEditDuracion");
const cEditPrecio = document.getElementById("cEditPrecio");
const cEditEstado = document.getElementById("cEditEstado");

// ===============================
// DOM (ver alumnos modal)
// ===============================
const modalVerAlumnosEl = document.getElementById("modalVerAlumnos");
const tituloVerAlumnosEl = document.getElementById("tituloVerAlumnos");
const tablaVerAlumnosEl = document.getElementById("tablaVerAlumnos");
const msgVerAlumnosEl = document.getElementById("msgVerAlumnos");

// ===============================
// Cache
// ===============================
let cursosCache = [];
let instructoresCache = [];

// ===============================
// Instructores -> llenar selects
// ===============================
function fillSelectInstructores(selectEl, selectedId = "") {
  if (!selectEl) return;
  const sel = String(selectedId ?? "");

  const opts = [
    `<option value="">-- Seleccionar instructor --</option>`,
    ...instructoresCache.map((i) => {
      const id = String(i.id);
      const nombre = i.nombre || "";
      return `<option value="${esc(id)}" ${id === sel ? "selected" : ""}>${esc(nombre)}</option>`;
    }),
  ];

  selectEl.innerHTML = opts.join("");
}

async function cargarInstructores() {
  const data = await fetchJSON("/api/instructores");
  instructoresCache = Array.isArray(data) ? data : [];
  fillSelectInstructores(cursoInstructorId, "");
  fillSelectInstructores(cEditInstructorId, "");
}

// ===============================
// Render tabla cursos
// ===============================
function renderCursos(rows) {
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No hay cursos.</td></tr>`;
    if (cResumen) cResumen.textContent = "0 cursos";
    return;
  }

  tbody.innerHTML = rows
    .map((c) => {
      const instructor = c.instructor_nombre || c.instructor || c.instructorName || "";
      const inscritos = toNum(c.inscritos, 0);
      const cupo = toNum(c.cupo, 0);
      const insText = `${inscritos}/${cupo || 0}`;

      return `
      <tr>
        <td>${c.id}</td>
        <td class="fw-semibold">${esc(c.nombre)}</td>
        <td>${esc(instructor)}</td>
        <td>${esc(horarioTexto(c))}</td>
        <td class="text-center">${toNum(c.nro_clases, 0)}</td>
        <td class="text-center">${esc(insText)}</td>
        <td class="text-end">${bs(c.precio)}</td>
        <td><span class="badge ${badgeEstadoCurso(c.estado)}">${esc(c.estado || "Programado")}</span></td>
<td>
  <div class="d-flex gap-2">
    <button class="btn btn-outline-primary btn-sm"
      onclick="abrirEditarCurso(${c.id})">
      Editar
    </button>

    <button class="btn btn-outline-secondary btn-sm"
      onclick="verAlumnosCurso(${c.id}, '${esc(c.nombre)}')">
      Ver alumnos
    </button>

    <button class="btn btn-outline-dark btn-sm"
      onclick="verAsistenciaVisual(${c.id}, '${esc(c.nombre)}')">
      Ver asistencia
    </button>
  </div>
</td>

      </tr>
    `;
    })
    .join("");

  if (cResumen) cResumen.textContent = `${rows.length} curso${rows.length !== 1 ? "s" : ""}`;
}

// ===============================
// Cargar cursos
// ===============================
async function cargarCursos() {
  const params = new URLSearchParams();
  const q = (cBuscar?.value || "").trim();
  const estado = (cEstado?.value || "").trim();

  if (q) params.append("q", q);
  if (estado) params.append("estado", estado);

  let url = "/api/cursos";
  const qs = params.toString();
  if (qs) url += "?" + qs;

  const data = await fetchJSON(url);
  cursosCache = Array.isArray(data) ? data : [];
  renderCursos(cursosCache);
}

// ===============================
// Abrir modal editar
// ===============================
window.abrirEditarCurso = function (id) {
  const c = cursosCache.find((x) => Number(x.id) === Number(id));
  if (!c) return alert("Curso no encontrado");

  cEditId.value = c.id ?? "";
  cEditNombre.value = c.nombre ?? "";

  fillSelectInstructores(cEditInstructorId, c.instructor_id ?? c.instructorId ?? "");

  cEditFechaInicio.value = (c.fecha_inicio || c.fechaInicio || "").slice(0, 10);
  cEditNroClases.value = toNum(c.nro_clases, 1);
  cEditCupo.value = toNum(c.cupo, 1);

  cEditDias.value = c.dias ?? "";
  cEditHoraInicio.value = (c.hora_inicio || c.horaInicio || "").slice(0, 5);
  cEditDuracion.value = toNum(c.duracion, 1);

  cEditPrecio.value = toNum(c.precio, 0);
  cEditEstado.value = c.estado ?? "Programado";

  if (msgEditCurso) {
    msgEditCurso.textContent = "";
    msgEditCurso.className = "text-muted small";
  }

  new bootstrap.Modal(document.getElementById("modalCursoEdit")).show();
};

// ===============================
// Crear curso
// ===============================
formCurso?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nombre: (cursoNombre?.value || "").trim(),
    instructor_id: toNum(cursoInstructorId?.value, 0),
    fecha_inicio: (cursoFechaInicio?.value || "").trim() || hoyISO(),
    nro_clases: toNum(cursoNroClases?.value, 0),
    cupo: toNum(cursoCupo?.value, 0),
    dias: (cursoDias?.value || "").trim(),
    hora_inicio: (cursoHoraInicio?.value || "").trim(),
    duracion: toNum(cursoDuracion?.value, 0),
    precio: toNum(cursoPrecio?.value, 0),
    estado: (cursoEstado?.value || "Programado").trim(),
  };

  if (!payload.nombre) {
    msgCurso.textContent = "El nombre del curso es obligatorio.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.instructor_id) {
    msgCurso.textContent = "Selecciona un instructor.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.nro_clases || payload.nro_clases < 1) {
    msgCurso.textContent = "Número de clases inválido.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.cupo || payload.cupo < 1) {
    msgCurso.textContent = "Cupo inválido.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.dias) {
    msgCurso.textContent = "Días es obligatorio.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.hora_inicio) {
    msgCurso.textContent = "Hora de inicio es obligatoria.";
    msgCurso.className = "text-danger small";
    return;
  }
  if (!payload.duracion || payload.duracion < 1) {
    msgCurso.textContent = "Duración inválida.";
    msgCurso.className = "text-danger small";
    return;
  }

  try {
    msgCurso.textContent = "Guardando...";
    msgCurso.className = "text-muted small";

    await fetchJSON("/api/cursos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    msgCurso.textContent = "Curso creado.";
    msgCurso.className = "text-success small";

    formCurso.reset();
    if (cursoEstado) cursoEstado.value = "Programado";
    fillSelectInstructores(cursoInstructorId, "");

    await cargarCursos();

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalCurso"))?.hide();
      msgCurso.textContent = "";
    }, 700);
  } catch (err) {
    console.error(err);
    msgCurso.textContent = "Error al guardar: " + String(err.message || "desconocido");
    msgCurso.className = "text-danger small";
  }
});

// ===============================
// Guardar edición
// ===============================
formCursoEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = toNum(cEditId?.value, 0);

  const payload = {
    nombre: (cEditNombre?.value || "").trim(),
    instructor_id: toNum(cEditInstructorId?.value, 0),
    fecha_inicio: (cEditFechaInicio?.value || "").trim(),
    nro_clases: toNum(cEditNroClases?.value, 0),
    cupo: toNum(cEditCupo?.value, 0),
    dias: (cEditDias?.value || "").trim(),
    hora_inicio: (cEditHoraInicio?.value || "").trim(),
    duracion: toNum(cEditDuracion?.value, 0),
    precio: toNum(cEditPrecio?.value, 0),
    estado: (cEditEstado?.value || "Programado").trim(),
  };

  if (!id) {
    msgEditCurso.textContent = "ID inválido.";
    msgEditCurso.className = "text-danger small";
    return;
  }
  if (!payload.nombre) {
    msgEditCurso.textContent = "El nombre es obligatorio.";
    msgEditCurso.className = "text-danger small";
    return;
  }
  if (!payload.instructor_id) {
    msgEditCurso.textContent = "Selecciona un instructor.";
    msgEditCurso.className = "text-danger small";
    return;
  }
  if (!payload.nro_clases || payload.nro_clases < 1) {
    msgEditCurso.textContent = "Número de clases inválido.";
    msgEditCurso.className = "text-danger small";
    return;
  }
  if (!payload.cupo || payload.cupo < 1) {
    msgEditCurso.textContent = "Cupo inválido.";
    msgEditCurso.className = "text-danger small";
    return;
  }

  try {
    msgEditCurso.textContent = "Guardando...";
    msgEditCurso.className = "text-muted small";

    await fetchJSON(`/api/cursos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    msgEditCurso.textContent = "Actualizado.";
    msgEditCurso.className = "text-success small";

    await cargarCursos();

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalCursoEdit"))?.hide();
      msgEditCurso.textContent = "";
    }, 650);
  } catch (err) {
    console.error(err);
    msgEditCurso.textContent = "Error al guardar: " + String(err.message || "desconocido");
    msgEditCurso.className = "text-danger small";
  }
});

// ===============================
// Ver alumnos (modal)
// ===============================
window.verAlumnosCurso = async function (cursoId) {
  const c = cursosCache.find((x) => Number(x.id) === Number(cursoId));
  const cursoNombre = c?.nombre || `Curso #${cursoId}`;
  const profe = c?.instructor_nombre ? ` | Instructor: ${c.instructor_nombre}` : "";

  try {
    if (!modalVerAlumnosEl) return;

    if (tituloVerAlumnosEl) tituloVerAlumnosEl.textContent = `Alumnos inscritos — ${cursoNombre}${profe}`;
    if (msgVerAlumnosEl) {
      msgVerAlumnosEl.textContent = "Cargando...";
      msgVerAlumnosEl.className = "text-muted small mb-2";
    }
    if (tablaVerAlumnosEl) {
      tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Cargando...</td></tr>`;
    }

    const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
    const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
    const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

    if (!data.length) {
      tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay alumnos inscritos.</td></tr>`;
      if (msgVerAlumnosEl) msgVerAlumnosEl.textContent = "";
      new bootstrap.Modal(modalVerAlumnosEl).show();
      return;
    }

    if (msgVerAlumnosEl) {
      msgVerAlumnosEl.textContent = `${data.length} alumno${data.length !== 1 ? "s" : ""} inscrito${data.length !== 1 ? "s" : ""}`;
      msgVerAlumnosEl.className = "text-muted small mb-2";
    }

    tablaVerAlumnosEl.innerHTML = data.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="fw-semibold">${esc(r.alumno_nombre || r.nombre || "")}</td>
        <td>${esc(r.alumno_documento || r.documento || "")}</td>
        <td>${esc(r.alumno_telefono || r.telefono || "")}</td>
        <td>${esc(r.alumno_email ?? "")}</td>
        <td>${badgeEstadoInscripcion(r.estado_inscripcion ?? r.estado ?? "")}</td>
      </tr>
    `).join("");

    new bootstrap.Modal(modalVerAlumnosEl).show();
  } catch (err) {
    console.error(err);
    if (msgVerAlumnosEl) {
      msgVerAlumnosEl.textContent = `Error: ${err.message}`;
      msgVerAlumnosEl.className = "text-danger small mb-2";
    }
    if (tablaVerAlumnosEl) {
      tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-danger">No se pudo cargar.</td></tr>`;
    }
    new bootstrap.Modal(modalVerAlumnosEl).show();
  }
};

// ===============================
// Eventos filtros + refrescar
// ===============================
btnFiltrarCursos?.addEventListener("click", cargarCursos);
btnRefrescarCursos?.addEventListener("click", cargarCursos);

cBuscar?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarCursos();
  }
});

// ===============================
// Init
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await cargarInstructores();
  } catch (e) {
    console.error("No se pudo cargar instructores:", e);
  }

  try {
    await cargarCursos();
  } catch (e) {
    console.error("No se pudo cargar cursos:", e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">Error al cargar cursos.</td></tr>`;
    if (cResumen) cResumen.textContent = "0 cursos";
  }
});


// ===============================
// ASISTENCIA VISUAL (tipo cuadritos)
// Requiere modal con:
// #modalAsistenciaVisual, #tituloAsVisual, #leyendaAsVisual, #contenedorAsVisual
// ===============================

function colorEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "asistio") return "#21b14b";      // verde
  if (e === "falto") return "#e9151b";        // rojo
  if (e === "justificado") return "#00a7e6";  // azul (licencia)
  return "#e9ecef";                           // gris (sin marcar)
}

function labelEstadoCorto(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "asistio") return "Asistió";
  if (e === "falto") return "Faltó";
  if (e === "justificado") return "Licencia";
  return "Sin marcar";
}

function diaCorto(iso) {
  const d = new Date(iso + "T00:00:00");
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return dias[d.getDay()];
}

function ddmm(iso) {
  // iso yyyy-mm-dd
  const [y, m, d] = String(iso).split("-");
  return `${d}-${m}`;
}

window.verAsistenciaVisualCurso = async function (cursoId, cursoNombre = "") {
  const modalEl = document.getElementById("modalAsistenciaVisual");
  const titulo = document.getElementById("tituloAsVisual");
  const leyenda = document.getElementById("leyendaAsVisual");
  const cont = document.getElementById("contenedorAsVisual");

  if (!modalEl || !cont) return alert("Falta el modal visual de asistencia.");

  try {
    if (titulo) titulo.textContent = "Cargando...";
    cont.innerHTML = `<div class="text-muted">Cargando...</div>`;

    const res = await fetchJSON(`/api/asistencia/curso/${cursoId}/resumen`);
    if (!res?.ok) throw new Error(res?.error || "Respuesta inválida");

    const curso = res.curso || {};
    const fechas = Array.isArray(res.fechas) ? res.fechas : [];
    const alumnos = Array.isArray(res.alumnos) ? res.alumnos : [];

    const profe = curso.instructor_nombre ? ` | ${curso.instructor_nombre}` : "";
    if (titulo) titulo.textContent = `ASISTENCIA — ${cursoNombre || curso.nombre || ("Curso #" + cursoId)}${profe}`;

    // Leyenda derecha (como la foto)
    if (leyenda) {
      leyenda.innerHTML = `
        <div class="d-flex flex-column gap-3">
          <div class="d-flex align-items-center gap-2">
            <span style="width:26px;height:26px;border-radius:50%;background:#21b14b;border:3px solid #000;display:inline-block"></span>
            <span class="fw-semibold">Asistió</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span style="width:26px;height:26px;border-radius:50%;background:#e9151b;border:3px solid #000;display:inline-block"></span>
            <span class="fw-semibold">Faltó</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span style="width:26px;height:26px;border-radius:50%;background:#00a7e6;border:3px solid #000;display:inline-block"></span>
            <span class="fw-semibold">Licencia</span>
          </div>
        </div>
      `;
    }

    if (!fechas.length) {
      cont.innerHTML = `<div class="text-muted">Este curso no tiene fechas/clases generadas.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    if (!alumnos.length) {
      cont.innerHTML = `<div class="text-muted">No hay alumnos inscritos.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    // Cabecera de fechas (arriba, centradas)
    const headerFechas = `
      <div class="d-flex gap-4 justify-content-center flex-wrap mb-4" style="font-style:italic">
        ${fechas.map(f => `
          <div class="text-center" style="min-width:110px">
            <div class="fw-bold text-decoration-underline">${esc(diaCorto(f))} ${esc(ddmm(f))}</div>
          </div>
        `).join("")}
      </div>
    `;

    // Filas por alumno: nombre grande a la izquierda, cuadritos en el medio
    const filas = alumnos.map(a => {
      const asMap = a.asistencia || {};
      const cuadritos = fechas.map(f => {
        const estado = asMap?.[f]?.estado || "";
        const col = colorEstado(estado);
        const tip = `${f} — ${labelEstadoCorto(estado)}`;
        return `
          <div title="${esc(tip)}"
               style="width:110px;height:48px;background:${col};border:4px solid #000;border-radius:2px">
          </div>
        `;
      }).join("");

      return `
        <div class="d-flex align-items-center justify-content-between py-4" style="border-top:1px solid #f1f1f1">
          <div style="min-width:240px">
            <div class="display-6 fw-bold text-decoration-underline">${esc(a.alumno_nombre || "")}</div>
            <div class="text-muted">CI: ${esc(a.alumno_documento || "")}</div>
          </div>

          <div class="d-flex gap-4 justify-content-center flex-wrap" style="flex:1">
            ${cuadritos}
          </div>
        </div>
      `;
    }).join("");

    cont.innerHTML = `
      <div class="p-3" style="border:6px solid #000;border-radius:6px">
        <div class="text-center fw-bold mb-2" style="letter-spacing:1px">ASISTENCIA</div>
        ${headerFechas}
        ${filas}
      </div>
    `;

    new bootstrap.Modal(modalEl).show();
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div class="text-danger">Error: ${esc(err.message || "desconocido")}</div>`;
    new bootstrap.Modal(modalEl).show();
  }
};


window.verAsistenciaVisual = async function (cursoId, cursoNombre = "") {
  const modalEl = document.getElementById("modalAsistenciaVisual");
  const titulo = document.getElementById("tituloAsVisual");
  const cont = document.getElementById("contenedorAsVisual");
  const leyenda = document.getElementById("leyendaAsVisual");

  if (!modalEl || !titulo || !cont || !leyenda) {
    alert("Falta el modalAsistenciaVisual en cursos.html");
    return;
  }

  titulo.textContent = `ASISTENCIA — ${cursoNombre || ("Curso #" + cursoId)}`;

  // leyenda fija
  leyenda.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">
      <span style="width:22px;height:22px;border-radius:50%;display:inline-block;background:#1fb74a;border:3px solid #111"></span>
      <b>Asistió</b>
    </div>
    <div class="d-flex align-items-center gap-2 mb-3">
      <span style="width:22px;height:22px;border-radius:50%;display:inline-block;background:#e11d2e;border:3px solid #111"></span>
      <b>Faltó</b>
    </div>
    <div class="d-flex align-items-center gap-2">
      <span style="width:22px;height:22px;border-radius:50%;display:inline-block;background:#0ea5e9;border:3px solid #111"></span>
      <b>Licencia</b>
    </div>
  `;

  cont.innerHTML = `<div class="text-muted">Cargando...</div>`;

  try {
    // 1) alumnos del curso (inscripciones)
    const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
    let ins = await fetchJSON(`/api/inscripciones?${p.toString()}`);
    let alumnos = Array.isArray(ins) ? ins : (Array.isArray(ins?.data) ? ins.data : []);

    // fallback
    if (!alumnos.length) {
      try {
        const ins2 = await fetchJSON(`/api/inscripciones/por-curso/${cursoId}`);
        alumnos = Array.isArray(ins2) ? ins2 : (Array.isArray(ins2?.data) ? ins2.data : []);
      } catch (_) {}
    }

    if (!alumnos.length) {
      cont.innerHTML = `<div class="text-muted">No hay alumnos inscritos.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    // 2) Buscar asistencias por cada inscripción
    // Necesitas endpoint: GET /api/asistencia/por-curso/:cursoId  (si no existe, lo armamos)
    // Intento 1:
    let asistRows = [];
    try {
      asistRows = await fetchJSON(`/api/asistencia/por-curso/${cursoId}`);
      asistRows = Array.isArray(asistRows) ? asistRows : (Array.isArray(asistRows?.data) ? asistRows.data : []);
    } catch (e) {
      asistRows = [];
    }

    // Normalizamos: fecha, inscripcion_id, estado
    // asistRows: [{fecha, inscripcion_id, estado}]
    const fechas = [...new Set(asistRows.map(x => String(x.fecha || "").slice(0,10)).filter(Boolean))].sort();

    // mapa asistencia[inscripcion_id][fecha] = estado
    const mapa = new Map();
    for (const r of asistRows) {
      const iid = Number(r.inscripcion_id || r.inscripcionId || 0);
      const f = String(r.fecha || "").slice(0,10);
      const est = String(r.estado || "").trim();
      if (!iid || !f) continue;
      if (!mapa.has(iid)) mapa.set(iid, new Map());
      mapa.get(iid).set(f, est);
    }

    // si no hay fechas aún
    if (!fechas.length) {
      cont.innerHTML = `<div class="text-muted">Aún no hay asistencia registrada para este curso.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    const colorEstado = (e) => {
      const s = String(e || "").toLowerCase();
      if (s.includes("asist")) return "#1fb74a";
      if (s.includes("falt")) return "#e11d2e";
      if (s.includes("lic")) return "#0ea5e9";
      return "#e5e7eb"; // sin marcar
    };

    // Armado visual tipo foto
    cont.innerHTML = `
      <div class="p-3" style="border:4px solid #111;border-radius:6px;background:#fff">
        <div class="fw-bold text-center mb-3" style="font-size:20px;text-transform:uppercase">
          ASISTENCIA
        </div>

        <div class="d-flex align-items-center gap-3 mb-2" style="padding-left:240px">
          ${fechas.map(f => `<div class="text-center" style="width:110px">
            <div style="font-weight:700;text-decoration:underline">${f.split("-").reverse().join("-")}</div>
          </div>`).join("")}
        </div>

        ${alumnos.map(a => {
          const iid = Number(a.inscripcion_id || a.inscripcionId || a.inscripcionID || a.id || 0);
          const nombre = a.alumno_nombre || a.nombre || "";
          return `
            <div class="d-flex align-items-center gap-3 mb-4">
              <div style="width:220px">
                <div style="font-size:42px;font-weight:800;font-style:italic;text-decoration:underline">
                  ${esc(nombre)}
                </div>
              </div>

              <div class="d-flex gap-4">
                ${fechas.map(f => {
                  const est = mapa.get(iid)?.get(f) || "";
                  const col = colorEstado(est);
                  return `<div style="width:110px;height:46px;border:4px solid #111;background:${col}"></div>`;
                }).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    new bootstrap.Modal(modalEl).show();

  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div class="text-danger">No se pudo cargar la asistencia.</div>`;
    new bootstrap.Modal(modalEl).show();
  }
};

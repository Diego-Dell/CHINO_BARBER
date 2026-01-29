// public/js/cursos.js

// ===============================
// Helpers
// ===============================
(() => {
  "use strict";

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


// ========= ASISTENCIA VISUAL TIPO FOTO (modal) =========

// helpers (si ya los tienes en este archivo, NO los dupliques)
function parseISO(d) {
  const [y, m, day] = String(d || "").split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}
function toISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// "Martes-Jueves" -> weekdays
function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();
  const map = [
    ["lunes", 1], ["martes", 2], ["miercoles", 3], ["miércoles", 3],
    ["jueves", 4], ["viernes", 5], ["sabado", 6], ["sábado", 6], ["domingo", 0],
  ];
  const out = new Set();
  for (const [name, idx] of map) if (s.includes(name)) out.add(idx);
  return Array.from(out).sort((a,b)=>a-b);
}

function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
  const fi = (fecha_inicio || "").slice(0, 10);
  const start = parseISO(fi);
  const n = toNum(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || n <= 0 || weekdays.length === 0) return [];

  const fechas = [];
  let cursor = new Date(start);

  while (fechas.length < n) {
    if (weekdays.includes(cursor.getDay())) fechas.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if ((cursor - start) / 86400000 > 900) break;
  }
  return fechas;
}

// Map estado a letra
function estadoToLetra(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("asist")) return "A";
  if (e.includes("falt")) return "F";
  if (e.includes("lic") || e.includes("justif")) return "L";
  return "";
}
function letraToEstado(letra) {
  if (letra === "A") return "Asistió";
  if (letra === "F") return "Faltó";
  if (letra === "L") return "Licencia";
  return "";
}

// --- API (usa TU fetchJSON ya existente en cursos.js) ---
// Debes tener: GET /api/inscripciones?curso_id= &estado=Activa  (con alumno_nombre, alumno_documento, inscripcion_id/id)
// Debes tener: GET /api/asistencia?curso_id= &fecha=YYYY-MM-DD (con inscripcion_id y estado)
// Para guardar: puedes tener POST /api/asistencia (uno por uno) o bulk. Te dejo saveCells uno por uno.

async function apiGetInscritos(cursoId) {
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  return arr.map(r => ({
    inscripcion_id: r.inscripcion_id ?? r.id,
    alumno_nombre: r.alumno_nombre ?? r.nombre ?? "",
    alumno_documento: r.alumno_documento ?? r.documento ?? "",
  })).filter(x => x.inscripcion_id);
}

async function apiGetAsistenciaDia(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (!inscId) continue;
    m.set(Number(inscId), estadoToLetra(r.estado || ""));
  }
  return m;
}

// Guardar: 1 por celda (seguro, no requiere bulk)
async function apiUpsertAsistencia({ curso_id, inscripcion_id, fecha, estado }) {
  // Ajusta si tu backend usa otra ruta/fields
  return fetchJSON("/api/asistencia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curso_id, inscripcion_id, fecha, estado }),
  });
}

// ===== estado global del modal =====
let AS_FOTO = {
  cursoId: 0,
  fechas: [],
  alumnos: [],
  // Map key "inscId|fecha" -> letra
  values: new Map(),
  // dirty changes: Map key -> letra
  dirty: new Map(),
  curso: null
};

function keyCell(inscId, fechaISO) {
  return `${Number(inscId)}|${fechaISO}`;
}

function renderAsistenciaFotoModal() {
  const grid = document.getElementById("asFotoGrid");
  if (!grid) return;

  const { fechas, alumnos } = AS_FOTO;

  if (!fechas.length) {
    grid.innerHTML = `<div class="text-muted">No se pudieron calcular fechas (revisa inicio/días/nro_clases).</div>`;
    return;
  }

  // Define columnas: 1 col nombres + N fechas
  // grid-template-columns dinámico:
  grid.style.gridTemplateColumns = `var(--nameCol) repeat(${fechas.length}, var(--cell))`;

  const parts = [];

  // Header row: (vacío para la col nombre) + fechas
  parts.push(`<div></div>`);
  for (const f of fechas) {
    parts.push(`<div class="asfoto-h">${esc(f.slice(5))}</div>`);
  }

  // Rows: alumno name + cells
  for (const a of alumnos) {
    parts.push(`
      <div>
        <div class="asfoto-name">${esc(a.alumno_nombre || "—")}</div>
        <div class="asfoto-ci">${esc(a.alumno_documento || "")}</div>
      </div>
    `);

    for (const f of fechas) {
      const inscId = a.inscripcion_id;
      const k = keyCell(inscId, f);
      const letra = AS_FOTO.values.get(k) || ""; // A/F/L/""
      parts.push(`
        <div class="asfoto-cell" data-k="${esc(k)}" data-v="${esc(letra)}">
          <select class="asfoto-select" data-k="${esc(k)}">
            <option value="" ${letra==="" ? "selected":""}></option>
            <option value="A" ${letra==="A" ? "selected":""}>A</option>
            <option value="F" ${letra==="F" ? "selected":""}>F</option>
            <option value="L" ${letra==="L" ? "selected":""}>L</option>
          </select>
        </div>
      `);
    }
  }

  grid.innerHTML = parts.join("");

  // listeners a selects
  grid.querySelectorAll(".asfoto-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const k = e.target.getAttribute("data-k");
      const v = e.target.value; // A/F/L/""
      AS_FOTO.dirty.set(k, v);
      AS_FOTO.values.set(k, v);

      // pinta la celda
      const cell = grid.querySelector(`.asfoto-cell[data-k="${CSS.escape(k)}"]`);
      if (cell) cell.setAttribute("data-v", v);

      const msg = document.getElementById("asFotoMsg");
      if (msg) msg.textContent = `Cambios sin guardar: ${AS_FOTO.dirty.size}`;
    });
  });
}

// ===== abre el modal =====
window.abrirAsistenciaFoto = async function (cursoId) {
  const title = document.getElementById("asFotoTitle");
  const sub = document.getElementById("asFotoSub");
  const msg = document.getElementById("asFotoMsg");
  const grid = document.getElementById("asFotoGrid");

  AS_FOTO = { cursoId: Number(cursoId), fechas: [], alumnos: [], values: new Map(), dirty: new Map(), curso: null };

  try {
    if (msg) msg.textContent = "Cargando…";
    if (grid) grid.innerHTML = "";

    // trae curso desde cache (si tienes cursosCache global)
    const curso = (window.cursosCache || []).find(c => Number(c.id) === Number(cursoId)) || null;
    AS_FOTO.curso = curso;

    const nombreCurso = curso?.nombre || `Curso #${cursoId}`;
    const instructor = curso?.instructor_nombre || curso?.instructor || "—";
    const inicio = (curso?.fecha_inicio || "").slice(0,10) || "—";
    const dias = curso?.dias || "—";
    const clases = toNum(curso?.nro_clases, 0);

    if (title) title.textContent = `ASISTENCIA — ${nombreCurso}`;
    if (sub) sub.textContent = `Instructor: ${instructor} · Inicio: ${inicio} · Días: ${dias} · Clases: ${clases}`;

    // fechas del curso
    const fechas = buildFechasClases({
      fecha_inicio: curso?.fecha_inicio || curso?.fechaInicio || "",
      dias: curso?.dias || "",
      nro_clases: curso?.nro_clases || curso?.nroClases || 0
    });
    AS_FOTO.fechas = fechas;

    // alumnos inscritos
    const alumnos = await apiGetInscritos(cursoId);
    AS_FOTO.alumnos = alumnos;

    // cargar asistencia de BD por fecha (si hay muchas clases, esto hace varias llamadas)
    for (const f of fechas) {
      const mapDia = await apiGetAsistenciaDia(cursoId, f);
      for (const a of alumnos) {
        const k = keyCell(a.inscripcion_id, f);
        const letra = mapDia.get(Number(a.inscripcion_id)) || "";
        AS_FOTO.values.set(k, letra);
      }
    }

    renderAsistenciaFotoModal();

    if (msg) msg.textContent = `Alumnos: ${alumnos.length} · Clases: ${fechas.length}`;

    new bootstrap.Modal(document.getElementById("modalAsistenciaFoto")).show();
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "Error cargando asistencia.";
    if (grid) grid.innerHTML = `<div class="text-danger">Error: ${esc(e.message || "desconocido")}</div>`;
    new bootstrap.Modal(document.getElementById("modalAsistenciaFoto")).show();
  }
};

// ===== guardar cambios =====
document.getElementById("btnGuardarAsFoto")?.addEventListener("click", async () => {
  const msg = document.getElementById("asFotoMsg");
  try {
    if (!AS_FOTO.cursoId) return;

    if (!AS_FOTO.dirty.size) {
      if (msg) msg.textContent = "No hay cambios para guardar.";
      return;
    }

    if (msg) msg.textContent = "Guardando…";

    // guardar 1 por 1 (seguro)
    for (const [k, letra] of AS_FOTO.dirty.entries()) {
      const [inscIdStr, fecha] = k.split("|");
      const inscId = Number(inscIdStr);
      const estado = letraToEstado(letra); // "Asistió" / "Faltó" / "Licencia" / ""

      // si queda vacío, puedes decidir: no guardar / o guardar como "Sin registro".
      // aquí: si vacío, NO guarda.
      if (!estado) continue;

      await apiUpsertAsistencia({
        curso_id: AS_FOTO.cursoId,
        inscripcion_id: inscId,
        fecha,
        estado
      });
    }

    AS_FOTO.dirty.clear();
    if (msg) msg.textContent = "✅ Guardado.";
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "Error guardando.";
    alert("Error: " + String(e.message || "desconocido"));
  }
});


async function verAsistenciaVisual(curso_id) {
  try {
const res = await fetchJSON(`/api/asistencia/curso/${cursoId}/resumen`);

    const data = await res.json();

    const { curso, fechas, alumnos } = data;

    document.getElementById("tituloAsVisual").textContent =
      `Asistencia — ${curso.nombre}`;

    document.getElementById("infoAsVisual").textContent =
      `Instructor: ${curso.instructor_nombre || "—"} | Clases: ${fechas.length}`;

    // HEADER
    const ths = [
      "<th>Alumno</th>",
      ...fechas.map((f, i) => `<th>Clase ${i + 1}</th>`)
    ];
    document.getElementById("theadAsVisual").innerHTML =
      `<tr>${ths.join("")}</tr>`;

    // BODY
    const rows = alumnos.map(a => {
      const celdas = fechas.map(f => {
        const estado = a.asistencia?.[f]?.estado || "";
        return `<td>${estadoVisualHTML(estado)}</td>`;
      }).join("");

      return `<tr>
        <td class="text-start fw-semibold">${a.alumno_nombre}</td>
        ${celdas}
      </tr>`;
    }).join("");

    document.getElementById("tbodyAsVisual").innerHTML = rows;

    new bootstrap.Modal(
      document.getElementById("modalAsistenciaVisual")
    ).show();

  } catch (err) {
    console.error(err);
    alert("Error al cargar asistencia");
  }
}

function estadoVisualHTML(estado) {
  if (estado === "Asistio") {
    return `<div class="asDot as_ok"><span class="asBadge">A</span></div>`;
  }
  if (estado === "Falto") {
    return `<div class="asDot as_bad"><span class="asBadge">F</span></div>`;
  }
  if (estado === "Justificado") {
    return `<div class="asDot as_lic"><span class="asBadge">L</span></div>`;
  }
  return `<div class="asDot as_empty"><span class="asBadge"></span></div>`;
}
})();

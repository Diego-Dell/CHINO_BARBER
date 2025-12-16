// public/js/cursos.js

// ===============================
// Helpers
// ===============================
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    // intenta devolver json error si existe
    const txt = await r.text();
    throw new Error(txt || "Error HTTP");
  }
  return ct.includes("application/json") ? r.json() : null;
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

function badgeEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e === "activo") return "bg-success";
  if (e === "en curso") return "bg-primary";
  if (e === "finalizado") return "bg-secondary";
  if (e === "cancelado") return "bg-danger";
  return "bg-warning text-dark"; // Programado u otros
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
      const nombre = i.nombre || i.instructor || "";
      return `<option value="${esc(id)}" ${id === sel ? "selected" : ""}>${esc(nombre)}</option>`;
    }),
  ];

  selectEl.innerHTML = opts.join("");
}

async function cargarInstructores() {
  // tu API ya existe /api/instructores
  const data = await fetchJSON("/api/instructores");
  instructoresCache = Array.isArray(data) ? data : [];

  fillSelectInstructores(cursoInstructorId, "");
  fillSelectInstructores(cEditInstructorId, "");
}

// ===============================
// Render tabla
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
      const inscritos = toNum(c.inscritos, 0); // depende de tu API
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
        <td><span class="badge ${badgeEstado(c.estado)}">${esc(c.estado || "Programado")}</span></td>
        <td>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-primary btn-sm" onclick="abrirEditarCurso(${c.id})">
              Editar
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

  // asegurar instructores cargados
  fillSelectInstructores(cEditInstructorId, c.instructor_id ?? c.instructorId ?? "");

  // si tu API devuelve fecha_inicio
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
    fecha_inicio: (cursoFechaInicio?.value || "").trim(),
    nro_clases: toNum(cursoNroClases?.value, 0),
    cupo: toNum(cursoCupo?.value, 0),
    dias: (cursoDias?.value || "").trim(),
    hora_inicio: (cursoHoraInicio?.value || "").trim(),
    duracion: toNum(cursoDuracion?.value, 0),
    precio: toNum(cursoPrecio?.value, 0),
    estado: (cursoEstado?.value || "Programado").trim(),
  };

  // defaults útiles
  if (!payload.fecha_inicio) payload.fecha_inicio = hoyISO();

  // validación mínima (evita NOT NULL constraint)
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
    // restaurar estado por defecto
    if (cursoEstado) cursoEstado.value = "Programado";
    // recargar instructores en select (reset borra selección)
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
    // igual dejamos que funcione cursos si ya existen
  }

  try {
    await cargarCursos();
  } catch (e) {
    console.error("No se pudo cargar cursos:", e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">Error al cargar cursos.</td></tr>`;
    if (cResumen) cResumen.textContent = "0 cursos";
  }
});

// public/js/asistencia.js  (ERD: INSCRIPCIONES -> ASISTENCIA)

async function fetchJSON(url, options = {}) {
  options.credentials = "include"; // ✅ sesión
  const r = await fetch(url, options);

  if (r.status === 401) {
    window.location.href = "/login.html";
    return;
  }

  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

const aFecha = document.getElementById("aFecha");
const aCurso = document.getElementById("aCurso");
const aBuscar = document.getElementById("aBuscar");
const tablaAsistencia = document.getElementById("tablaAsistencia");
const msgAs = document.getElementById("msgAs");

let inscripcionesCurso = [];

function hoyISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
}

function setMsg(text, cls = "text-muted small") {
  if (!msgAs) return;
  msgAs.textContent = text || "";
  msgAs.className = cls;
}

// =========================
// CARGAR CURSOS
// =========================
async function cargarCursos() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    if (!Array.isArray(cursos)) throw new Error("Respuesta inválida");

    aCurso.innerHTML = `<option value="">-- Seleccionar curso --</option>` + cursos.map(c =>
      `<option value="${c.id}">${esc(c.nombre)}</option>`
    ).join("");
  } catch (err) {
    console.error(err);
    aCurso.innerHTML = `<option value="">Error al cargar cursos</option>`;
  }
}

// =========================
// CARGAR INSCRIPCIONES POR CURSO
// (en vez de alumnos/curso)
// =========================
async function cargarInscripciones() {
  const curso_id = Number(aCurso?.value);
  const q = (aBuscar?.value || "").trim();

  if (!curso_id) {
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Seleccioná un curso.</td></tr>`;
    return;
  }

  try {
    setMsg("Cargando...", "text-muted small");

    const params = new URLSearchParams();
    params.set("curso_id", String(curso_id));
    // por defecto pedimos solo inscripciones activas (tu esquema tiene estado)
    params.set("estado", "Activa");
    if (q) params.set("q", q);

    // ✅ BACKEND esperado:
    // GET /api/inscripciones?curso_id=1&estado=Activa&q=...
    // Debe devolver filas así:
    // { inscripcion_id, alumno_id, alumno_nombre, alumno_documento, estado_inscripcion }
    const data = await fetchJSON(`/api/inscripciones?${params.toString()}`);

    inscripcionesCurso = Array.isArray(data) ? data : [];
    renderTablaAsistencia(inscripcionesCurso);

    setMsg("");
  } catch (err) {
    console.error(err);
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Error al cargar inscripciones.</td></tr>`;
    setMsg("Error al cargar.", "text-danger small");
  }
}

// =========================
// RENDER
// =========================
function renderTablaAsistencia(rows) {
  if (!rows.length) {
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay alumnos inscritos.</td></tr>`;
    return;
  }

  tablaAsistencia.innerHTML = rows.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(it.alumno_nombre || it.nombre || "")}</td>
      <td>${esc(it.alumno_documento || it.documento || "")}</td>
      <td>
        <select class="form-select form-select-sm estado-asistencia"
                data-inscripcion-id="${it.inscripcion_id || it.id}">
          <option value="Presente">Presente</option>
          <option value="Ausente">Ausente</option>
          <option value="Justificado">Justificado</option>
        </select>
      </td>
    </tr>
  `).join("");
}

// =========================
// GUARDAR ASISTENCIA (BULK)
// =========================
async function guardarAsistencia() {
  const fecha = (aFecha?.value || "").trim();
  const curso_id = Number(aCurso?.value);

  if (!fecha || !curso_id) {
    setMsg("Elegí fecha y curso.", "text-danger small");
    return;
  }

  const registros = [...document.querySelectorAll(".estado-asistencia")].map(sel => ({
    inscripcion_id: Number(sel.dataset.inscripcionId),
    estado: sel.value,
    observacion: "" // si luego agregas campo observación, lo llenas aquí
  })).filter(x => Number.isFinite(x.inscripcion_id) && x.inscripcion_id > 0);

  if (!registros.length) {
    setMsg("No hay registros para guardar.", "text-danger small");
    return;
  }

  try {
    setMsg("Guardando...", "text-muted small");

    // ✅ BACKEND recomendado:
    // POST /api/asistencia/bulk
    // body: { fecha, curso_id, registros:[{inscripcion_id, estado, observacion}] }
    await fetchJSON("/api/asistencia/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, curso_id, registros })
    });

    setMsg("Asistencia guardada.", "text-success small");
    setTimeout(() => setMsg(""), 1400);

  } catch (err) {
    console.error(err);
    setMsg(err.message || "Error al guardar.", "text-danger small");
  }
}

// =========================
// EVENTOS
// =========================
document.getElementById("btnCargarAlumnos")?.addEventListener("click", cargarInscripciones);
document.getElementById("btnGuardarAsistencia")?.addEventListener("click", guardarAsistencia);

aBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInscripciones();
  }
});

aCurso?.addEventListener("change", () => {
  // al cambiar curso, refresca lista
  cargarInscripciones();
});

document.addEventListener("DOMContentLoaded", () => {
  if (aFecha) aFecha.value = hoyISO();
  cargarCursos();
});

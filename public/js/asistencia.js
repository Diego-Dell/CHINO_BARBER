// public/js/asistencia.js
// INSCRIPCIONES -> ASISTENCIA (bulk)

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  if (r.status === 401) {
    window.location.href = "/login.html";
    return;
  }

  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

// =========================
// DOM
// =========================
const aFecha = document.getElementById("aFecha");
const aCurso = document.getElementById("aCurso");
const aBuscar = document.getElementById("aBuscar");
const tablaAsistencia = document.getElementById("tablaAsistencia");
const msgAs = document.getElementById("msgAs");

// =========================
// HELPERS
// =========================
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;"
  }[c]));
}

function setMsg(text, cls = "text-muted small") {
  if (!msgAs) return;
  msgAs.textContent = text || "";
  msgAs.className = cls;
}

// =========================
// MAPEO UI -> BD  (CLAVE)
// =========================
const UI_TO_DB = {
  "Presente": "Asistio",
  "Ausente": "Falto",
  "Justificado": "Justificado"
};

// =========================
// CARGAR CURSOS
// =========================
async function cargarCursos() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    aCurso.innerHTML =
      `<option value="">-- Seleccionar curso --</option>` +
      cursos.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  } catch (e) {
    console.error(e);
    aCurso.innerHTML = `<option value="">Error al cargar cursos</option>`;
  }
}

// =========================
// CARGAR INSCRIPCIONES
// =========================
async function cargarInscripciones() {
  const curso_id = Number(aCurso.value);
  const q = (aBuscar.value || "").trim();

  if (!curso_id) {
    tablaAsistencia.innerHTML =
      `<tr><td colspan="4" class="text-center text-muted">Seleccione un curso</td></tr>`;
    return;
  }

  try {
    setMsg("Cargando...", "text-muted small");

    const params = new URLSearchParams({
      curso_id,
      estado: "Activa"
    });
    if (q) params.set("q", q);

    const data = await fetchJSON(`/api/inscripciones?${params}`);
    renderTablaAsistencia(Array.isArray(data) ? data : []);

    setMsg("");
  } catch (e) {
    console.error(e);
    setMsg("Error al cargar inscripciones", "text-danger small");
  }
}

// =========================
// RENDER TABLA
// =========================
function renderTablaAsistencia(rows) {
  if (!rows.length) {
    tablaAsistencia.innerHTML =
      `<tr><td colspan="4" class="text-center text-muted">Sin alumnos inscritos</td></tr>`;
    return;
  }

  tablaAsistencia.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.alumno_nombre)}</td>
      <td>${esc(r.alumno_documento)}</td>
      <td>
        <select class="form-select form-select-sm estado-asistencia"
                data-inscripcion-id="${r.inscripcion_id}">
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
  const fecha = aFecha.value;
  const curso_id = Number(aCurso.value);

  if (!fecha || !curso_id) {
    setMsg("Seleccione fecha y curso", "text-danger small");
    return;
  }

  const registros = [...document.querySelectorAll(".estado-asistencia")]
    .map(sel => ({
      inscripcion_id: Number(sel.dataset.inscripcionId),
      estado: UI_TO_DB[sel.value], // 🔥 CONVERSIÓN CLAVE
      observacion: ""
    }))
    .filter(r => r.inscripcion_id && r.estado);

  if (!registros.length) {
    setMsg("No hay registros válidos", "text-danger small");
    return;
  }

  try {
    setMsg("Guardando...", "text-muted small");

    await fetchJSON("/api/asistencia/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, curso_id, registros })
    });

    setMsg("Asistencia guardada correctamente", "text-success small");
    setTimeout(() => setMsg(""), 1500);

  } catch (e) {
    console.error(e);
    setMsg("Error al guardar asistencia", "text-danger small");
  }
}

// =========================
// EVENTOS
// =========================
document.getElementById("btnCargarAlumnos")
  ?.addEventListener("click", cargarInscripciones);

document.getElementById("btnGuardarAsistencia")
  ?.addEventListener("click", guardarAsistencia);

aCurso?.addEventListener("change", cargarInscripciones);

aBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInscripciones();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  aFecha.value = hoyISO();
  cargarCursos();
});

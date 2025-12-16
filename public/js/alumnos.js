// =====================================
// helpers
// =====================================
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// =====================================
// DOM
// =====================================
const tablaBody = document.querySelector("#tablaAlumnos tbody");
const lblResumen = document.getElementById("lblResumen");
const inputBuscar = document.getElementById("inputBuscar");
const btnBuscar = document.getElementById("btnBuscar");

const formAlumno = document.getElementById("formAlumno");
const msgAlumno = document.getElementById("msgAlumno");

const alNombre = document.getElementById("alNombre");
const alDocumento = document.getElementById("alDocumento");
const alTelefono = document.getElementById("alTelefono");
const alEmail = document.getElementById("alEmail");
const alFecha = document.getElementById("alFecha");
const alEstado = document.getElementById("alEstado");

// INSCRIPCIÓN GLOBAL
const formInscribir = document.getElementById("formInscribirGlobal");
const msgInscribir = document.getElementById("msgInscribirGlobal");
const inscDocumento = document.getElementById("inscGDocumento");
const btnBuscarAlumnoCI = document.getElementById("btnBuscarAlumnoCI");
const inscAlumnoId = document.getElementById("inscGAlumnoId");
const inscAlumnoNombre = document.getElementById("inscGAlumnoNombre");
const inscAlumnoInfo = document.getElementById("inscGAlumnoInfo");
const inscCursoId = document.getElementById("inscGCursoId");
const inscEstado = document.getElementById("inscGEstado");

let alumnosCache = [];
let alumnoSeleccionado = null;

// =====================================
// CARGAR ALUMNOS
// =====================================
async function cargarAlumnos(q = "") {
  try {
    let url = "/api/alumnos";
    if (q.trim()) url = `/api/alumnos/search?q=${encodeURIComponent(q)}`;

    const data = await fetchJSON(url);
    alumnosCache = Array.isArray(data) ? data : [];
    renderTabla(alumnosCache);

  } catch (e) {
    console.error(e);
    tablaBody.innerHTML =
      `<tr><td colspan="8" class="text-center text-danger">Error al cargar alumnos</td></tr>`;
    lblResumen.textContent = "0 alumnos";
  }
}

// =====================================
// RENDER TABLA
// =====================================
function renderTabla(rows) {
  if (!rows.length) {
    tablaBody.innerHTML =
      `<tr><td colspan="8" class="text-center text-muted">Sin alumnos registrados</td></tr>`;
    lblResumen.textContent = "0 alumnos";
    return;
  }

  tablaBody.innerHTML = rows.map(a => `
    <tr>
      <td>${a.id}</td>
      <td class="fw-semibold">${esc(a.nombre)}</td>
      <td>${esc(a.documento)}</td>
      <td>${esc(a.telefono || "")}</td>
      <td>${esc(a.email || "")}</td>
      <td>${esc(a.fecha_ingreso || "")}</td>
      <td>
        <span class="badge ${a.estado === "Activo" ? "bg-success" : "bg-secondary"}">
          ${a.estado}
        </span>
      </td>
      <td>
        <button class="btn btn-outline-primary btn-sm"
          onclick="abrirInscribirGlobal('${esc(a.documento)}')">
          Inscribir
        </button>
      </td>
    </tr>
  `).join("");

  lblResumen.textContent =
    `${rows.length} alumno${rows.length !== 1 ? "s" : ""}`;
}

// =====================================
// BUSCAR
// =====================================
btnBuscar.addEventListener("click", () => cargarAlumnos(inputBuscar.value));
inputBuscar.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarAlumnos(inputBuscar.value);
  }
});

// =====================================
// CREAR ALUMNO
// =====================================
formAlumno.addEventListener("submit", async e => {
  e.preventDefault();

  const payload = {
    nombre: alNombre.value.trim(),
    documento: alDocumento.value.trim(),
    telefono: alTelefono.value.trim(),
    email: alEmail.value.trim(),
    fecha_ingreso: alFecha.value || hoyISO(),
    estado: alEstado.value
  };

  if (!payload.nombre || !payload.documento) {
    msgAlumno.textContent = "Nombre y documento son obligatorios";
    msgAlumno.className = "text-danger small";
    return;
  }

  try {
    msgAlumno.textContent = "Guardando...";
    msgAlumno.className = "text-muted small";

    await fetchJSON("/api/alumnos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    msgAlumno.textContent = "Alumno registrado correctamente";
    msgAlumno.className = "text-success small";

    formAlumno.reset();
    alEstado.value = "Activo";
    await cargarAlumnos();

    setTimeout(() => {
      bootstrap.Modal.getInstance(
        document.getElementById("modalAlumno")
      )?.hide();
      msgAlumno.textContent = "";
    }, 700);

  } catch (err) {
    console.error(err);
    msgAlumno.textContent = "Error al registrar alumno";
    msgAlumno.className = "text-danger small";
  }
});

// =====================================
// INSCRIPCIÓN POR CI
// =====================================
btnBuscarAlumnoCI.addEventListener("click", buscarAlumnoPorCI);

async function buscarAlumnoPorCI() {
  const ci = inscDocumento.value.trim();
  if (!ci) return;

  try {
    const res = await fetchJSON(`/api/alumnos/search?q=${encodeURIComponent(ci)}`);
    if (!res.length) {
      msgInscribir.textContent = "Alumno no encontrado";
      msgInscribir.className = "text-danger small";
      return;
    }

    alumnoSeleccionado = res[0];
    inscAlumnoId.value = alumnoSeleccionado.id;
    inscAlumnoNombre.textContent = alumnoSeleccionado.nombre;
    inscAlumnoInfo.textContent = `CI: ${alumnoSeleccionado.documento}`;

    await cargarCursosDisponibles();

  } catch (err) {
    console.error(err);
    msgInscribir.textContent = "Error al buscar alumno";
    msgInscribir.className = "text-danger small";
  }
}

async function cargarCursosDisponibles() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    const disponibles = cursos.filter(c =>
      c.estado === "Programado" || c.estado === "En curso"
    );

    inscCursoId.innerHTML = disponibles.length
      ? disponibles.map(c =>
          `<option value="${c.id}">${esc(c.nombre)}</option>`
        ).join("")
      : `<option value="">No hay cursos disponibles</option>`;

  } catch (err) {
    console.error(err);
    inscCursoId.innerHTML =
      `<option value="">Error al cargar cursos</option>`;
  }
}

// =====================================
// GUARDAR INSCRIPCIÓN
// =====================================
formInscribir.addEventListener("submit", async e => {
  e.preventDefault();

  const payload = {
    alumno_id: Number(inscAlumnoId.value),
    curso_id: Number(inscCursoId.value),
    estado: inscEstado.value
  };

  if (!payload.alumno_id || !payload.curso_id) {
    msgInscribir.textContent = "Datos incompletos";
    msgInscribir.className = "text-danger small";
    return;
  }

  try {
    msgInscribir.textContent = "Guardando...";
    msgInscribir.className = "text-muted small";

    await fetchJSON("/api/inscripciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    msgInscribir.textContent = "Alumno inscrito correctamente";
    msgInscribir.className = "text-success small";

    setTimeout(() => {
      bootstrap.Modal.getInstance(
        document.getElementById("modalInscribirGlobal")
      )?.hide();
      msgInscribir.textContent = "";
    }, 800);

  } catch (err) {
    console.error(err);
    msgInscribir.textContent = "Error al inscribir alumno";
    msgInscribir.className = "text-danger small";
  }
});

// =====================================
document.addEventListener("DOMContentLoaded", () => cargarAlumnos());

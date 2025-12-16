// =====================================
// helpers
// =====================================
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function formateaFecha(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = String(s).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
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

// INSCRIPCIÓN GLOBAL (tu modal nuevo)
const formInscribirG = document.getElementById("formInscribirGlobal");
const msgInscribirG = document.getElementById("msgInscribirGlobal");
const inscGDocumento = document.getElementById("inscGDocumento");
const btnBuscarAlumnoCI = document.getElementById("btnBuscarAlumnoCI");
const inscGAlumnoId = document.getElementById("inscGAlumnoId");
const inscGAlumnoNombre = document.getElementById("inscGAlumnoNombre");
const inscGAlumnoInfo = document.getElementById("inscGAlumnoInfo");
const inscGCursoId = document.getElementById("inscGCursoId");
const inscGEstado = document.getElementById("inscGEstado");

// EDITAR (si existe modal)
const formAlumnoEdit = document.getElementById("formAlumnoEdit");
const msgEditAlumno = document.getElementById("msgEditAlumno");
const editId = document.getElementById("editId");
const editNombre = document.getElementById("editNombre");
const editDocumento = document.getElementById("editDocumento");
const editTelefono = document.getElementById("editTelefono");
const editEmail = document.getElementById("editEmail");
const editFecha = document.getElementById("editFecha");
const editEstado = document.getElementById("editEstado");

let alumnosCache = [];

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
      <td>${esc(a.documento || "")}</td>
      <td>${esc(a.telefono || "")}</td>
      <td>${esc(a.email || "")}</td>
      <td>${esc(a.fecha_ingreso || "")}</td>
      <td>
        <span class="badge ${String(a.estado) === "Inactivo" ? "bg-secondary" : "bg-success"}">
          ${esc(a.estado || "Activo")}
        </span>
      </td>
      <td>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary btn-sm"
            onclick="abrirEditarAlumno(${a.id})">
            Editar
          </button>
          <button class="btn btn-outline-primary btn-sm"
            onclick="abrirInscribirAlumno(${a.id})">
            Inscribir
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  lblResumen.textContent = `${rows.length} alumno${rows.length !== 1 ? "s" : ""}`;
}

// =====================================
// BUSCAR
// =====================================
btnBuscar?.addEventListener("click", () => cargarAlumnos(inputBuscar.value));
inputBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarAlumnos(inputBuscar.value);
  }
});

// =====================================
// CREAR ALUMNO
// =====================================
formAlumno?.addEventListener("submit", async e => {
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

    msgAlumno.textContent = "Alumno registrado";
    msgAlumno.className = "text-success small";

    formAlumno.reset();
    alEstado.value = "Activo";
    await cargarAlumnos();

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalAlumno"))?.hide();
      msgAlumno.textContent = "";
    }, 700);

  } catch (err) {
    console.error(err);
    msgAlumno.textContent = "Error al registrar";
    msgAlumno.className = "text-danger small";
  }
});

// =====================================
// EDITAR ALUMNO (requiere API PUT /api/alumnos/:id)
// =====================================
window.abrirEditarAlumno = function (id) {
  const a = alumnosCache.find(x => Number(x.id) === Number(id));
  if (!a) return alert("Alumno no encontrado");

  if (!formAlumnoEdit) {
    return alert("Falta el modal de editar (modalAlumnoEdit + formAlumnoEdit).");
  }

  editId.value = a.id ?? "";
  editNombre.value = a.nombre ?? "";
  editDocumento.value = a.documento ?? "";
  editTelefono.value = a.telefono ?? "";
  editEmail.value = a.email ?? "";
  editFecha.value = (a.fecha_ingreso || "").slice(0, 10);
  editEstado.value = a.estado ?? "Activo";

  msgEditAlumno.textContent = "";
  msgEditAlumno.className = "text-muted small";

  new bootstrap.Modal(document.getElementById("modalAlumnoEdit")).show();
};

formAlumnoEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = Number(editId.value);
  const payload = {
    nombre: editNombre.value.trim(),
    documento: editDocumento.value.trim(),
    telefono: editTelefono.value.trim(),
    email: editEmail.value.trim(),
    fecha_ingreso: editFecha.value || null,
    estado: editEstado.value
  };

  try {
    msgEditAlumno.textContent = "Guardando...";
    msgEditAlumno.className = "text-muted small";

    await fetchJSON(`/api/alumnos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    msgEditAlumno.textContent = "Actualizado.";
    msgEditAlumno.className = "text-success small";

    await cargarAlumnos(inputBuscar?.value || "");

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalAlumnoEdit"))?.hide();
      msgEditAlumno.textContent = "";
    }, 700);

  } catch (err) {
    console.error(err);
    msgEditAlumno.textContent = "Error al guardar (falta backend PUT).";
    msgEditAlumno.className = "text-danger small";
  }
});

// =====================================
// INSCRIBIR DESDE FILA (abre modal global y rellena CI)
// =====================================
window.abrirInscribirAlumno = async function (id) {
  const a = alumnosCache.find(x => Number(x.id) === Number(id));
  if (!a) return alert("Alumno no encontrado");

  // rellenar CI
  inscGDocumento.value = a.documento || "";
  // limpiar info
  inscGAlumnoId.value = a.id || "";
  inscGAlumnoNombre.textContent = a.nombre || "Alumno: —";
  inscGAlumnoInfo.textContent = `CI: ${a.documento || "—"}`;
  inscGEstado.value = "Activa";
  msgInscribirG.textContent = "";
  msgInscribirG.className = "text-muted small";

  // cargar cursos disponibles
  await cargarCursosDisponibles();

  new bootstrap.Modal(document.getElementById("modalInscribirGlobal")).show();
};

// =====================================
// INSCRIPCIÓN GLOBAL POR CI
// =====================================
btnBuscarAlumnoCI?.addEventListener("click", buscarAlumnoPorCI);

async function buscarAlumnoPorCI() {
  const ci = (inscGDocumento.value || "").trim();
  if (!ci) return;

  try {
    const res = await fetchJSON(`/api/alumnos/search?q=${encodeURIComponent(ci)}`);
    const rows = Array.isArray(res) ? res : [];
    if (!rows.length) {
      msgInscribirG.textContent = "Alumno no encontrado";
      msgInscribirG.className = "text-danger small";
      return;
    }

    const a = rows[0];
    inscGAlumnoId.value = a.id;
    inscGAlumnoNombre.textContent = a.nombre;
    inscGAlumnoInfo.textContent = `CI: ${a.documento || ""}`;

    msgInscribirG.textContent = "";
    msgInscribirG.className = "text-muted small";

    await cargarCursosDisponibles();

  } catch (err) {
    console.error(err);
    msgInscribirG.textContent = "Error al buscar alumno";
    msgInscribirG.className = "text-danger small";
  }
}

async function cargarCursosDisponibles() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    const rows = Array.isArray(cursos) ? cursos : [];

    // disponibles = Programado o En curso
    const disponibles = rows.filter(c =>
      c.estado === "Programado" || c.estado === "En curso"
    );

    inscGCursoId.innerHTML = disponibles.length
      ? disponibles.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
      : `<option value="">No hay cursos disponibles</option>`;
  } catch (err) {
    console.error(err);
    inscGCursoId.innerHTML = `<option value="">Error al cargar cursos</option>`;
  }
}

formInscribirG?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    alumno_id: Number(inscGAlumnoId.value),
    curso_id: Number(inscGCursoId.value),
    estado: inscGEstado.value
  };

  if (!payload.alumno_id || !payload.curso_id) {
    msgInscribirG.textContent = "Completa alumno y curso";
    msgInscribirG.className = "text-danger small";
    return;
  }

  try {
    msgInscribirG.textContent = "Guardando...";
    msgInscribirG.className = "text-muted small";

    await fetchJSON("/api/inscripciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    msgInscribirG.textContent = "Inscripción guardada";
    msgInscribirG.className = "text-success small";

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalInscribirGlobal"))?.hide();
      msgInscribirG.textContent = "";
    }, 800);

  } catch (err) {
    console.error(err);
    msgInscribirG.textContent = "Error al inscribir (falta backend inscripciones)";
    msgInscribirG.className = "text-danger small";
  }
});

// =====================================
document.addEventListener("DOMContentLoaded", () => cargarAlumnos());

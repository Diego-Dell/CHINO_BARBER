// public/js/alumnos.js

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);
  if (r.status === 401) return (window.location.href = "/login.html");
  if (!r.ok) throw new Error(await r.text());
  const ct = (r.headers.get("content-type") || "");
  return ct.includes("application/json") ? r.json() : r.text();
}

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

// Modal Edit (si existe en tu HTML)
const formEdit = document.getElementById("formAlumnoEdit");
const msgEdit = document.getElementById("msgEditAlumno");

let alumnosCache = [];

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
}

function formateaFecha(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y,m,d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}

function renderTabla(rows) {
  if (!rows.length) {
    tablaBody.innerHTML = `<tr><td colspan="8" class="text-center py-3 text-muted">Sin registros</td></tr>`;
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
      <td>${formateaFecha(a.fecha_ingreso)}</td>
      <td>
        <span class="badge ${a.estado === "Inactivo" ? "bg-secondary" : "bg-success"}">${esc(a.estado)}</span>
      </td>
      <td>
        ${formEdit ? `
          <button class="btn btn-outline-primary btn-sm" onclick="abrirEditarAlumno(${a.id})">Editar</button>
        ` : `
          <button class="btn btn-outline-secondary btn-sm" disabled>Editar</button>
        `}
      </td>
    </tr>
  `).join("");

  lblResumen.textContent = `${rows.length} alumno${rows.length !== 1 ? "s" : ""}`;
}

async function cargarAlumnos(q = "") {
  try {
    let url = "/api/alumnos";
    if (q.trim()) url = `/api/alumnos/search?q=${encodeURIComponent(q.trim())}`;
    const data = await fetchJSON(url);
    alumnosCache = Array.isArray(data) ? data : [];
    renderTabla(alumnosCache);
  } catch (e) {
    console.error(e);
    tablaBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error al cargar.</td></tr>`;
    lblResumen.textContent = "0 alumnos";
  }
}

// Buscar
btnBuscar?.addEventListener("click", () => cargarAlumnos(inputBuscar.value));
inputBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarAlumnos(inputBuscar.value);
  }
});

// Crear
formAlumno?.addEventListener("submit", async e => {
  e.preventDefault();

  const payload = {
    nombre: alNombre.value.trim(),
    documento: alDocumento.value.trim(),
    telefono: alTelefono.value.trim(),
    email: alEmail.value.trim(),
    fecha_ingreso: alFecha.value || null,
    estado: alEstado.value
  };

  try {
    msgAlumno.textContent = "Guardando...";
    msgAlumno.className = "text-muted";

    await fetchJSON("/api/alumnos", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });

    msgAlumno.textContent = "Alumno registrado.";
    msgAlumno.className = "text-success";

    formAlumno.reset();
    alEstado.value = "Activo";
    await cargarAlumnos();

    setTimeout(() => {
      const modalEl = document.getElementById("modalAlumno");
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      msgAlumno.textContent = "";
    }, 700);

  } catch (err) {
    msgAlumno.textContent = (err.message || "Error al guardar.");
    msgAlumno.className = "text-danger";
  }
});

// Editar (si tu HTML tiene modal edit)
window.abrirEditarAlumno = function (id) {
  const a = alumnosCache.find(x => Number(x.id) === Number(id));
  if (!a) return alert("Alumno no encontrado");

  // ids esperados del modal edit
  const editId = document.getElementById("editId");
  const editNombre = document.getElementById("editNombre");
  const editDocumento = document.getElementById("editDocumento");
  const editTelefono = document.getElementById("editTelefono");
  const editEmail = document.getElementById("editEmail");
  const editFecha = document.getElementById("editFecha");
  const editEstado = document.getElementById("editEstado");

  if (!editId) return alert("Modal de edición no existe en este HTML.");

  editId.value = a.id;
  editNombre.value = a.nombre || "";
  editDocumento.value = a.documento || "";
  editTelefono.value = a.telefono || "";
  if (editEmail) editEmail.value = a.email || "";
  if (editFecha) editFecha.value = (a.fecha_ingreso || "").slice(0,10);
  editEstado.value = a.estado || "Activo";

  msgEdit.textContent = "";
  new bootstrap.Modal(document.getElementById("modalAlumnoEdit")).show();
};

formEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const editId = document.getElementById("editId");
  const editNombre = document.getElementById("editNombre");
  const editDocumento = document.getElementById("editDocumento");
  const editTelefono = document.getElementById("editTelefono");
  const editEmail = document.getElementById("editEmail");
  const editFecha = document.getElementById("editFecha");
  const editEstado = document.getElementById("editEstado");

  const id = Number(editId.value);

  const payload = {
    nombre: editNombre.value.trim(),
    documento: editDocumento.value.trim(),
    telefono: editTelefono.value.trim(),
    email: editEmail ? editEmail.value.trim() : "",
    fecha_ingreso: editFecha ? (editFecha.value || null) : null,
    estado: editEstado.value
  };

  try {
    msgEdit.textContent = "Guardando...";
    msgEdit.className = "text-muted small";

    await fetchJSON(`/api/alumnos/${id}`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });

    msgEdit.textContent = "Actualizado.";
    msgEdit.className = "text-success small";

    await cargarAlumnos();

    setTimeout(() => bootstrap.Modal.getInstance(document.getElementById("modalAlumnoEdit"))?.hide(), 500);
  } catch (err) {
    console.error(err);
    msgEdit.textContent = err.message || "No se pudo guardar.";
    msgEdit.className = "text-danger small";
  }
});

document.addEventListener("DOMContentLoaded", () => cargarAlumnos());

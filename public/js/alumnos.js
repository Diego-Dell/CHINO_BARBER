// alumnos.js (frontend)
// ✅ SIN LOGIN / SIN SESIÓN: fetchJSON no fuerza redirects ni usa credentials.
// ✅ Limpio para copiar/pegar.

async function fetchJSON(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `HTTP ${r.status}`);
  }

  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
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

// INSCRIPCIÓN GLOBAL (modal)
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
    if (!tablaBody) return;

    let url = "/api/alumnos";
    if (q.trim()) url = `/api/alumnos/search?q=${encodeURIComponent(q)}`;

    const data = await fetchJSON(url);

    // ✅ Soporta:
    // - backend que devuelve array directo: [...]
    // - backend que devuelve { ok:true, items:[...] }
    // - backend que devuelve { items:[...] }
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
      ? data.items
      : [];

    alumnosCache = items;
    renderTabla(alumnosCache);

    if (lblResumen) lblResumen.textContent = `${alumnosCache.length} alumnos`;
  } catch (e) {
    console.error(e);
    if (tablaBody) {
      tablaBody.innerHTML =
        `<tr><td colspan="8" class="text-center text-danger">Error al cargar alumnos</td></tr>`;
    }
    if (lblResumen) lblResumen.textContent = "0 alumnos";
  }
}


// =====================================
// RENDER TABLA
// =====================================
function renderTabla(rows) {
  if (!tablaBody) return;

  if (!rows.length) {
    tablaBody.innerHTML =
      `<tr><td colspan="8" class="text-center text-muted">Sin alumnos registrados</td></tr>`;
    if (lblResumen) lblResumen.textContent = "0 alumnos";
    return;
  }

  tablaBody.innerHTML = rows
    .map(
      (a) => `
    <tr>
      <td>${a.id}</td>
      <td class="fw-semibold">${esc(a.nombre)}</td>
      <td>${esc(a.documento || "")}</td>
      <td>${esc(a.telefono || "")}</td>
      <td>${esc(a.email || "")}</td>
      <td>${esc(formateaFecha(a.fecha_ingreso || ""))}</td>
      <td>
        <span class="badge ${String(a.estado) === "Inactivo" ? "bg-secondary" : "bg-success"}">
          ${esc(a.estado || "Activo")}
        </span>
      </td>
      <td>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary btn-sm" onclick="abrirEditarAlumno(${a.id})">
            Editar
          </button>
          <button class="btn btn-outline-primary btn-sm" onclick="abrirInscribirAlumno(${a.id})">
            Inscribir
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  if (lblResumen) lblResumen.textContent = `${rows.length} alumno${rows.length !== 1 ? "s" : ""}`;
}

// =====================================
// BUSCAR
// =====================================
btnBuscar?.addEventListener("click", () => cargarAlumnos(inputBuscar?.value || ""));
inputBuscar?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarAlumnos(inputBuscar?.value || "");
  }
});

// =====================================
// CREAR ALUMNO
// =====================================
formAlumno?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nombre: alNombre?.value?.trim() || "",
    documento: alDocumento?.value?.trim() || "",
    telefono: alTelefono?.value?.trim() || "",
    email: alEmail?.value?.trim() || "",
    fecha_ingreso: alFecha?.value || hoyISO(),
    estado: alEstado?.value || "Activo",
  };

  if (!payload.nombre || !payload.documento) {
    if (msgAlumno) {
      msgAlumno.textContent = "Nombre y documento son obligatorios";
      msgAlumno.className = "text-danger small";
    }
    return;
  }

  try {
    if (msgAlumno) {
      msgAlumno.textContent = "Guardando...";
      msgAlumno.className = "text-muted small";
    }

    await fetchJSON("/api/alumnos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (msgAlumno) {
      msgAlumno.textContent = "Alumno registrado";
      msgAlumno.className = "text-success small";
    }

    formAlumno.reset();
    if (alEstado) alEstado.value = "Activo";
    await cargarAlumnos();

    setTimeout(() => {
      const m = document.getElementById("modalAlumno");
      if (m && window.bootstrap?.Modal) window.bootstrap.Modal.getInstance(m)?.hide();
      if (msgAlumno) msgAlumno.textContent = "";
    }, 700);
  } catch (err) {
    console.error(err);
    if (msgAlumno) {
      msgAlumno.textContent = "Error al registrar";
      msgAlumno.className = "text-danger small";
    }
  }
});

// =====================================
// EDITAR ALUMNO (requiere API PUT /api/alumnos/:id)
// =====================================
window.abrirEditarAlumno = function (id) {
  const a = alumnosCache.find((x) => Number(x.id) === Number(id));
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

  if (msgEditAlumno) {
    msgEditAlumno.textContent = "";
    msgEditAlumno.className = "text-muted small";
  }

  const modal = document.getElementById("modalAlumnoEdit");
  if (modal && window.bootstrap?.Modal) new window.bootstrap.Modal(modal).show();
};

formAlumnoEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = Number(editId?.value);
  const payload = {
    nombre: editNombre?.value?.trim() || "",
    documento: editDocumento?.value?.trim() || "",
    telefono: editTelefono?.value?.trim() || "",
    email: editEmail?.value?.trim() || "",
    fecha_ingreso: editFecha?.value || null,
    estado: editEstado?.value || "Activo",
  };

  try {
    if (msgEditAlumno) {
      msgEditAlumno.textContent = "Guardando...";
      msgEditAlumno.className = "text-muted small";
    }

    await fetchJSON(`/api/alumnos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (msgEditAlumno) {
      msgEditAlumno.textContent = "Actualizado.";
      msgEditAlumno.className = "text-success small";
    }

    await cargarAlumnos(inputBuscar?.value || "");

    setTimeout(() => {
      const m = document.getElementById("modalAlumnoEdit");
      if (m && window.bootstrap?.Modal) window.bootstrap.Modal.getInstance(m)?.hide();
      if (msgEditAlumno) msgEditAlumno.textContent = "";
    }, 700);
  } catch (err) {
    console.error(err);
    if (msgEditAlumno) {
      msgEditAlumno.textContent = "Error al guardar (revisa backend PUT).";
      msgEditAlumno.className = "text-danger small";
    }
  }
});

// =====================================
// INSCRIBIR DESDE FILA (abre modal global y rellena CI)
// =====================================
window.abrirInscribirAlumno = async function (id) {
  const a = alumnosCache.find((x) => Number(x.id) === Number(id));
  if (!a) return alert("Alumno no encontrado");

  if (inscGDocumento) inscGDocumento.value = a.documento || "";

  if (inscGAlumnoId) inscGAlumnoId.value = a.id || "";
  if (inscGAlumnoNombre) inscGAlumnoNombre.textContent = a.nombre || "Alumno: —";
  if (inscGAlumnoInfo) inscGAlumnoInfo.textContent = `CI: ${a.documento || "—"}`;
  if (inscGEstado) inscGEstado.value = "Activa";

  if (msgInscribirG) {
    msgInscribirG.textContent = "";
    msgInscribirG.className = "text-muted small";
  }

  await cargarCursosDisponibles();

  const modal = document.getElementById("modalInscribirGlobal");
  if (modal && window.bootstrap?.Modal) new window.bootstrap.Modal(modal).show();
};

// =====================================
// INSCRIPCIÓN GLOBAL POR CI
// =====================================
btnBuscarAlumnoCI?.addEventListener("click", buscarAlumnoPorCI);

async function buscarAlumnoPorCI() {
  const ci = (inscGDocumento?.value || "").trim();
  if (!ci) return;

  try {
    // si tienes endpoint directo, usamos ese (más seguro que search)
    const a = await fetchJSON(`/api/alumnos/by-documento/${encodeURIComponent(ci)}`);

    if (!a) {
      if (msgInscribirG) {
        msgInscribirG.textContent = "Alumno no encontrado";
        msgInscribirG.className = "text-danger small";
      }
      return;
    }

    if (inscGAlumnoId) inscGAlumnoId.value = a.id;
    if (inscGAlumnoNombre) inscGAlumnoNombre.textContent = a.nombre || "—";
    if (inscGAlumnoInfo) inscGAlumnoInfo.textContent = `CI: ${a.documento || ""}`;

    if (msgInscribirG) {
      msgInscribirG.textContent = "";
      msgInscribirG.className = "text-muted small";
    }

    await cargarCursosDisponibles();
  } catch (err) {
    console.error(err);
    if (msgInscribirG) {
      msgInscribirG.textContent = "Error al buscar alumno";
      msgInscribirG.className = "text-danger small";
    }
  }
}

async function cargarCursosDisponibles() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    const rows = Array.isArray(cursos) ? cursos : [];

    const disponibles = rows.filter((c) => c.estado === "Programado" || c.estado === "En curso");

    if (!inscGCursoId) return;

    inscGCursoId.innerHTML = disponibles.length
      ? disponibles.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
      : `<option value="">No hay cursos disponibles</option>`;
  } catch (err) {
    console.error(err);
    if (inscGCursoId) inscGCursoId.innerHTML = `<option value="">Error al cargar cursos</option>`;
  }
}

formInscribirG?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    alumno_id: Number(inscGAlumnoId?.value),
    curso_id: Number(inscGCursoId?.value),
    estado: inscGEstado?.value || "Activa",
  };

  if (!payload.alumno_id || !payload.curso_id) {
    if (msgInscribirG) {
      msgInscribirG.textContent = "Completa alumno y curso";
      msgInscribirG.className = "text-danger small";
    }
    return;
  }

  try {
    if (msgInscribirG) {
      msgInscribirG.textContent = "Guardando...";
      msgInscribirG.className = "text-muted small";
    }

    await fetchJSON("/api/inscripciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (msgInscribirG) {
      msgInscribirG.textContent = "Inscripción guardada";
      msgInscribirG.className = "text-success small";
    }

    setTimeout(() => {
      const m = document.getElementById("modalInscribirGlobal");
      if (m && window.bootstrap?.Modal) window.bootstrap.Modal.getInstance(m)?.hide();
      if (msgInscribirG) msgInscribirG.textContent = "";
    }, 800);
} catch (err) {
  console.error(err);

  const msg = String(err.message || "");

  if (msg.includes("Cupo lleno")) {
    msgInscribirG.textContent = "Cupo lleno. Ya no hay espacios en este curso.";
    msgInscribirG.className = "text-warning small";
    return;
  }

  if (msg.includes("Ya inscrito")) {
    msgInscribirG.textContent = "Este alumno ya está inscrito en este curso.";
    msgInscribirG.className = "text-warning small";
    return;
  }

  msgInscribirG.textContent = "No se pudo inscribir. Intenta nuevamente.";
  msgInscribirG.className = "text-danger small";
}

});

// =====================================
document.addEventListener("DOMContentLoaded", () => cargarAlumnos());

// public/js/instructores.js  (UNIFICADO + ERD + SESION)

// ---------- helpers ----------
async function fetchJSON(url, options = {}) {
  options.credentials = "include"; // ✅ manda cookie de sesión
  const r = await fetch(url, options);

  if (r.status === 401) {
    window.location.href = "/login.html";
    return;
  }

  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function badgeEstado(estado) {
  return String(estado || "Activo") === "Activo" ? "bg-success" : "bg-secondary";
}

// Lee inputs opcionales del ERD si existen en el HTML
function getOptValue(id) {
  return (document.getElementById(id)?.value ?? "").toString().trim();
}
function getOptDate(id) {
  const v = (document.getElementById(id)?.value ?? "").toString().trim();
  return v || null;
}

// ---------- DOM ----------
const tablaBody = document.querySelector("#tablaInstructores tbody");

// filtros (pueden o no existir)
const instBuscar = document.getElementById("instBuscar");
const instEstado = document.getElementById("instEstado");
const instResumen = document.getElementById("instResumen");
const btnFiltrarInst = document.getElementById("btnFiltrarInst");
const btnRefrescarInstr = document.getElementById("btnRefrescarInstr");

// crear
const formInst = document.getElementById("formInst");
const msgInst = document.getElementById("msgInst");
const instNombre = document.getElementById("instNombre");
const instCI = document.getElementById("instCI");
const instTel = document.getElementById("instTel");
const instEmail = document.getElementById("instEmail");
const instEstadoForm = document.getElementById("instEstadoForm");

// editar modal nuevo: modalInstEdit
const formInstEdit = document.getElementById("formInstEdit");
const msgInstEdit = document.getElementById("msgInstEdit");
const editId = document.getElementById("editId");
const editNombre = document.getElementById("editNombre");
const editCI = document.getElementById("editCI");
const editTel = document.getElementById("editTel");
const editEmail = document.getElementById("editEmail");
const editEstado = document.getElementById("editEstado");

// editar modal original: modalInstrEdit
const formInstrEdit = document.getElementById("formInstrEdit");
const msgEditInstr = document.getElementById("msgEditInstr");
const iEditId = document.getElementById("iEditId");
const iEditNombre = document.getElementById("iEditNombre");
const iEditDocumento = document.getElementById("iEditDocumento");
const iEditTelefono = document.getElementById("iEditTelefono");
const iEditEmail = document.getElementById("iEditEmail");
const iEditEstado = document.getElementById("iEditEstado");

let instructoresCache = [];

// ---------- filtros ----------
function aplicarFiltrosLocal(rows) {
  const q = (instBuscar?.value || "").trim().toLowerCase();
  const est = (instEstado?.value || "").trim();

  return rows.filter(i => {
    const okQ =
      !q ||
      String(i.nombre || "").toLowerCase().includes(q) ||
      String(i.documento || "").toLowerCase().includes(q);

    const okE = !est || String(i.estado || "") === est;
    return okQ && okE;
  });
}

// ---------- render ----------
function renderInstructores(rows) {
  if (!tablaBody) return;

  if (!rows.length) {
    tablaBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Sin instructores registrados.</td></tr>`;
    if (instResumen) instResumen.textContent = "0 instructores";
    return;
  }

  tablaBody.innerHTML = rows.map(inst => `
    <tr>
      <td>${inst.id}</td>
      <td class="fw-semibold">${esc(inst.nombre)}</td>
      <td>${esc(inst.documento || "")}</td>
      <td>${esc(inst.telefono || "")}</td>
      <td>${esc(inst.email || "")}</td>
      <td><span class="badge ${badgeEstado(inst.estado)}">${esc(inst.estado || "Activo")}</span></td>
      <td>
        <button type="button" class="btn btn-outline-primary btn-sm" onclick="editarInstructor(${inst.id})">
          Editar
        </button>
      </td>
    </tr>
  `).join("");

  if (instResumen) instResumen.textContent = `${rows.length} instructor${rows.length !== 1 ? "es" : ""}`;
}

// ---------- cargar ----------
async function cargarInstructores() {
  try {
    const params = new URLSearchParams();
    const q = (instBuscar?.value || "").trim();
    const estado = instEstado?.value || "";

    if (q) params.append("q", q);
    if (estado) params.append("estado", estado);

    let url = "/api/instructores";
    const qs = params.toString();
    if (qs) url += "?" + qs;

    const data = await fetchJSON(url);
    instructoresCache = Array.isArray(data) ? data : [];

    const rows = aplicarFiltrosLocal(instructoresCache);
    renderInstructores(rows);
  } catch (e) {
    console.error(e);
    if (tablaBody) {
      tablaBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error al cargar instructores.</td></tr>`;
    }
    if (instResumen) instResumen.textContent = "0 instructores";
  }
}

// ---------- abrir modal editar (unificado) ----------
window.editarInstructor = function (id) {
  const inst = instructoresCache.find(i => Number(i.id) === Number(id));
  if (!inst) return alert("Instructor no encontrado");

  // Preferimos modal nuevo
  if (formInstEdit && editId) {
    editId.value = inst.id ?? "";
    editNombre.value = inst.nombre ?? "";
    editCI.value = inst.documento ?? "";
    editTel.value = inst.telefono ?? "";
    editEmail.value = inst.email ?? "";
    editEstado.value = inst.estado ?? "Activo";

    // ERD opcionales (si existen inputs en el modal)
    const eEsp = document.getElementById("editEspecialidad");
    const eFec = document.getElementById("editFechaAlta");
    if (eEsp) eEsp.value = inst.especialidad ?? "";
    if (eFec) eFec.value = (inst.fecha_alta || "").slice(0, 10);

    if (msgInstEdit) {
      msgInstEdit.textContent = "";
      msgInstEdit.className = "text-muted small";
    }

    new bootstrap.Modal(document.getElementById("modalInstEdit")).show();
    return;
  }

  // Si no, modal original
  if (formInstrEdit && iEditId) {
    iEditId.value = inst.id ?? "";
    iEditNombre.value = inst.nombre ?? "";
    iEditDocumento.value = inst.documento ?? "";
    iEditTelefono.value = inst.telefono ?? "";
    iEditEmail.value = inst.email ?? "";
    iEditEstado.value = inst.estado ?? "Activo";

    // ERD opcionales (si existen inputs en el modal original)
    const oEsp = document.getElementById("iEditEspecialidad");
    const oFec = document.getElementById("iEditFechaAlta");
    if (oEsp) oEsp.value = inst.especialidad ?? "";
    if (oFec) oFec.value = (inst.fecha_alta || "").slice(0, 10);

    if (msgEditInstr) {
      msgEditInstr.textContent = "";
      msgEditInstr.className = "text-muted small";
    }

    new bootstrap.Modal(document.getElementById("modalInstrEdit")).show();
    return;
  }

  alert("No existe modal de edición en este HTML.");
};

// alias por compatibilidad
window.abrirEditarInstr = (id) => window.editarInstructor(id);

// ---------- crear instructor ----------
if (formInst) {
  formInst.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      nombre: instNombre?.value.trim() || "",
      documento: instCI?.value.trim() || "",
      telefono: instTel?.value.trim() || "",
      email: instEmail?.value.trim() || "",
      especialidad: getOptValue("instEspecialidad"),     // ✅ ERD opcional
      fecha_alta: getOptDate("instFechaAlta"),           // ✅ ERD opcional
      estado: instEstadoForm?.value || "Activo"
    };

    if (!payload.nombre || !payload.documento) {
      if (msgInst) {
        msgInst.textContent = "Nombre y CI son obligatorios.";
        msgInst.className = "text-danger small";
      }
      return;
    }

    try {
      if (msgInst) {
        msgInst.textContent = "Guardando...";
        msgInst.className = "text-muted small";
      }

      await fetchJSON("/api/instructores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (msgInst) {
        msgInst.textContent = "Instructor registrado.";
        msgInst.className = "text-success small";
      }

      formInst.reset();
      if (instEstadoForm) instEstadoForm.value = "Activo";

      await cargarInstructores();

      setTimeout(() => {
        const modalEl = document.getElementById("modalInstructor");
        bootstrap.Modal.getInstance(modalEl)?.hide();
        if (msgInst) msgInst.textContent = "";
      }, 700);

    } catch (err) {
      console.error(err);
      if (msgInst) {
        msgInst.textContent = err.message || "Error al registrar.";
        msgInst.className = "text-danger small";
      }
    }
  });
}

// ---------- guardar edición (modal nuevo) ----------
if (formInstEdit) {
  formInstEdit.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = Number(editId?.value);

    const payload = {
      nombre: editNombre?.value.trim() || "",
      documento: editCI?.value.trim() || "",
      telefono: editTel?.value.trim() || "",
      email: editEmail?.value.trim() || "",
      especialidad: getOptValue("editEspecialidad"), // ✅ ERD opcional
      fecha_alta: getOptDate("editFechaAlta"),       // ✅ ERD opcional
      estado: editEstado?.value || "Activo"
    };

    if (!payload.nombre || !payload.documento) {
      if (msgInstEdit) {
        msgInstEdit.textContent = "Nombre y CI son obligatorios.";
        msgInstEdit.className = "text-danger small";
      }
      return;
    }

    try {
      if (msgInstEdit) {
        msgInstEdit.textContent = "Guardando...";
        msgInstEdit.className = "text-muted small";
      }

      await fetchJSON(`/api/instructores/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      await cargarInstructores();

      if (msgInstEdit) {
        msgInstEdit.textContent = "Actualizado.";
        msgInstEdit.className = "text-success small";
      }

      setTimeout(() => {
        bootstrap.Modal.getInstance(document.getElementById("modalInstEdit"))?.hide();
        if (msgInstEdit) msgInstEdit.textContent = "";
      }, 500);

    } catch (err) {
      console.error(err);
      if (msgInstEdit) {
        msgInstEdit.textContent = err.message || "No se pudo guardar.";
        msgInstEdit.className = "text-danger small";
      }
    }
  });
}

// ---------- guardar edición (modal original) ----------
if (formInstrEdit) {
  formInstrEdit.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = Number(iEditId?.value);

    const payload = {
      nombre: iEditNombre?.value.trim() || "",
      documento: iEditDocumento?.value.trim() || "",
      telefono: iEditTelefono?.value.trim() || "",
      email: iEditEmail?.value.trim() || "",
      especialidad: getOptValue("iEditEspecialidad"), // ✅ ERD opcional
      fecha_alta: getOptDate("iEditFechaAlta"),       // ✅ ERD opcional
      estado: iEditEstado?.value || "Activo"
    };

    if (!payload.nombre || !payload.documento) {
      if (msgEditInstr) {
        msgEditInstr.textContent = "Nombre y CI son obligatorios.";
        msgEditInstr.className = "text-danger small";
      }
      return;
    }

    try {
      if (msgEditInstr) {
        msgEditInstr.textContent = "Guardando...";
        msgEditInstr.className = "text-muted small";
      }

      await fetchJSON(`/api/instructores/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      await cargarInstructores();

      if (msgEditInstr) {
        msgEditInstr.textContent = "Actualizado.";
        msgEditInstr.className = "text-success small";
      }

      setTimeout(() => {
        bootstrap.Modal.getInstance(document.getElementById("modalInstrEdit"))?.hide();
      }, 500);

    } catch (err) {
      console.error(err);
      if (msgEditInstr) {
        msgEditInstr.textContent = err.message || "No se pudo guardar.";
        msgEditInstr.className = "text-danger small";
      }
    }
  });
}

// ---------- eventos ----------
instBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInstructores();
  }
});
btnFiltrarInst?.addEventListener("click", cargarInstructores);
btnRefrescarInstr?.addEventListener("click", cargarInstructores);

document.addEventListener("DOMContentLoaded", cargarInstructores);

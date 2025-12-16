// ======================================================
// INSTRUCTORES — Barber Chino
// ======================================================

// ---------------- helpers ----------------
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]
  ));
}

function badgeEstado(estado) {
  return estado === "Inactivo" ? "bg-secondary" : "bg-success";
}

// ---------------- DOM ----------------
const tablaBody = document.querySelector("#tablaInstructores tbody");
const lblResumen = document.getElementById("instResumen");

const instBuscar = document.getElementById("instBuscar");
const instEstado = document.getElementById("instEstado");
const btnFiltrar = document.getElementById("btnFiltrarInst");
const btnRefrescar = document.getElementById("btnRefrescarInstr");

// crear
const formInst = document.getElementById("formInst");
const msgInst = document.getElementById("msgInst");
const instNombre = document.getElementById("instNombre");
const instCI = document.getElementById("instCI");
const instTel = document.getElementById("instTel");
const instEmail = document.getElementById("instEmail");
const instEstadoForm = document.getElementById("instEstadoForm");

// editar
const formEdit = document.getElementById("formInstrEdit");
const msgEdit = document.getElementById("msgEditInstr");
const eId = document.getElementById("iEditId");
const eNombre = document.getElementById("iEditNombre");
const eCI = document.getElementById("iEditDocumento");
const eTel = document.getElementById("iEditTelefono");
const eEmail = document.getElementById("iEditEmail");
const eEstado = document.getElementById("iEditEstado");

let cache = [];

// ======================================================
// CARGAR INSTRUCTORES
// ======================================================
async function cargarInstructores() {
  const params = new URLSearchParams();
  if (instBuscar?.value.trim()) params.append("q", instBuscar.value.trim());
  if (instEstado?.value) params.append("estado", instEstado.value);

  let url = "/api/instructores";
  if (params.toString()) url += "?" + params.toString();

  try {
    const data = await fetchJSON(url);
    cache = Array.isArray(data) ? data : [];
    renderTabla(cache);
  } catch (e) {
    console.error(e);
    tablaBody.innerHTML =
      `<tr><td colspan="7" class="text-center text-danger">Error al cargar instructores</td></tr>`;
    if (lblResumen) lblResumen.textContent = "0 instructores";
  }
}

// ======================================================
// RENDER TABLA
// ======================================================
function renderTabla(rows) {
  if (!rows.length) {
    tablaBody.innerHTML =
      `<tr><td colspan="7" class="text-center text-muted">Sin instructores</td></tr>`;
    if (lblResumen) lblResumen.textContent = "0 instructores";
    return;
  }

  tablaBody.innerHTML = rows.map(i => `
    <tr>
      <td>${i.id}</td>
      <td class="fw-semibold">${esc(i.nombre)}</td>
      <td>${esc(i.documento || "")}</td>
      <td>${esc(i.telefono || "")}</td>
      <td>${esc(i.email || "")}</td>
      <td>
        <span class="badge ${badgeEstado(i.estado)}">${i.estado}</span>
      </td>
      <td>
        <button class="btn btn-outline-primary btn-sm"
          onclick="editarInstructor(${i.id})">
          Editar
        </button>
      </td>
    </tr>
  `).join("");

  if (lblResumen) {
    lblResumen.textContent =
      `${rows.length} instructor${rows.length !== 1 ? "es" : ""}`;
  }
}

// ======================================================
// EDITAR (ABRIR MODAL)
// ======================================================
window.editarInstructor = function (id) {
  const inst = cache.find(x => Number(x.id) === Number(id));
  if (!inst) return alert("Instructor no encontrado");

  eId.value = inst.id;
  eNombre.value = inst.nombre || "";
  eCI.value = inst.documento || "";
  eTel.value = inst.telefono || "";
  eEmail.value = inst.email || "";
  eEstado.value = inst.estado || "Activo";

  msgEdit.textContent = "";
  msgEdit.className = "text-muted small";

  new bootstrap.Modal(
    document.getElementById("modalInstrEdit")
  ).show();
};

// ======================================================
// CREAR INSTRUCTOR
// ======================================================
formInst?.addEventListener("submit", async e => {
  e.preventDefault();

  const payload = {
    nombre: instNombre.value.trim(),
    documento: instCI.value.trim(),
    telefono: instTel.value.trim(),
    email: instEmail.value.trim(),
    estado: instEstadoForm.value
  };

  if (!payload.nombre) {
    msgInst.textContent = "El nombre es obligatorio";
    msgInst.className = "text-danger small";
    return;
  }

  try {
    msgInst.textContent = "Guardando...";
    msgInst.className = "text-muted small";

    await fetchJSON("/api/instructores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    msgInst.textContent = "Instructor registrado";
    msgInst.className = "text-success small";

    formInst.reset();
    instEstadoForm.value = "Activo";

    await cargarInstructores();

    setTimeout(() => {
      bootstrap.Modal.getInstance(
        document.getElementById("modalInstructor")
      )?.hide();
      msgInst.textContent = "";
    }, 700);

  } catch (err) {
    console.error(err);
    msgInst.textContent = "Error al registrar";
    msgInst.className = "text-danger small";
  }
});

// ======================================================
// GUARDAR EDICIÓN
// ======================================================
formEdit?.addEventListener("submit", async e => {
  e.preventDefault();

  const id = Number(eId.value);
  const payload = {
    nombre: eNombre.value.trim(),
    documento: eCI.value.trim(),
    telefono: eTel.value.trim(),
    email: eEmail.value.trim(),
    estado: eEstado.value
  };

  if (!payload.nombre) {
    msgEdit.textContent = "El nombre es obligatorio";
    msgEdit.className = "text-danger small";
    return;
  }

  try {
    msgEdit.textContent = "Guardando...";
    msgEdit.className = "text-muted small";

    await fetchJSON(`/api/instructores/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await cargarInstructores();

    msgEdit.textContent = "Actualizado";
    msgEdit.className = "text-success small";

    setTimeout(() => {
      bootstrap.Modal.getInstance(
        document.getElementById("modalInstrEdit")
      )?.hide();
      msgEdit.textContent = "";
    }, 600);

  } catch (err) {
    console.error(err);
    msgEdit.textContent = "No se pudo guardar";
    msgEdit.className = "text-danger small";
  }
});

// ======================================================
// EVENTOS
// ======================================================
btnFiltrar?.addEventListener("click", cargarInstructores);
btnRefrescar?.addEventListener("click", cargarInstructores);

instBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInstructores();
  }
});

document.addEventListener("DOMContentLoaded", cargarInstructores);

// public/js/instructores.js  (FUNCIONAL con tu instructores.html)

// ---------- helpers ----------
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
}

function badgeEstado(estado) {
  return (String(estado || "Activo") === "Activo") ? "bg-success" : "bg-secondary";
}

// ---------- DOM ----------
const tablaBody = document.querySelector("#tablaInstructores tbody");

const instBuscar = document.getElementById("instBuscar");
const instEstado = document.getElementById("instEstado");
const instResumen = document.getElementById("instResumen");
const btnFiltrarInst = document.getElementById("btnFiltrarInst");
const btnRefrescarInstr = document.getElementById("btnRefrescarInstr");

const formInst = document.getElementById("formInst");
const msgInst = document.getElementById("msgInst");
const instNombre = document.getElementById("instNombre");
const instCI = document.getElementById("instCI");
const instTel = document.getElementById("instTel");
const instEmail = document.getElementById("instEmail");
const instEstadoForm = document.getElementById("instEstadoForm");

// modal editar (EL QUE TIENES EN EL HTML)
const formInstrEdit = document.getElementById("formInstrEdit");
const msgEditInstr = document.getElementById("msgEditInstr");
const iEditId = document.getElementById("iEditId");
const iEditNombre = document.getElementById("iEditNombre");
const iEditDocumento = document.getElementById("iEditDocumento");
const iEditTelefono = document.getElementById("iEditTelefono");
const iEditEmail = document.getElementById("iEditEmail");
const iEditEstado = document.getElementById("iEditEstado");

let instructoresCache = [];

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
  const params = new URLSearchParams();
  const q = (instBuscar?.value || "").trim();
  const estado = (instEstado?.value || "").trim();

  if (q) params.append("q", q);
  if (estado) params.append("estado", estado);

  let url = "/api/instructores";
  const qs = params.toString();
  if (qs) url += "?" + qs;

  try {
    const data = await fetchJSON(url);
    instructoresCache = Array.isArray(data) ? data : [];
    renderInstructores(instructoresCache);
  } catch (e) {
    console.error(e);
    tablaBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error al cargar instructores.</td></tr>`;
    if (instResumen) instResumen.textContent = "0 instructores";
  }
}

// ---------- abrir modal editar ----------
window.editarInstructor = function (id) {
  const inst = instructoresCache.find(x => Number(x.id) === Number(id));
  if (!inst) return alert("Instructor no encontrado");

  iEditId.value = inst.id ?? "";
  iEditNombre.value = inst.nombre ?? "";
  iEditDocumento.value = inst.documento ?? "";
  iEditTelefono.value = inst.telefono ?? "";
  iEditEmail.value = inst.email ?? "";
  iEditEstado.value = inst.estado ?? "Activo";

  if (msgEditInstr) {
    msgEditInstr.textContent = "";
    msgEditInstr.className = "text-muted";
  }

  new bootstrap.Modal(document.getElementById("modalInstrEdit")).show();
};

// ---------- crear ----------
formInst?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nombre: (instNombre?.value || "").trim(),
    documento: (instCI?.value || "").trim(),
    telefono: (instTel?.value || "").trim(),
    email: (instEmail?.value || "").trim(),
    estado: instEstadoForm?.value || "Activo"
  };

  if (!payload.nombre) {
    msgInst.textContent = "El nombre es obligatorio.";
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

    msgInst.textContent = "Instructor registrado.";
    msgInst.className = "text-success small";

    formInst.reset();
    if (instEstadoForm) instEstadoForm.value = "Activo";

    await cargarInstructores();

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalInstructor"))?.hide();
      msgInst.textContent = "";
    }, 700);

  } catch (err) {
    console.error(err);
    msgInst.textContent = "Error al registrar.";
    msgInst.className = "text-danger small";
  }
});

// ---------- guardar edición ----------
formInstrEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = Number(iEditId.value);
  const payload = {
    nombre: (iEditNombre?.value || "").trim(),
    documento: (iEditDocumento?.value || "").trim(),
    telefono: (iEditTelefono?.value || "").trim(),
    email: (iEditEmail?.value || "").trim(),
    estado: iEditEstado?.value || "Activo"
  };

  if (!payload.nombre) {
    msgEditInstr.textContent = "El nombre es obligatorio.";
    msgEditInstr.className = "text-danger small";
    return;
  }

  try {
    msgEditInstr.textContent = "Guardando...";
    msgEditInstr.className = "text-muted small";

    await fetchJSON(`/api/instructores/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await cargarInstructores();

    msgEditInstr.textContent = "Actualizado.";
    msgEditInstr.className = "text-success small";

    setTimeout(() => {
      bootstrap.Modal.getInstance(document.getElementById("modalInstrEdit"))?.hide();
      msgEditInstr.textContent = "";
    }, 600);

  } catch (err) {
    console.error(err);
    msgEditInstr.textContent = "No se pudo guardar.";
    msgEditInstr.className = "text-danger small";
  }
});

// ---------- eventos ----------
instBuscar?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInstructores();
  }
});

btnFiltrarInst?.addEventListener("click", cargarInstructores);
btnRefrescarInstr?.addEventListener("click", cargarInstructores);

document.addEventListener("DOMContentLoaded", cargarInstructores);

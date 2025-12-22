// ======================================================
// INSTRUCTORES — Barber Chino (FUNCIONANDO)
// ======================================================

console.log("✅ instructores.js cargado");

// ================= HELPERS =================
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json")
    ? await r.json().catch(() => ({}))
    : { raw: await r.text().catch(() => "") };

  if (!r.ok) {
    const msg = data?.error || data?.message || data?.raw || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
}

function badgeEstado(estado) {
  return estado === "Inactivo" ? "bg-secondary" : "bg-success";
}

// ================= DOM =================
const API = "/api/instructores";

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

// ================= CARGAR =================
async function cargarInstructores() {
  const params = new URLSearchParams();
  if (instBuscar?.value.trim()) params.append("q", instBuscar.value.trim());
  if (instEstado?.value) params.append("estado", instEstado.value);

  let url = API;
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

// ================= RENDER =================
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
      <td><span class="badge ${badgeEstado(i.estado)}">${i.estado}</span></td>
      <td>
        <button class="btn btn-outline-primary btn-sm"
          onclick="editarInstructor(${i.id})">Editar</button>
      </td>
    </tr>
  `).join("");

  lblResumen.textContent =
    `${rows.length} instructor${rows.length !== 1 ? "es" : ""}`;
}

// ================= EDITAR =================
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

  new bootstrap.Modal(document.getElementById("modalInstrEdit")).show();
};

// ================= CREAR =================
formInst?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nombre: instNombre.value.trim(),
    documento: instCI.value.trim(),
    telefono: instTel.value.trim(),
    email: instEmail.value.trim(),
    estado: instEstadoForm.value || "Activo"
  };

  if (!payload.nombre) {
    msgInst.textContent = "El nombre es obligatorio";
    msgInst.className = "text-danger small";
    return;
  }

  if (!payload.documento) {
    msgInst.textContent = "El Documento / CI es obligatorio";
    msgInst.className = "text-danger small";
    return;
  }

  try {
    msgInst.textContent = "Guardando...";
    msgInst.className = "text-muted small";

    await fetchJSON(API, {
      method: "POST",
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
    msgInst.textContent = err.message;
    msgInst.className = "text-danger small";
  }
});

// ================= GUARDAR EDICIÓN =================
formEdit?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = Number(eId.value);
  const payload = {
    nombre: eNombre.value.trim(),
    documento: eCI.value.trim(),
    telefono: eTel.value.trim(),
    email: eEmail.value.trim(),
    estado: eEstado.value
  };

  if (!payload.nombre || !payload.documento) {
    msgEdit.textContent = "Nombre y documento son obligatorios";
    msgEdit.className = "text-danger small";
    return;
  }

  try {
    msgEdit.textContent = "Guardando...";
    msgEdit.className = "text-muted small";

    await fetchJSON(`${API}/${id}`, {
      method: "PUT",
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
    msgEdit.textContent = err.message;
    msgEdit.className = "text-danger small";
  }
});

// ================= EVENTOS =================
btnFiltrar?.addEventListener("click", cargarInstructores);
btnRefrescar?.addEventListener("click", cargarInstructores);

instBuscar?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarInstructores();
  }
});

document.addEventListener("DOMContentLoaded", cargarInstructores);

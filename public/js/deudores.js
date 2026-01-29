// public/js/deudores.js
(() => {
  "use strict";

async function fetchJSON(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("Error HTTP");
  return r.json();
}

const bs = (n) => "Bs " + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c] || c));

let deudoresCache = [];
let cursosCache = [];

const tablaBody = document.querySelector("#tablaDeudores tbody");
const dBuscar = document.getElementById("dBuscar");
const dCurso = document.getElementById("dCurso");
const dResumen = document.getElementById("dResumen");
const btnFiltrar = document.getElementById("btnFiltrarDeudores");

const modal = new bootstrap.Modal(document.getElementById("modalDeudaDetalle"));
const detAlumno = document.getElementById("detAlumno");
const detCurso = document.getElementById("detCurso");
const tablaDetalle = document.getElementById("tablaDetalleDeuda");
const detTotal = document.getElementById("detTotal");

// ================= API =================
async function apiGetDeudores() {
  const r = await fetchJSON("/api/reportes/deudores");
  return r.data || [];
}

async function apiGetCursos() {
  const r = await fetchJSON("/api/cursos");
  return r || [];
}

// ================= UI =================
function fillCursos() {
  dCurso.innerHTML = `<option value="">Todos</option>` +
    cursosCache.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
}

function renderTabla(rows) {
  if (!rows.length) {
    tablaBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay deudores</td></tr>`;
    dResumen.textContent = "0 deudores";
    return;
  }

  tablaBody.innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.alumno_nombre)}</td>
      <td>${esc(r.alumno_documento)}</td>
      <td>${esc(r.curso_nombre)}</td>
      <td class="text-muted">—</td>
      <td class="fw-semibold text-danger">${bs(r.deuda)}</td>
      <td class="text-end">
        <div class="d-flex justify-content-end gap-2">
          <button class="btn btn-outline-secondary btn-sm" data-det="${r.inscripcion_id}">Ver</button>
          <button class="btn btn-success btn-sm" data-pay="${r.inscripcion_id}">Pagar</button>
        </div>
      </td>
    </tr>
  `).join("");

  // Detalle
  tablaBody.querySelectorAll("[data-det]").forEach(btn => {
    btn.onclick = () => {
      const r = rows.find(x => x.inscripcion_id == btn.dataset.det);
      detAlumno.textContent = `${r.alumno_nombre} (CI: ${r.alumno_documento})`;
      detCurso.textContent = `Curso: ${r.curso_nombre}`;
      tablaDetalle.innerHTML = `
        <tr>
          <td>Saldo pendiente</td>
          <td>—</td>
          <td class="text-danger fw-semibold">${bs(r.deuda)}</td>
        </tr>`;
      detTotal.textContent = bs(r.deuda);
      modal.show();
    };
  });

  // Pagar
  tablaBody.querySelectorAll("[data-pay]").forEach(btn => {
    btn.onclick = () => {
      const r = rows.find(x => x.inscripcion_id == btn.dataset.pay);

// dentro del onclick del botón Pagar:
sessionStorage.setItem("pay_open_modal", "1");
sessionStorage.setItem("pay_alumno_documento", r.alumno_documento || "");
sessionStorage.setItem("pay_alumno_nombre", r.alumno_nombre || "");
sessionStorage.setItem("pay_curso_id", String(r.curso_id || ""));
sessionStorage.setItem("pay_inscripcion_id", String(r.inscripcion_id || ""));

// ir a pagos
window.location.href = "pagos.html";

    };
  });

  dResumen.textContent = `${rows.length} deudores`;
}

function aplicarFiltros() {
  let rows = [...deudoresCache];
  const q = dBuscar.value.toLowerCase();
  const curso = dCurso.value;

  if (q) {
    rows = rows.filter(r =>
      r.alumno_nombre.toLowerCase().includes(q) ||
      r.alumno_documento.includes(q)
    );
  }
  if (curso) rows = rows.filter(r => String(r.curso_id) === curso);

  renderTabla(rows);
}

// ================= INIT =================
async function cargarDeudores() {
  deudoresCache = await apiGetDeudores();
  aplicarFiltros();
}

document.addEventListener("DOMContentLoaded", async () => {
  cursosCache = await apiGetCursos();
  fillCursos();
  await cargarDeudores();

  btnFiltrar.onclick = aplicarFiltros;
  dBuscar.onkeyup = (e) => e.key === "Enter" && aplicarFiltros();
  dCurso.onchange = aplicarFiltros;
});


window.cargarDeudores = cargarDeudores;
})();

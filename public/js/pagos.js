
// public/js/pagos.js

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (r.status === 401) {
    window.location.href = "/login.html";
    return null;
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = isJson ? await r.json() : await r.text();
      msg = body?.error || body?.message || body || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return isJson ? r.json() : null;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function money(n) {
  const v = Number(n || 0);
  return "Bs " + (Math.round(v * 100) / 100).toFixed(2);
}

// DOM
const selCurso = document.getElementById("pCurso");
const inpBuscar = document.getElementById("pBuscar");
const tbody = document.getElementById("tablaPagos");
const msg = document.getElementById("msgPagos");

// Modal
const mEl = document.getElementById("modalPagar");
const mTitle = document.getElementById("mPagarTitle");
const mInfo = document.getElementById("mPagarInfo");
const mMonto = document.getElementById("mMonto");
const mMetodo = document.getElementById("mMetodo");
const mNota = document.getElementById("mNota");
const mFecha = document.getElementById("mFecha");
const mBtnGuardar = document.getElementById("btnGuardarPago");

let cursosCache = [];
let resumenCache = null;
let modal = null;

function hoyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function cargarCursos() {
  const data = await fetchJSON("/api/cursos");
  cursosCache = Array.isArray(data) ? data : [];

  selCurso.innerHTML = cursosCache.length
    ? cursosCache.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
    : `<option value="">(sin cursos)</option>`;
}

function badgeEstadoPago(x) {
  if (x === "AL_DIA") return `<span class="badge bg-success">Al día</span>`;
  return `<span class="badge bg-danger">Debe</span>`;
}

function renderTabla() {
  if (!tbody) return;
  const q = String(inpBuscar?.value || "").toLowerCase().trim();

  const rows = (resumenCache?.data || []).filter((r) => {
    if (!q) return true;
    return (
      String(r.alumno_nombre || "").toLowerCase().includes(q) ||
      String(r.alumno_documento || "").toLowerCase().includes(q)
    );
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay alumnos inscritos.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const p = r.proximo_periodo;
      const periodoTxt = p ? `${p.inicio} → ${p.fin}` : "—";
      const restante = p ? Number(p.restante || 0) : 0;
      const montoSug = restante > 0 ? restante : Number(r.monto_periodo || 0);

      return `
        <tr>
          <td class="fw-semibold">${esc(r.alumno_nombre || "")}</td>
          <td>${esc(r.alumno_documento || "")}</td>
          <td>${badgeEstadoPago(r.estado_pago)}</td>
          <td>${esc(periodoTxt)}</td>
          <td class="text-end">${money(r.deuda_total || 0)}</td>
          <td class="text-end">
            <button class="btn btn-primary btn-sm"
              onclick="abrirPago(${r.inscripcion_id}, ${r.alumno_id}, '${esc(r.alumno_nombre)}', '${esc(periodoTxt)}', ${montoSug}, ${Number(r.curso_id || selCurso.value)})">
              Pagar ${esc((r.frecuencia || "Mensual").toLowerCase())}
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function cargarResumen() {
  const cursoId = Number(selCurso?.value || 0);
  if (!cursoId) return;

  if (msg) msg.textContent = "Cargando pagos...";
  resumenCache = await fetchJSON(`/api/pagos/resumen?curso_id=${cursoId}`);

  // inject curso_id into each row (por si)
  for (const r of resumenCache.data || []) r.curso_id = cursoId;

  if (msg) {
    const n = (resumenCache?.data || []).length;
    msg.textContent = `${n} alumno(s) en el curso`;
  }
  renderTabla();
}

// ===== MODAL =====
window.abrirPago = function (inscripcionId, alumnoId, alumnoNombre, periodoTxt, montoSug, cursoId) {
  if (!mEl) return;

  if (!modal) modal = new bootstrap.Modal(mEl);

  const curso = cursosCache.find((c) => Number(c.id) === Number(cursoId));
  const cursoNombre = curso?.nombre || "Curso";

  mTitle.textContent = `Pagar — ${cursoNombre}`;
  mInfo.textContent = `${alumnoNombre} · Periodo: ${periodoTxt}`;
  mMonto.value = String(Number(montoSug || 0).toFixed(2));
  mMetodo.value = "Efectivo";
  mNota.value = "";
  mFecha.value = hoyISO();

  mBtnGuardar.dataset.inscripcionId = String(inscripcionId);
  mBtnGuardar.dataset.alumnoId = String(alumnoId);
  mBtnGuardar.dataset.cursoId = String(cursoId);

  modal.show();
};

mBtnGuardar?.addEventListener("click", async () => {
  const inscripcion_id = Number(mBtnGuardar.dataset.inscripcionId || 0);
  const alumno_id = Number(mBtnGuardar.dataset.alumnoId || 0);
  const curso_id = Number(mBtnGuardar.dataset.cursoId || 0);

  const monto = Number(mMonto?.value || 0);
  const metodo = (mMetodo?.value || "Efectivo").trim();
  const nota = (mNota?.value || "").trim();
  const fecha_pago = (mFecha?.value || hoyISO()).trim();

  if (!inscripcion_id || !alumno_id || !curso_id) return alert("Datos inválidos");
  if (!(monto > 0)) return alert("Monto inválido");

  try {
    mBtnGuardar.disabled = true;
    mBtnGuardar.textContent = "Guardando...";

    await fetchJSON("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        curso_id,
        inscripcion_id,
        alumno_id,
        monto,
        metodo,
        nota,
        fecha_pago,
        // periodo_inicio/fin opcional: el backend calcula el pendiente
      }),
    });

    modal?.hide();
    await cargarResumen();
  } catch (e) {
    console.error(e);
    alert("Error: " + String(e.message || "desconocido"));
  } finally {
    mBtnGuardar.disabled = false;
    mBtnGuardar.textContent = "Guardar pago";
  }
});

// Eventos
selCurso?.addEventListener("change", cargarResumen);
inpBuscar?.addEventListener("input", renderTabla);

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await cargarCursos();
    await cargarResumen();
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "Error cargando pagos.";
  }
});

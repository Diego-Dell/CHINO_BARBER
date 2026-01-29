// public/js/reportes.js
(() => {
  "use strict";

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

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

const bs = (n) => "Bs " + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c] || c));
const clamp0 = (n) => Math.max(0, Number(n || 0));

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function isoFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }

// Elements
const repHint = document.getElementById("repHint");

const desdeEl = document.getElementById("desde");
const hastaEl = document.getElementById("hasta");
const includeAnuladosEl = document.getElementById("includeAnulados");

const btnAplicar = document.getElementById("btnAplicarFiltros");
const btnRefrescar = document.getElementById("btnRefrescarReportes");
const btnExportarCSV = document.getElementById("btnExportarCSV");
const btnImprimir = document.getElementById("btnImprimir");

const kpiIngresos = document.getElementById("kpiIngresos");
const kpiEgresos = document.getElementById("kpiEgresos");
const kpiUtilidad = document.getElementById("kpiUtilidad");
const kpiAlumnosActivos = document.getElementById("kpiAlumnosActivos");
const kpiInscripcionesActivas = document.getElementById("kpiInscripcionesActivas");

const kpiIngresosAux = document.getElementById("kpiIngresosAux");
const kpiEgresosAux = document.getElementById("kpiEgresosAux");
const kpiUtilidadAux = document.getElementById("kpiUtilidadAux");
const kpiAlumnosAux = document.getElementById("kpiAlumnosAux");

const qTopCursos = document.getElementById("qTopCursos");
const topCursosBody = document.querySelector("#tablaTopCursos tbody");
const topAlumnosBody = document.getElementById("tablaTopAlumnos");

// Modal detalle curso
const modalCursoEl = document.getElementById("modalCursoDetalle");
const modalCurso = modalCursoEl ? bootstrap.Modal.getOrCreateInstance(modalCursoEl) : null;
const mCursoTitle = document.getElementById("mCursoTitle");
const mCursoSub = document.getElementById("mCursoSub");
const mCursoBody = document.getElementById("mCursoBody");
const mCursoTotal = document.getElementById("mCursoTotal");

let chartTrend = null;
let chartEstado = null;

let lastKpis = null;
let topCursosCache = [];

function setHint(txt, type = "muted") {
  if (!repHint) return;
  repHint.className = `small text-${type}`;
  repHint.textContent = txt;
}

function setLoading(on) {
  document.body.style.cursor = on ? "progress" : "default";
  btnAplicar.disabled = on;
  btnRefrescar.disabled = on;
  btnExportarCSV.disabled = on;
}

function getQuery() {
  const desde = desdeEl.value || "";
  const hasta = hastaEl.value || "";
  const include_anulados = includeAnuladosEl.checked ? "1" : "0";
  return { desde, hasta, include_anulados };
}

async function apiGetKpis() {
  const q = getQuery();
  const qs = new URLSearchParams(q).toString();
  return fetchJSON(`/api/reportes/kpis?${qs}`);
}

async function apiGetCursoDetalle(cursoId) {
  const q = getQuery();
  const qs = new URLSearchParams(q).toString();
  return fetchJSON(`/api/reportes/curso/${encodeURIComponent(cursoId)}/detalle?${qs}`);
}

function buildCSV(rows, headers) {
  const escCsv = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [];
  lines.push(headers.map(escCsv).join(","));
  for (const r of rows) {
    lines.push(headers.map(h => escCsv(r[h])).join(","));
  }
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderKPIs(data) {
  const { desde, hasta } = data;

  kpiIngresos.textContent = bs(data.kpis.ingresos);
  kpiEgresos.textContent = bs(data.kpis.egresos);
  kpiUtilidad.textContent = bs(data.kpis.utilidad);

  kpiAlumnosActivos.textContent = String(data.kpis.alumnos_activos || 0);
  kpiInscripcionesActivas.textContent = String(data.kpis.inscripciones_activas || 0);

  const aux = `Periodo: ${desde} → ${hasta}`;
  kpiIngresosAux.textContent = aux;
  kpiEgresosAux.textContent = aux;
  kpiUtilidadAux.textContent = aux;
  kpiAlumnosAux.textContent = aux;
}

function renderCharts(data) {
  // Trend
  const labels = data.serie_mensual.map(x => x.mes);
  const ingresos = data.serie_mensual.map(x => x.ingresos);
  const egresos = data.serie_mensual.map(x => x.egresos);
  const utilidad = data.serie_mensual.map(x => x.utilidad);

  const ctxTrend = document.getElementById("chartTrend");
  if (chartTrend) chartTrend.destroy();

  chartTrend = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Ingresos", data: ingresos, tension: .35 },
        { label: "Egresos", data: egresos, tension: .35 },
        { label: "Utilidad", data: utilidad, tension: .35 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Estado
  const st = data.pagos_estado || {};
  const labelsSt = ["Pagado", "Pendiente", "Anulado", "Otro"];
  const valuesSt = labelsSt.map(k => Number(st[k]?.n || 0));

  const ctxEstado = document.getElementById("chartEstado");
  if (chartEstado) chartEstado.destroy();

  chartEstado = new Chart(ctxEstado, {
    type: "doughnut",
    data: { labels: labelsSt, datasets: [{ data: valuesSt }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function renderTopCursos(rows) {
  topCursosCache = rows || [];
  const q = String(qTopCursos?.value || "").trim().toLowerCase();
  let filtered = topCursosCache;

  if (q) {
    filtered = topCursosCache.filter(r => String(r.curso||"").toLowerCase().includes(q));
  }

  if (!filtered.length) {
    topCursosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No hay datos.</td></tr>`;
    return;
  }

  topCursosBody.innerHTML = filtered.map(r => `
    <tr data-curso="${r.curso_id}">
      <td>${esc(r.curso)}</td>
      <td class="text-end fw-semibold">${bs(r.ingresos)}</td>
      <td class="text-end">${r.pagos}</td>
    </tr>
  `).join("");

  // Click row => modal detalle
  topCursosBody.querySelectorAll("tr[data-curso]").forEach(tr => {
    tr.addEventListener("click", async () => {
      const cursoId = tr.getAttribute("data-curso");
      const cursoName = tr.querySelector("td")?.textContent || "Curso";
      await openCursoDetalle(cursoId, cursoName);
    });
  });
}

function renderTopAlumnos(rows) {
  if (!rows?.length) {
    topAlumnosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No hay datos.</td></tr>`;
    return;
  }

  topAlumnosBody.innerHTML = rows.map(r => `
    <tr>
      <td>
        <div class="fw-semibold">${esc(r.alumno)}</div>
        <div class="small text-muted">CI: ${esc(r.ci || "—")}</div>
      </td>
      <td class="text-end fw-semibold">${bs(r.pagado)}</td>
      <td class="text-end">${r.pagos}</td>
    </tr>
  `).join("");
}

async function openCursoDetalle(cursoId, cursoName) {
  setLoading(true);
  setHint(`Cargando detalle de ${cursoName}...`, "muted");

  try {
    const resp = await apiGetCursoDetalle(cursoId);
    const d = resp?.data;

    mCursoTitle.textContent = `Detalle: ${cursoName}`;
    mCursoSub.textContent = `Periodo: ${d.desde} → ${d.hasta} · Registros: ${d.n}`;
    mCursoTotal.textContent = bs(d.total_pagado);

    const rows = d.rows || [];
    if (!rows.length) {
      mCursoBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Sin pagos en el periodo.</td></tr>`;
    } else {
      mCursoBody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${esc(r.fecha || "—")}</td>
          <td>${esc(r.alumno || "—")}</td>
          <td>${esc(r.ci || "—")}</td>
          <td class="text-end">${bs(r.monto)}</td>
          <td>${esc(r.estado || "—")}</td>
          <td>${esc(r.metodo || "—")}</td>
          <td class="text-muted small">${esc(r.obs || "—")}</td>
        </tr>
      `).join("");
    }

    modalCurso?.show();
    setHint(`Detalle listo: ${cursoName}`, "muted");
  } catch (e) {
    console.error(e);
    setHint(`Error cargando detalle: ${e.message || "desconocido"}`, "danger");
  } finally {
    setLoading(false);
  }
}

async function cargarTodo() {
  setLoading(true);
  setHint("Cargando reportes...", "muted");

  try {
    const resp = await apiGetKpis();
    const data = resp?.data;
    lastKpis = data;

    renderKPIs(data);
    renderCharts(data);
    renderTopCursos(data.top_cursos || []);
    renderTopAlumnos(data.top_alumnos || []);

    setHint(`Listo · ${data.desde} → ${data.hasta}`, "muted");
  } catch (e) {
    console.error(e);
    setHint(`Error: ${e.message || "desconocido"}`, "danger");
  } finally {
    setLoading(false);
  }
}

function applyPreset(preset) {
  const now = new Date();
  let desde, hasta;

  hasta = isoFromDate(now);

  if (preset === "7d") desde = isoFromDate(addDays(now, -6));
  if (preset === "30d") desde = isoFromDate(addDays(now, -29));
  if (preset === "90d") desde = isoFromDate(addDays(now, -89));
  if (preset === "12m") desde = isoFromDate(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  if (preset === "ytd") desde = isoFromDate(startOfYear(now));

  desdeEl.value = desde;
  hastaEl.value = hasta;
}

document.addEventListener("DOMContentLoaded", async () => {
  // defaults
  if (!desdeEl.value || !hastaEl.value) {
    applyPreset("12m");
  }

  // preset buttons
  document.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      applyPreset(btn.getAttribute("data-preset"));
      cargarTodo();
    });
  });

  // apply
  btnAplicar?.addEventListener("click", cargarTodo);
  btnRefrescar?.addEventListener("click", cargarTodo);

  // search top courses
  qTopCursos?.addEventListener("input", () => renderTopCursos(topCursosCache));

  // export CSV (top cursos + KPIs)
  btnExportarCSV?.addEventListener("click", () => {
    if (!lastKpis) return;

    const k = lastKpis.kpis;
    const top = lastKpis.top_cursos || [];

    const rows = top.map(r => ({
      curso: r.curso,
      ingresos: r.ingresos,
      pagos: r.pagos,
      desde: lastKpis.desde,
      hasta: lastKpis.hasta,
      kpi_ingresos: k.ingresos,
      kpi_egresos: k.egresos,
      kpi_utilidad: k.utilidad
    }));

    const csv = buildCSV(rows, ["curso","ingresos","pagos","desde","hasta","kpi_ingresos","kpi_egresos","kpi_utilidad"]);
    downloadText(`reportes_top_cursos_${lastKpis.desde}_a_${lastKpis.hasta}.csv`, csv);
  });

  btnImprimir?.addEventListener("click", () => window.print());

  await cargarTodo();
});
})();

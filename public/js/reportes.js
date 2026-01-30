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
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));

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
  function startOfYear(d) {
    return new Date(d.getFullYear(), 0, 1);
  }

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

  // Modal detalle curso (si lo tienes)
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
    btnAplicar && (btnAplicar.disabled = on);
    btnRefrescar && (btnRefrescar.disabled = on);
    btnExportarCSV && (btnExportarCSV.disabled = on);
  }

  function getQuery() {
    const desde = desdeEl.value || "";
    const hasta = hastaEl.value || "";
    // ✅ Backend usa: anulados=1
    const anulados = includeAnuladosEl && includeAnuladosEl.checked ? "1" : "0";
    return { desde, hasta, anulados };
  }

  // ✅ Endpoints reales del backend
  async function apiGetKpis() {
    const q = getQuery();
    const qs = new URLSearchParams(q).toString();
    return fetchJSON(`/api/reportes/kpis?${qs}`);
  }
  async function apiGetTendencia() {
    const q = getQuery();
    const qs = new URLSearchParams(q).toString();
    return fetchJSON(`/api/reportes/tendencia?${qs}`);
  }
  async function apiGetPagosPorEstado() {
    const q = getQuery();
    const qs = new URLSearchParams(q).toString();
    return fetchJSON(`/api/reportes/pagos-por-estado?${qs}`);
  }

  // (si algún día implementas este endpoint, queda listo)
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
      lines.push(headers.map((h) => escCsv(r[h])).join(","));
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
    const desde = data?.desde || "";
    const hasta = data?.hasta || "";
    const k = data?.kpis || {};

    // ✅ robusto: si algo no viene, mostramos 0 sin romper
    kpiIngresos && (kpiIngresos.textContent = bs(k.ingresos || 0));
    kpiEgresos && (kpiEgresos.textContent = bs(k.egresos || 0));
    kpiUtilidad && (kpiUtilidad.textContent = bs(k.utilidad || 0));

    kpiAlumnosActivos && (kpiAlumnosActivos.textContent = String(k.alumnos_activos || 0));
    kpiInscripcionesActivas && (kpiInscripcionesActivas.textContent = String(k.inscripciones_activas || 0));

    const aux = `Periodo: ${desde} → ${hasta}`;
    kpiIngresosAux && (kpiIngresosAux.textContent = aux);
    kpiEgresosAux && (kpiEgresosAux.textContent = aux);
    kpiUtilidadAux && (kpiUtilidadAux.textContent = aux);
    kpiAlumnosAux && (kpiAlumnosAux.textContent = aux);
  }

  function renderCharts(data) {
    const serie = Array.isArray(data?.serie_mensual) ? data.serie_mensual : [];

    // Trend
    const labels = serie.map((x) => x.mes);
    const ingresos = serie.map((x) => Number(x.ingresos || 0));
    const egresos = serie.map((x) => Number(x.egresos || 0));
    const utilidad = serie.map((x) => Number(x.utilidad || 0));

    const ctxTrend = document.getElementById("chartTrend");
    if (ctxTrend) {
      if (chartTrend) chartTrend.destroy();
      chartTrend = new Chart(ctxTrend, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Ingresos", data: ingresos, tension: 0.35 },
            { label: "Egresos", data: egresos, tension: 0.35 },
            { label: "Utilidad", data: utilidad, tension: 0.35 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top" } },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // Estado (backend devuelve array)
    const stRows = Array.isArray(data?.pagos_por_estado) ? data.pagos_por_estado : [];
    const labelsSt = stRows.length ? stRows.map((r) => String(r.estado || "—")) : ["Pagado", "Pendiente", "Anulado"];
    const valuesSt = stRows.length ? stRows.map((r) => Number(r.total || 0)) : [0, 0, 0];

    const ctxEstado = document.getElementById("chartEstado");
    if (ctxEstado) {
      if (chartEstado) chartEstado.destroy();
      chartEstado = new Chart(ctxEstado, {
        type: "doughnut",
        data: { labels: labelsSt, datasets: [{ data: valuesSt }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
      });
    }
  }

  function renderTopCursos(rows) {
    topCursosCache = rows || [];
    const q = String(qTopCursos?.value || "").trim().toLowerCase();
    let filtered = topCursosCache;

    if (q) filtered = topCursosCache.filter((r) => String(r.curso || "").toLowerCase().includes(q));

    if (!topCursosBody) return;
    if (!filtered.length) {
      topCursosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No hay datos.</td></tr>`;
      return;
    }

    topCursosBody.innerHTML = filtered
      .map(
        (r) => `
      <tr data-curso="${r.curso_id}">
        <td>${esc(r.curso)}</td>
        <td class="text-end fw-semibold">${bs(r.ingresos)}</td>
        <td class="text-end">${r.pagos}</td>
      </tr>
    `
      )
      .join("");

    // Click row => modal detalle (solo si tu backend lo implementa)
    topCursosBody.querySelectorAll("tr[data-curso]").forEach((tr) => {
      tr.addEventListener("click", async () => {
        const cursoId = tr.getAttribute("data-curso");
        const cursoName = tr.querySelector("td")?.textContent || "Curso";
        await openCursoDetalle(cursoId, cursoName);
      });
    });
  }

  function renderTopAlumnos(rows) {
    if (!topAlumnosBody) return;
    if (!rows?.length) {
      topAlumnosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No hay datos.</td></tr>`;
      return;
    }

    topAlumnosBody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>
          <div class="fw-semibold">${esc(r.alumno)}</div>
          <div class="small text-muted">CI: ${esc(r.ci || "—")}</div>
        </td>
        <td class="text-end fw-semibold">${bs(r.pagado)}</td>
        <td class="text-end">${r.pagos}</td>
      </tr>
    `
      )
      .join("");
  }

  async function openCursoDetalle(cursoId, cursoName) {
    if (!modalCurso) return;
    setLoading(true);
    setHint(`Cargando detalle de ${cursoName}...`, "muted");

    try {
      const resp = await apiGetCursoDetalle(cursoId);
      const d = resp?.data;

      mCursoTitle && (mCursoTitle.textContent = `Detalle: ${cursoName}`);
      mCursoSub && (mCursoSub.textContent = `Periodo: ${d.desde} → ${d.hasta} · Registros: ${d.n}`);
      mCursoTotal && (mCursoTotal.textContent = bs(d.total_pagado));

      const rows = d.rows || [];
      if (!rows.length) {
        mCursoBody && (mCursoBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Sin pagos en el periodo.</td></tr>`);
      } else {
        mCursoBody &&
          (mCursoBody.innerHTML = rows
            .map(
              (r) => `
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
        `
            )
            .join(""));
      }

      modalCurso.show();
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
      const q = getQuery();
      const [kResp, tResp, sResp] = await Promise.all([apiGetKpis(), apiGetTendencia(), apiGetPagosPorEstado()]);

      const k = kResp?.data || {};
      const data = {
        desde: q.desde,
        hasta: q.hasta,
        kpis: {
          ingresos: Number(k.ingresos || 0),
          egresos: Number(k.egresos || 0),
          utilidad: Number(k.utilidad || 0),
          alumnos_activos: Number(k.alumnos_activos || 0),
          inscripciones_activas: Number(k.inscripciones_activas || 0),
        },
        serie_mensual: Array.isArray(tResp?.data) ? tResp.data : [],
        pagos_por_estado: Array.isArray(sResp?.data) ? sResp.data : [],
        // (por ahora tu backend no expone top cursos/alumnos en reportes)
        top_cursos: [],
        top_alumnos: [],
      };

      lastKpis = data;

      renderKPIs(data);
      renderCharts(data);
      renderTopCursos([]);
      renderTopAlumnos([]);

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
    if (!desdeEl.value || !hastaEl.value) applyPreset("12m");

    // preset buttons
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyPreset(btn.getAttribute("data-preset"));
        cargarTodo();
      });
    });

    // apply
    btnAplicar && btnAplicar.addEventListener("click", cargarTodo);
    btnRefrescar && btnRefrescar.addEventListener("click", cargarTodo);

    // search top courses
    qTopCursos && qTopCursos.addEventListener("input", () => renderTopCursos(topCursosCache));

    // export CSV
    btnExportarCSV &&
      btnExportarCSV.addEventListener("click", () => {
        if (!lastKpis) return;

        const k = lastKpis.kpis || {};
        const rows = [];

        // KPI
        rows.push({
          tipo: "KPI",
          mes: "",
          ingresos: k.ingresos || 0,
          egresos: k.egresos || 0,
          utilidad: k.utilidad || 0,
          alumnos_activos: k.alumnos_activos || 0,
          inscripciones_activas: k.inscripciones_activas || 0,
          estado: "",
          total_estado: "",
          desde: lastKpis.desde,
          hasta: lastKpis.hasta,
        });

        // Tendencia
        (lastKpis.serie_mensual || []).forEach((r) => {
          rows.push({
            tipo: "Tendencia",
            mes: r.mes,
            ingresos: r.ingresos,
            egresos: r.egresos,
            utilidad: r.utilidad,
            alumnos_activos: "",
            inscripciones_activas: "",
            estado: "",
            total_estado: "",
            desde: lastKpis.desde,
            hasta: lastKpis.hasta,
          });
        });

        // Estado
        (lastKpis.pagos_por_estado || []).forEach((r) => {
          rows.push({
            tipo: "Estado",
            mes: "",
            ingresos: "",
            egresos: "",
            utilidad: "",
            alumnos_activos: "",
            inscripciones_activas: "",
            estado: r.estado,
            total_estado: r.total,
            desde: lastKpis.desde,
            hasta: lastKpis.hasta,
          });
        });

        const csv = buildCSV(rows, [
          "tipo",
          "mes",
          "ingresos",
          "egresos",
          "utilidad",
          "alumnos_activos",
          "inscripciones_activas",
          "estado",
          "total_estado",
          "desde",
          "hasta",
        ]);

        downloadText(`reportes_${lastKpis.desde}_a_${lastKpis.hasta}.csv`, csv);
      });

    btnImprimir && btnImprimir.addEventListener("click", () => window.print());

    await cargarTodo();
  });
})();

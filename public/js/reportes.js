// public/js/reportes.js — Versión mejorada: PDF en lugar de CSV
(() => {
  "use strict";

  // ── Fetch helper ──────────────────────────────────────────────────
  async function fetchJSON(url, options = {}) {
    options.credentials = "include";
    const r = await fetch(url, options);
    const ct = r.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const b = isJson ? await r.json() : await r.text(); msg = b?.error || b?.message || b || msg; } catch (_) {}
      throw new Error(msg);
    }
    return isJson ? r.json() : null;
  }

  // ── Formatters ────────────────────────────────────────────────────
  const bs  = (n) => "Bs " + Number(n || 0).toFixed(2);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));

  function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }

  // ── DOM ───────────────────────────────────────────────────────────
  const repHint    = document.getElementById("repHint");
  const desdeEl    = document.getElementById("desde");
  const hastaEl    = document.getElementById("hasta");
  const includeAnuladosEl = document.getElementById("includeAnulados");

  const btnAplicar    = document.getElementById("btnAplicarFiltros");
  const btnRefrescar  = document.getElementById("btnRefrescarReportes");
  const btnGuardarPDF = document.getElementById("btnGuardarPDF");
  const btnImprimir   = document.getElementById("btnImprimir");

  const kpiIngresos           = document.getElementById("kpiIngresos");
  const kpiEgresos            = document.getElementById("kpiEgresos");
  const kpiUtilidad           = document.getElementById("kpiUtilidad");
  const kpiAlumnosActivos     = document.getElementById("kpiAlumnosActivos");
  const kpiInscripcionesActivas = document.getElementById("kpiInscripcionesActivas");
  const kpiIngresosAux        = document.getElementById("kpiIngresosAux");
  const kpiEgresosAux         = document.getElementById("kpiEgresosAux");
  const kpiUtilidadAux        = document.getElementById("kpiUtilidadAux");
  const kpiAlumnosAux         = document.getElementById("kpiAlumnosAux");
  const qTopCursos            = document.getElementById("qTopCursos");
  const topCursosBody         = document.querySelector("#tablaTopCursos tbody");
  const topAlumnosBody        = document.getElementById("tablaTopAlumnos");

  const modalCursoEl = document.getElementById("modalCursoDetalle");
  const modalCurso   = modalCursoEl ? bootstrap.Modal.getOrCreateInstance(modalCursoEl) : null;
  const mCursoTitle  = document.getElementById("mCursoTitle");
  const mCursoSub    = document.getElementById("mCursoSub");
  const mCursoBody   = document.getElementById("mCursoBody");
  const mCursoTotal  = document.getElementById("mCursoTotal");

  let chartTrend     = null;
  let chartEstado    = null;
  let lastKpis        = null;
  let topCursosCache  = [];
  let topAlumnosCache = [];

  // ── Hint helper ───────────────────────────────────────────────────
  function setHint(txt, type = "muted") {
    if (!repHint) return;
    repHint.className = `small text-${type}`;
    repHint.textContent = txt;
  }

  function setLoading(on) {
    document.body.style.cursor = on ? "progress" : "default";
    if (btnAplicar)    btnAplicar.disabled    = on;
    if (btnRefrescar)  btnRefrescar.disabled  = on;
    if (btnGuardarPDF) btnGuardarPDF.disabled = on;
  }

  function getQuery() {
    return {
      desde:    desdeEl?.value  || "",
      hasta:    hastaEl?.value  || "",
      anulados: includeAnuladosEl?.checked ? "1" : "0",
    };
  }

  // ── API calls ─────────────────────────────────────────────────────
  const buildQS = () => new URLSearchParams(getQuery()).toString();
  const apiGetKpis         = () => fetchJSON(`/api/reportes/kpis?${buildQS()}`);
  const apiGetTendencia    = () => fetchJSON(`/api/reportes/tendencia?${buildQS()}`);
  const apiGetPagosPorEstado = () => fetchJSON(`/api/reportes/pagos-por-estado?${buildQS()}`);
  const apiGetTopCursos    = () => fetchJSON(`/api/reportes/top-cursos?${buildQS()}`);
  const apiGetTopAlumnos   = () => fetchJSON(`/api/reportes/top-alumnos?${buildQS()}`);
  const apiGetCursoDetalle = (id) => fetchJSON(`/api/reportes/curso/${encodeURIComponent(id)}/detalle?${buildQS()}`);

  // ── Rendering ─────────────────────────────────────────────────────
  function renderKPIs(data) {
    const k = data?.kpis || {};
    const aux = `Periodo: ${data?.desde || "—"} → ${data?.hasta || "—"}`;
    if (kpiIngresos) kpiIngresos.textContent = bs(k.ingresos || 0);
    if (kpiEgresos)  kpiEgresos.textContent  = bs(k.egresos  || 0);
    if (kpiUtilidad) {
      kpiUtilidad.textContent = bs(k.utilidad || 0);
      kpiUtilidad.className = `kpi-value ${k.utilidad >= 0 ? "text-success" : "text-danger"}`;
    }
    if (kpiAlumnosActivos)      kpiAlumnosActivos.textContent      = k.alumnos_activos      || 0;
    if (kpiInscripcionesActivas) kpiInscripcionesActivas.textContent = k.inscripciones_activas || 0;
    [kpiIngresosAux, kpiEgresosAux, kpiUtilidadAux, kpiAlumnosAux].forEach(el => { if (el) el.textContent = aux; });
  }

  function renderCharts(data) {
    const serie = Array.isArray(data?.serie_mensual) ? data.serie_mensual : [];
    const labels   = serie.map(x => x.mes);
    const ingresos = serie.map(x => Number(x.ingresos || 0));
    const egresos  = serie.map(x => Number(x.egresos  || 0));
    const utilidad = serie.map(x => Number(x.utilidad || 0));

    const ctxTrend = document.getElementById("chartTrend");
    if (ctxTrend) {
      if (chartTrend) chartTrend.destroy();
      chartTrend = new Chart(ctxTrend, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Ingresos", data: ingresos, tension: 0.35, borderColor: "#198754", backgroundColor: "rgba(25,135,84,.10)" },
            { label: "Egresos",  data: egresos,  tension: 0.35, borderColor: "#dc3545", backgroundColor: "rgba(220,53,69,.10)" },
            { label: "Utilidad", data: utilidad, tension: 0.35, borderColor: "#0d6efd", backgroundColor: "rgba(13,110,253,.10)" },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "top" } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: v => "Bs " + Number(v).toFixed(0) },
            },
          },
        },
      });
    }

    const stRows  = Array.isArray(data?.pagos_por_estado) ? data.pagos_por_estado : [];
    const ctxEst  = document.getElementById("chartEstado");
    if (ctxEst) {
      if (chartEstado) chartEstado.destroy();
      chartEstado = new Chart(ctxEst, {
        type: "doughnut",
        data: {
          labels: stRows.map(r => r.estado || "—"),
          datasets: [{ data: stRows.map(r => Number(r.monto || 0)), backgroundColor: ["#198754","#ffc107","#dc3545","#6c757d"] }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom" },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${bs(ctx.parsed)}` } },
          },
        },
      });
    }
  }

  function renderTopCursos(rows) {
    topCursosCache = rows || [];
    const q = String(qTopCursos?.value || "").trim().toLowerCase();
    const filtered = q ? topCursosCache.filter(r => String(r.curso || "").toLowerCase().includes(q)) : topCursosCache;

    if (!topCursosBody) return;
    if (!filtered.length) {
      topCursosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">📭 Sin datos en el periodo.</td></tr>`;
      return;
    }
    topCursosBody.innerHTML = filtered.map(r =>
      `<tr data-curso-id="${r.id}" data-curso-name="${esc(r.curso)}">
        <td>${esc(r.curso)}</td>
        <td class="text-end fw-semibold text-success">${bs(r.ingresos)}</td>
        <td class="text-end">${r.num_pagos}</td>
      </tr>`
    ).join("");

    topCursosBody.querySelectorAll("tr[data-curso-id]").forEach(tr => {
      tr.addEventListener("click", () => {
        openCursoDetalle(tr.dataset.cursoId, tr.dataset.cursoName || "Curso");
      });
    });
  }

  function renderTopAlumnos(rows) {
    if (!topAlumnosBody) return;
    if (!rows?.length) {
      topAlumnosBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">📭 Sin datos.</td></tr>`;
      return;
    }
    topAlumnosBody.innerHTML = rows.map((r, i) =>
      `<tr>
        <td><span class="badge bg-light text-dark me-1">#${i+1}</span>${esc(r.alumno)}</td>
        <td class="text-end fw-semibold">${bs(r.pagado)}</td>
        <td class="text-end">${r.num_pagos}</td>
      </tr>`
    ).join("");
  }

  async function openCursoDetalle(cursoId, cursoName) {
    if (!modalCurso) return;
    setLoading(true);
    setHint(`Cargando detalle de ${cursoName}…`, "muted");
    try {
      const resp   = await apiGetCursoDetalle(cursoId);
      const detalle = resp?.detalle || [];
      const q       = getQuery();
      if (mCursoTitle) mCursoTitle.textContent = `Detalle: ${cursoName}`;
      if (mCursoSub)   mCursoSub.textContent   = `Periodo: ${q.desde} → ${q.hasta} · ${detalle.length} registros`;
      const total = detalle.reduce((s, r) => s + Number(r.monto || 0), 0);
      if (mCursoTotal) mCursoTotal.textContent = bs(total);
      if (mCursoBody) {
        if (!detalle.length) {
          mCursoBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">📭 Sin pagos en el periodo.</td></tr>`;
        } else {
          mCursoBody.innerHTML = detalle.map(r =>
            `<tr>
              <td class="small">${r.id}</td>
              <td class="small">${esc(r.fecha || "—")}</td>
              <td class="small">${esc(r.alumno || "—")}</td>
              <td class="small">${esc(r.ci || "—")}</td>
              <td class="text-end small fw-semibold">${bs(r.monto)}</td>
              <td class="small"><span class="badge bg-light text-dark">${esc(r.estado || "—")}</span></td>
              <td class="small">${esc(r.metodo || "—")}</td>
              <td class="small text-muted">${esc(r.observaciones || "—")}</td>
            </tr>`
          ).join("");
        }
      }
      modalCurso.show();
      setHint(`Detalle listo: ${cursoName}`, "muted");
    } catch (e) {
      console.error(e);
      setHint(`Error: ${e.message}`, "danger");
    } finally {
      setLoading(false);
    }
  }

  async function cargarTodo() {
    setLoading(true);
    setHint("Cargando reportes…", "muted");
    try {
      const q = getQuery();
      const [kResp, tResp, sResp, cursoResp, alumResp] = await Promise.all([
        apiGetKpis(), apiGetTendencia(), apiGetPagosPorEstado(), apiGetTopCursos(), apiGetTopAlumnos(),
      ]);
      const k = kResp?.kpis || {};
      const data = {
        desde: q.desde, hasta: q.hasta,
        kpis: {
          ingresos: Number(k.ingresos || 0), egresos: Number(k.egresos || 0),
          utilidad: Number(k.utilidad || 0), alumnos_activos: Number(k.alumnos_activos || 0),
          inscripciones_activas: Number(k.inscripciones_activas || 0),
        },
        serie_mensual:   tResp?.serie_mensual    || [],
        pagos_por_estado: sResp?.pagos_por_estado || [],
        top_cursos:      cursoResp?.cursos        || [],
        top_alumnos:     alumResp?.alumnos        || [],
      };
      lastKpis = data;
      renderKPIs(data);
      renderCharts(data);
      topCursosCache = data.top_cursos || [];
      topAlumnosCache = data.top_alumnos || [];
      renderTopCursos(data.top_cursos);
      renderTopAlumnos(data.top_alumnos);
      setHint(`Listo · ${data.desde} → ${data.hasta}`, "muted");
    } catch (e) {
      console.error(e);
      setHint(`Error: ${e.message}`, "danger");
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(preset) {
    const now = new Date();
    let desde, hasta = isoFromDate(now);
    if (preset === "7d")  desde = isoFromDate(addDays(now, -6));
    else if (preset === "30d") desde = isoFromDate(addDays(now, -29));
    else if (preset === "90d") desde = isoFromDate(addDays(now, -89));
    else if (preset === "12m") desde = isoFromDate(new Date(now.getFullYear(), now.getMonth() - 11, 1));
    else if (preset === "ytd") desde = isoFromDate(startOfYear(now));
    if (desdeEl) desdeEl.value = desde;
    if (hastaEl) hastaEl.value = hasta;
  }

  // ── GENERAR PDF con jsPDF ─────────────────────────────────────────
  function generarPDF() {
    if (!lastKpis) {
      if (typeof showToast === "function") showToast({ title: "Sin datos", message: "Carga los reportes primero.", type: "warning" });
      return;
    }
    if (typeof window.jspdf === "undefined" && typeof window.jsPDF === "undefined") {
      if (typeof showToast === "function") showToast({ title: "Error", message: "Librería PDF no disponible.", type: "error" });
      return;
    }

    const { jsPDF } = window.jspdf || window;

    // A4 Portrait
    const PAGE_W = 210;
    const PAGE_H = 297;
    const MARGIN = 14;
    const COL_END = PAGE_W - MARGIN;

    const k     = lastKpis.kpis || {};
    const desde = lastKpis.desde || "—";
    const hasta = lastKpis.hasta || "—";
    const now   = new Date().toLocaleString("es-BO");

    // ── Helpers ────────────────────────────────────────────────────
    function sectionTitle(doc, text, y) {
      doc.setFillColor(228, 237, 255);
      doc.rect(MARGIN, y, COL_END - MARGIN, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 40, 100);
      doc.text(text, MARGIN + 3, y + 5);
      doc.setTextColor(0, 0, 0);
      return y + 9;
    }

    function kpiBox(doc, label, value, x, y, w, color) {
      doc.setFillColor(...color);
      doc.roundedRect(x, y, w, 18, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text(value, x + w / 2, y + 10, { align: "center" });
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(label, x + w / 2, y + 15.5, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }

    function drawPageHeader(doc) {
      doc.setFillColor(11, 18, 32);
      doc.rect(0, 0, PAGE_W, 26, "F");
      // Franja de color lateral
      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, 5, 26, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("BARBER SCHOOL", MARGIN + 2, 11);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text("Reporte Financiero", MARGIN + 2, 18);
      doc.text(`Generado: ${now}`, COL_END, 18, { align: "right" });
      doc.setTextColor(0, 0, 0);
    }

    function drawPageFooter(doc, pageNum, totalPages) {
      doc.setFillColor(240, 240, 245);
      doc.rect(0, PAGE_H - 9, PAGE_W, 9, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90, 90, 100);
      doc.text(`Barber School  ·  Reporte Financiero  ·  ${desde} → ${hasta}`, MARGIN, PAGE_H - 3.5);
      doc.text(`Página ${pageNum} de ${totalPages}`, COL_END, PAGE_H - 3.5, { align: "right" });
      doc.setTextColor(0, 0, 0);
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    // Callback para repetir header+footer en páginas generadas por autoTable
    const atPageBreak = (data) => {
      drawPageHeader(doc);
    };

    // ── PÁGINA 1 ───────────────────────────────────────────────────
    drawPageHeader(doc);
    let y = 32;

    // Período
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 80);
    doc.text(`Período analizado:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`${desde}  →  ${hasta}`, MARGIN + 38, y);
    y += 10;

    // KPI boxes
    const boxW = (COL_END - MARGIN - 6) / 3;
    kpiBox(doc, "INGRESOS TOTALES",  bs(k.ingresos || 0),             MARGIN,              y, boxW, [22, 101, 52]);
    kpiBox(doc, "EGRESOS TOTALES",   bs(k.egresos  || 0),             MARGIN + boxW + 3,   y, boxW, [153, 27, 27]);
    kpiBox(doc, "UTILIDAD NETA",     bs(k.utilidad || 0),             MARGIN + (boxW + 3) * 2, y, boxW,
      (k.utilidad || 0) >= 0 ? [7, 89, 133] : [120, 40, 40]);
    y += 24;

    // Info adicional
    doc.setFillColor(248, 250, 255);
    doc.rect(MARGIN, y, COL_END - MARGIN, 10, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(50, 50, 70);
    doc.text(`Alumnos activos: ${k.alumnos_activos || 0}`, MARGIN + 4, y + 6.5);
    doc.text(`Inscripciones activas: ${k.inscripciones_activas || 0}`, MARGIN + 60, y + 6.5);
    doc.setTextColor(0, 0, 0);
    y += 16;

    // ── Tendencia mensual ──────────────────────────────────────────
    if (lastKpis.serie_mensual?.length) {
      y = sectionTitle(doc, "Tendencia Mensual", y);
      doc.autoTable({
        startY: y,
        head:   [["Mes", "Ingresos", "Egresos", "Utilidad"]],
        body:   lastKpis.serie_mensual.map(r => [
          r.mes || "—",
          bs(r.ingresos || 0),
          bs(r.egresos  || 0),
          bs(r.utilidad || 0),
        ]),
        styles:       { fontSize: 8.5, cellPadding: 3.5, lineColor: [210, 220, 235], lineWidth: 0.2 },
        headStyles:   { fillColor: [20, 30, 55], textColor: 255, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 250, 255] },
        margin:       { left: MARGIN, right: MARGIN },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        didDrawPage:  atPageBreak,
        willDrawCell(data) {
          if (data.section === "body" && data.column.index === 3) {
            const val = Number(String(data.cell.raw || "0").replace(/[^0-9.-]/g, "")) || 0;
            if (val < 0) data.cell.styles.textColor = [160, 30, 30];
            else if (val > 0) data.cell.styles.textColor = [25, 100, 50];
          }
        },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Top Cursos ─────────────────────────────────────────────────
    if (topCursosCache?.length) {
      if (y > 250) { doc.addPage(); drawPageHeader(doc); y = 32; }
      y = sectionTitle(doc, "Top Cursos por Ingresos", y);
      doc.autoTable({
        startY: y,
        head:   [["#", "Curso", "Ingresos", "# Pagos"]],
        body:   topCursosCache.slice(0, 15).map((r, i) => [
          i + 1,
          r.curso || "—",
          bs(r.ingresos || 0),
          r.num_pagos || 0,
        ]),
        styles:       { fontSize: 8.5, cellPadding: 3.5, lineColor: [210, 220, 235], lineWidth: 0.2 },
        headStyles:   { fillColor: [20, 30, 55], textColor: 255, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 250, 255] },
        margin:       { left: MARGIN, right: MARGIN },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          2: { halign: "right", fontStyle: "bold" },
          3: { halign: "right" },
        },
        didDrawPage: atPageBreak,
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Top Alumnos ────────────────────────────────────────────────
    if (topAlumnosCache?.length) {
      if (y > 250) { doc.addPage(); drawPageHeader(doc); y = 32; }
      y = sectionTitle(doc, "Top Alumnos por Pagos", y);
      doc.autoTable({
        startY: y,
        head:   [["#", "Alumno", "Pagado", "# Pagos"]],
        body:   topAlumnosCache.slice(0, 15).map((r, i) => [
          i + 1,
          r.alumno || "—",
          bs(r.pagado || 0),
          r.num_pagos || 0,
        ]),
        styles:       { fontSize: 8.5, cellPadding: 3.5, lineColor: [210, 220, 235], lineWidth: 0.2 },
        headStyles:   { fillColor: [20, 30, 55], textColor: 255, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 250, 255] },
        margin:       { left: MARGIN, right: MARGIN },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          2: { halign: "right", fontStyle: "bold" },
          3: { halign: "right" },
        },
        didDrawPage: atPageBreak,
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Pagos por Estado ───────────────────────────────────────────
    if (lastKpis.pagos_por_estado?.length) {
      if (y > 250) { doc.addPage(); drawPageHeader(doc); y = 32; }
      y = sectionTitle(doc, "Resumen de Pagos por Estado", y);
      doc.autoTable({
        startY: y,
        head:   [["Estado", "Cantidad", "Monto Total"]],
        body:   lastKpis.pagos_por_estado.map(r => [
          r.estado || "—",
          r.cantidad || 0,
          bs(r.monto || 0),
        ]),
        styles:       { fontSize: 8.5, cellPadding: 3.5, lineColor: [210, 220, 235], lineWidth: 0.2 },
        headStyles:   { fillColor: [20, 30, 55], textColor: 255, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 250, 255] },
        margin:       { left: MARGIN, right: MARGIN },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
        didDrawPage: atPageBreak,
      });
    }

    // ── Footer en TODAS las páginas ────────────────────────────────
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawPageFooter(doc, p, totalPages);
    }

    // ── Guardar ────────────────────────────────────────────────────
    const filename = `reporte_financiero_${desde}_${hasta}.pdf`;
    doc.save(filename);
    if (typeof showToast === "function") {
      showToast({ title: "PDF guardado", message: filename, type: "success" });
    }
    setHint("PDF generado ✓", "success");
  }


  // ── Init ──────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    if (desdeEl && !desdeEl.value) applyPreset("12m");

    document.querySelectorAll("[data-preset]").forEach(btn => {
      btn.addEventListener("click", () => { applyPreset(btn.dataset.preset); cargarTodo(); });
    });

    if (btnAplicar)   btnAplicar.addEventListener("click",   cargarTodo);
    if (btnRefrescar) btnRefrescar.addEventListener("click", cargarTodo);
    if (qTopCursos)   qTopCursos.addEventListener("input",  () => renderTopCursos(topCursosCache));
    if (btnGuardarPDF) btnGuardarPDF.addEventListener("click", generarPDF);
    if (btnImprimir)   btnImprimir.addEventListener("click", () => { window.print(); setHint("Impresión iniciada", "muted"); });

    await cargarTodo();
  });

})();

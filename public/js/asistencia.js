// public/js/asistencia.js — Versión mejorada: toast + PDF export

// ── Fetch helper ──────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);
  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  if (r.status === 401) { window.location.href = "/login.html"; return null; }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const b = isJson ? await r.json() : await r.text(); msg = b?.error || b?.message || b || msg; } catch (_) {}
    throw new Error(msg);
  }
  return isJson ? r.json() : null;
}

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function toNum(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function parseISO(d) { const [y,m,day] = String(d||"").split("-").map(Number); if (!y||!m||!day) return null; return new Date(y,m-1,day); }
function toISODate(dt) { return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; }

function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();
  const map = [["lunes",1],["martes",2],["miercoles",3],["miércoles",3],["jueves",4],["viernes",5],["sabado",6],["sábado",6],["domingo",0]];
  const out = new Set();
  for (const [name, idx] of map) { if (s.includes(name)) out.add(idx); }
  return Array.from(out).sort((a,b) => a-b);
}

function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
  const start = parseISO(String(fecha_inicio||"").slice(0,10));
  const n     = toNum(nro_clases, 0);
  const wd    = normDiasToWeekdays(dias);
  if (!start || n <= 0 || !wd.length) return [];
  const fechas = [];
  let cursor = new Date(start);
  while (fechas.length < n) {
    if (wd.includes(cursor.getDay())) fechas.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if ((cursor - start) / 86400000 > 1200) break;
  }
  return fechas;
}

function estadoFromDBToUI(estado) {
  const e = String(estado||"").trim().toLowerCase();
  if (e.includes("asist")) return "Asistió";
  if (e.includes("falt"))  return "Faltó";
  if (e.includes("lic") || e.includes("justif")) return "Licencia";
  return "";
}
function estadoUIToDB(estadoUI) {
  const e = String(estadoUI||"").trim().toLowerCase();
  if (e === "asistió" || e === "asistio") return "Asistio";
  if (e === "faltó"   || e === "falto")   return "Falto";
  if (e === "licencia") return "Justificado";
  return "Asistio";
}
function estadoToDotClass(ui) {
  const e = String(ui||"").toLowerCase();
  if (e.includes("asist")) return "as_ok";
  if (e.includes("falt"))  return "as_bad";
  if (e.includes("lic"))   return "as_lic";
  return "as_empty";
}

// ── DOM ───────────────────────────────────────────────────────────
const selCurso    = document.getElementById("aCurso");
const inpBuscar   = document.getElementById("aBuscar");
const msgAs       = document.getElementById("msgAs");
const asGrid      = document.getElementById("asGrid");
const asInfoCurso = document.getElementById("asInfoCurso");
const btnGuardar  = document.getElementById("btnGuardarAsVisual") || document.getElementById("btnGuardarAsistencia") || null;
const btnExportarPDF = document.getElementById("btnExportarAsistenciaPDF");
const asContadorAlumnos = document.getElementById("asContadorAlumnos");
const asContadorClases  = document.getElementById("asContadorClases");

// ── Cache ─────────────────────────────────────────────────────────
let cursosCache     = [];
let fechasCache     = [];
let inscritosCache  = [];
let asistenciasCache = new Map();
let cambiosPendientes = new Map();

// ── API ───────────────────────────────────────────────────────────
async function cargarCursos() {
  const data = await fetchJSON("/api/cursos");
  cursosCache = Array.isArray(data) ? data : [];
  if (!selCurso) return;
  selCurso.innerHTML = cursosCache.length
    ? cursosCache.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")
    : `<option value="">(sin cursos)</option>`;
}

async function getInscritos(cursoId) {
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  let res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  let arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  if (!arr.length) {
    try { const r2 = await fetchJSON(`/api/inscripciones/por-curso/${cursoId}`); arr = Array.isArray(r2) ? r2 : (Array.isArray(r2?.data) ? r2.data : []); } catch(_){}
  }
  return arr.map(r => ({
    inscripcion_id: r.inscripcion_id ?? r.inscripcionId ?? r.id,
    alumno_nombre:  r.alumno_nombre  ?? r.nombre ?? "",
    alumno_documento: r.alumno_documento ?? r.documento ?? "",
  })).filter(x => x.inscripcion_id);
}

async function getAsistenciaDia(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO).slice(0,10) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (inscId) m.set(Number(inscId), estadoFromDBToUI(r.estado));
  }
  return m;
}

// ── Render grid ───────────────────────────────────────────────────
function renderGrid({ fechas, inscritos, filtro }) {
  if (!asGrid) return;
  const q = String(filtro||"").toLowerCase().trim();
  const rows = inscritos.filter(a =>
    !q || String(a.alumno_nombre||"").toLowerCase().includes(q) || String(a.alumno_documento||"").toLowerCase().includes(q)
  );
  asGrid.style.setProperty("--ncols", fechas.length);
  const cells = [];
  cells.push(`<div class="asCell asHead asName">Alumno</div>`);
  cells.push(`<div class="asCell asHead asCI">CI</div>`);
  for (const f of fechas) cells.push(`<div class="asCell asHead"><div class="asDate">${esc(f.slice(5))}</div></div>`);
  for (const a of rows) {
    const inscId = Number(a.inscripcion_id);
    cells.push(`<div class="asCell asName">${esc(a.alumno_nombre||"(sin nombre)")}</div>`);
    cells.push(`<div class="asCell asCI">${esc(a.alumno_documento||"—")}</div>`);
    for (const f of fechas) {
      const key = `${inscId}|${f}`;
      const mapDia = asistenciasCache.get(f);
      const base = mapDia ? (mapDia.get(inscId)||"") : "";
      const val = cambiosPendientes.get(key) ?? base;
      const cls = estadoToDotClass(val);
      cells.push(`<div class="asCell"><button class="asPick" data-insc="${esc(inscId)}" data-fecha="${esc(f)}" title="${esc(val||"Sin registro")}" type="button"><span class="asDot ${esc(cls)}"><span class="asBadge">${val==="Asistió"?"A":val==="Faltó"?"F":val==="Licencia"?"L":""}</span></span></button></div>`);
    }
  }
  if (!rows.length) cells.push(`<div style="grid-column:1/-1;padding:24px;text-align:center;color:#64748b;">📭 No hay alumnos${q?" que coincidan con la búsqueda":""}</div>`);
  asGrid.innerHTML = cells.join("");
  asGrid.querySelectorAll(".asPick").forEach(btn => {
    btn.addEventListener("click", () => {
      abrirSelectorEstado({ inscId: Number(btn.dataset.insc), fecha: btn.dataset.fecha });
    });
  });
  if (asContadorAlumnos) asContadorAlumnos.textContent = `👥 ${rows.length} alumnos`;
  if (asContadorClases)  asContadorClases.textContent  = `🗓️ ${fechas.length} clases`;
}

// ── Menú flotante A/F/L ───────────────────────────────────────────
let asMenuEl = null;
let asMenuState = { inscId: null, fecha: null };

function ensureAsMenu() {
  if (asMenuEl) return asMenuEl;
  asMenuEl = document.createElement("div");
  asMenuEl.id = "asMenu";
  asMenuEl.className = "asMenu shadow";
  asMenuEl.style.cssText = "display:none;position:fixed;z-index:9999;padding:10px;border-radius:12px;background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.10);backdrop-filter:blur(10px);";
  asMenuEl.innerHTML = `
    <div class="btn-group btn-group-sm" role="group" aria-label="Marcar asistencia">
      <button type="button" class="btn btn-success fw-bold" data-val="A" title="Asistió">A</button>
      <button type="button" class="btn btn-danger fw-bold"  data-val="F" title="Faltó">F</button>
      <button type="button" class="btn btn-info text-white fw-bold" data-val="L" title="Licencia">L</button>
    </div>
    <button type="button" class="btn btn-sm btn-light border ms-2" data-val="X" title="Limpiar registro">✕</button>`;
  document.body.appendChild(asMenuEl);

  asMenuEl.addEventListener("click", ev => {
    const btn = ev.target.closest("button[data-val]");
    if (!btn) return;
    const v = btn.dataset.val;
    const { inscId, fecha } = asMenuState;
    if (!inscId || !fecha) return;
    const key = `${inscId}|${fecha}`;
    const nuevo = v === "A" ? "Asistió" : v === "F" ? "Faltó" : v === "L" ? "Licencia" : "";
    if (nuevo === "") cambiosPendientes.delete(key);
    else cambiosPendientes.set(key, nuevo);
    hideAsMenu();
    renderGrid({ fechas: fechasCache, inscritos: inscritosCache, filtro: inpBuscar?.value || "" });
    if (msgAs) msgAs.textContent = `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · cambios pendientes: ${cambiosPendientes.size}`;
  });

  document.addEventListener("mousedown", e => { if (asMenuEl && asMenuEl.style.display !== "none" && !asMenuEl.contains(e.target)) hideAsMenu(); });
  document.addEventListener("keydown", e => {
    if (!asMenuEl || asMenuEl.style.display === "none") return;
    const k = String(e.key||"").toUpperCase();
    if (k === "ESCAPE") return hideAsMenu();
    const fakeBtn = asMenuEl.querySelector(`button[data-val="${k}"]`);
    if (fakeBtn) fakeBtn.click();
  });
  return asMenuEl;
}

function showAsMenuAt({ x, y, inscId, fecha }) {
  const el = ensureAsMenu();
  asMenuState = { inscId, fecha };
  el.style.display = "block";
  const r = el.getBoundingClientRect();
  const pad = 8;
  el.style.left = `${Math.max(pad, Math.min(x, window.innerWidth  - r.width  - pad))}px`;
  el.style.top  = `${Math.max(pad, Math.min(y, window.innerHeight - r.height - pad))}px`;
}

function hideAsMenu() {
  if (!asMenuEl) return;
  asMenuEl.style.display = "none";
  asMenuState = { inscId: null, fecha: null };
}

function abrirSelectorEstado({ inscId, fecha }) {
  const btn = asGrid?.querySelector(`.asPick[data-insc="${inscId}"][data-fecha="${fecha}"]`);
  if (btn) { const r = btn.getBoundingClientRect(); showAsMenuAt({ x: r.left + r.width + 6, y: r.top, inscId, fecha }); }
  else showAsMenuAt({ x: 12, y: 12, inscId, fecha });
}

// ── Guardar cambios ───────────────────────────────────────────────
async function guardarCambios(cursoId) {
  if (!cambiosPendientes.size) {
    if (typeof showToast === "function") showToast({ title: "Sin cambios", message: "No hay cambios para guardar.", type: "info" });
    else alert("No hay cambios para guardar.");
    return;
  }
  const items = [];
  for (const [key, ui] of cambiosPendientes.entries()) {
    const [inscIdStr, fecha] = key.split("|");
    if (!ui) continue;
    items.push({ inscripcion_id: Number(inscIdStr), fecha, estado: estadoUIToDB(ui) });
  }
  if (!items.length) {
    cambiosPendientes.clear();
    if (typeof showToast === "function") showToast({ title: "Sin cambios válidos", type: "info" });
    return;
  }
  if (msgAs) msgAs.textContent = "Guardando cambios...";
  await fetchJSON("/api/asistencia/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  cambiosPendientes.clear();
  await refrescarVisual();
  // ✅ TOAST DE CONFIRMACIÓN
  if (typeof showToast === "function") {
    showToast({ title: "Asistencia guardada correctamente ✅", message: `${inscritosCache.length} alumno(s) actualizados.`, type: "success", duration: 4000 });
  }
  if (msgAs) msgAs.textContent = `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · guardado ✅`;
}

// ── Refrescar visual ──────────────────────────────────────────────
async function refrescarVisual() {
  const cursoId = Number(selCurso?.value || 0);
  const curso   = cursosCache.find(c => Number(c.id) === cursoId);
  if (!cursoId || !curso) {
    if (msgAs) msgAs.textContent = "Selecciona un curso.";
    if (asGrid) asGrid.innerHTML = "";
    if (asInfoCurso) asInfoCurso.textContent = "Selecciona un curso para ver la asistencia.";
    return;
  }
  const instructor = curso.instructor_nombre || curso.instructor || "—";
  const inicio = String(curso.fecha_inicio || curso.fechaInicio || "").slice(0,10) || "—";
  if (asInfoCurso) asInfoCurso.textContent = `${curso.nombre} · Instructor: ${instructor} · Inicio: ${inicio} · Días: ${curso.dias||"—"} · Clases: ${toNum(curso.nro_clases||curso.nroClases,0)}`;
  fechasCache = buildFechasClases({ fecha_inicio: curso.fecha_inicio||curso.fechaInicio||"", dias: curso.dias||"", nro_clases: curso.nro_clases||curso.nroClases||0 });
  if (!fechasCache.length) {
    if (msgAs) msgAs.textContent = "No se pudieron calcular fechas (revisa inicio/días/nro_clases).";
    if (asGrid) asGrid.innerHTML = "";
    return;
  }
  if (msgAs) msgAs.textContent = "Cargando inscritos...";
  inscritosCache = await getInscritos(cursoId);
  if (msgAs) msgAs.textContent = "Cargando asistencia desde BD...";
  asistenciasCache = new Map();
  for (const f of fechasCache) { const m = await getAsistenciaDia(cursoId, f); asistenciasCache.set(f, m); }
  renderGrid({ fechas: fechasCache, inscritos: inscritosCache, filtro: inpBuscar?.value || "" });
  if (msgAs) msgAs.textContent = `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · cambios: ${cambiosPendientes.size}`;
}

// ── Exportar PDF ──────────────────────────────────────────────────
function exportarAsistenciaPDF() {
  const cursoId = Number(selCurso?.value || 0);
  const curso   = cursosCache.find(c => Number(c.id) === cursoId);

  if (!curso) {
    if (typeof showToast === "function") showToast({ title: "Sin curso seleccionado", message: "Selecciona un curso primero.", type: "warning" });
    return;
  }
  if (!inscritosCache.length) {
    if (typeof showToast === "function") showToast({ title: "Sin alumnos", message: "No hay alumnos en este curso.", type: "warning" });
    return;
  }
  if (typeof window.jspdf === "undefined" && typeof window.jsPDF === "undefined") {
    if (typeof showToast === "function") showToast({ title: "Error", message: "Librería PDF no disponible. Ejecuta npm run vendor primero.", type: "error" });
    return;
  }

  const { jsPDF } = window.jspdf || window;

  // ════════════════════════════════════════════════════════════════
  //  CONFIG — ajustar aquí si se necesita más/menos fechas por bloque
  // ════════════════════════════════════════════════════════════════
  const MAX_FECHAS_BLOQUE = 12;   // máx columnas de fecha por sección
  const PAGE_W  = 297;            // A4 landscape mm
  const PAGE_H  = 210;
  const MARGIN  = 10;
  const COL_NUM = 8;
  const COL_ALU = 55;
  const COL_CI  = 24;
  const COL_TOT = 11;
  const COL_LABEL_W = COL_NUM + COL_ALU + COL_CI; // 87mm

  const now        = new Date().toLocaleString("es-BO");
  const instructor = curso.instructor_nombre || curso.instructor || "—";
  const pctFmt     = (n, d) => d ? Math.round((n / d) * 100) + "%" : "0%";

  // ── Calcular totales globales ─────────────────────────────────
  let gA = 0, gF = 0, gL = 0, gV = 0;
  const alumnoStats = inscritosCache.map(a => {
    const id = Number(a.inscripcion_id);
    let cA = 0, cF = 0, cL = 0;
    for (const f of fechasCache) {
      const base = asistenciasCache.get(f)?.get(id) || "";
      const val  = cambiosPendientes.get(`${id}|${f}`) ?? base;
      if (val === "Asistió")  { cA++; gA++; }
      else if (val === "Faltó")   { cF++; gF++; }
      else if (val === "Licencia"){ cL++; gL++; }
      else gV++;
    }
    return { ...a, cA, cF, cL };
  });
  const totalRegistros = inscritosCache.length * fechasCache.length;

  // ── Dividir fechas en bloques ─────────────────────────────────
  const bloques = [];
  for (let i = 0; i < fechasCache.length; i += MAX_FECHAS_BLOQUE) {
    bloques.push(fechasCache.slice(i, i + MAX_FECHAS_BLOQUE));
  }
  if (bloques.length === 0) bloques.push([]); // sin fechas igual genera

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // ── Función: dibuja el encabezado de página ───────────────────
  function drawPageHeader(doc, isFirstPage) {
    // Barra azul oscuro
    doc.setFillColor(11, 18, 32);
    doc.rect(0, 0, PAGE_W, 24, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("BARBER SCHOOL — Planilla de Asistencia", MARGIN, 10);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const infoLine = `Curso: ${curso.nombre}  ·  Instructor: ${instructor}  ·  Días: ${curso.dias || "—"}  ·  Clases: ${fechasCache.length}`;
    doc.text(infoLine, MARGIN, 17);
    doc.text(`Generado: ${now}`, PAGE_W - MARGIN, 17, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  // ── Función: dibuja el resumen KPI (solo primera página) ──────
  function drawKpis(doc, y) {
    doc.setFillColor(235, 245, 255);
    doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 16, 2, 2, "F");

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");

    doc.setTextColor(22, 101, 52);
    doc.text(`✔ Asistencias: ${gA}  (${pctFmt(gA, totalRegistros)})`, MARGIN + 4, y + 6);
    doc.setTextColor(153, 27, 27);
    doc.text(`✗ Faltas: ${gF}  (${pctFmt(gF, totalRegistros)})`, MARGIN + 72, y + 6);
    doc.setTextColor(2, 132, 199);
    doc.text(`◷ Licencias: ${gL}  (${pctFmt(gL, totalRegistros)})`, MARGIN + 144, y + 6);
    doc.setTextColor(100, 116, 139);
    doc.text(`○ Sin registro: ${gV}`, MARGIN + 214, y + 6);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`% Asistencia total: ${pctFmt(gA, gA + gF + gL || 1)}`, PAGE_W - MARGIN, y + 10, { align: "right" });

    // Etiquetas de leyenda
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(80, 80, 80);
    doc.text("A = Asistió  |  F = Faltó  |  L = Licencia", MARGIN + 4, y + 13);
    doc.setTextColor(0, 0, 0);

    return y + 20;
  }

  // ── Función: dibuja un bloque de fechas ───────────────────────
  function drawBloque(doc, bloque, bloqueIdx, y, isFirst) {
    const nFechas   = bloque.length;
    const hasDates  = nFechas > 0;
    const isLast    = bloqueIdx === bloques.length - 1;
    const usableW   = PAGE_W - MARGIN * 2;

    // Ancho de columna de fecha: distribuir espacio restante
    const reservedW = COL_NUM + COL_ALU + COL_CI + (isLast ? COL_TOT * 3 : 0);
    const dateColW  = hasDates
      ? Math.max(9, Math.min(16, (usableW - reservedW) / nFechas))
      : 0;

    // ── Encabezado del bloque ─────────────────────────────────
    if (bloques.length > 1) {
      doc.setFillColor(228, 240, 255);
      doc.rect(MARGIN, y, usableW, 7, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 60, 120);
      const range = hasDates
        ? `Clases ${bloqueIdx * MAX_FECHAS_BLOQUE + 1} – ${bloqueIdx * MAX_FECHAS_BLOQUE + nFechas}  ·  ${bloque[0].slice(5)} → ${bloque[nFechas - 1].slice(5)}`
        : "Sin fechas";
      doc.text(`Bloque ${bloqueIdx + 1} / ${bloques.length}  —  ${range}`, MARGIN + 3, y + 5);
      doc.setTextColor(0, 0, 0);
      y += 9;
    }

    // ── Preparar columnas para autoTable ─────────────────────
    const headRow = ["#", "Alumno", "CI"];
    if (hasDates) bloque.forEach(f => headRow.push(f.slice(5))); // MM-DD
    if (isLast)   headRow.push("A", "F", "L");

    const bodyRows = alumnoStats.map((a, idx) => {
      const id   = Number(a.inscripcion_id);
      const row  = [idx + 1, a.alumno_nombre || "—", a.alumno_documento || "—"];
      const cellMeta = []; // para colorear

      if (hasDates) {
        bloque.forEach(f => {
          const base = asistenciasCache.get(f)?.get(id) || "";
          const val  = cambiosPendientes.get(`${id}|${f}`) ?? base;
          const sym  = val === "Asistió" ? "A" : val === "Faltó" ? "F" : val === "Licencia" ? "L" : "";
          row.push(sym);
        });
      }
      if (isLast) row.push(a.cA, a.cF, a.cL);
      return row;
    });

    // Estilos de columnas
    const colStyles = {
      0: { cellWidth: COL_NUM, halign: "center" },
      1: { cellWidth: COL_ALU, overflow: "ellipsize" },
      2: { cellWidth: COL_CI,  halign: "center" },
    };
    if (hasDates) {
      bloque.forEach((_, i) => {
        colStyles[3 + i] = { cellWidth: dateColW, halign: "center", fontSize: 7 };
      });
    }
    if (isLast) {
      const base = 3 + nFechas;
      colStyles[base]     = { cellWidth: COL_TOT, halign: "center", fontStyle: "bold", fillColor: [230, 255, 235] };
      colStyles[base + 1] = { cellWidth: COL_TOT, halign: "center", fontStyle: "bold", fillColor: [255, 235, 235] };
      colStyles[base + 2] = { cellWidth: COL_TOT, halign: "center", fontStyle: "bold", fillColor: [225, 240, 255] };
    }

    doc.autoTable({
      startY:    y,
      head:      [headRow],
      body:      bodyRows,
      styles:    { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 }, overflow: "ellipsize", lineColor: [210, 220, 235], lineWidth: 0.2 },
      headStyles:{ fillColor: [20, 30, 55], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5, halign: "center" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: colStyles,
      margin:    { left: MARGIN, right: MARGIN },
      tableLineColor: [180, 195, 215],
      tableLineWidth: 0.25,
      didDrawCell(data) {
        if (data.section !== "body" || !hasDates) return;
        const colIdx = data.column.index;
        if (colIdx < 3 || colIdx >= 3 + nFechas) return;
        const v = String(data.cell.raw || "");
        let bg = null, fg = null;
        if      (v === "A") { bg = [212, 250, 229]; fg = [21, 94, 47]; }
        else if (v === "F") { bg = [254, 218, 218]; fg = [139, 26, 26]; }
        else if (v === "L") { bg = [210, 236, 252]; fg = [3, 105, 161]; }
        if (bg) {
          doc.setFillColor(...bg);
          doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, "F");
          doc.setTextColor(...fg);
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "bold");
          doc.text(v, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 2.5, { align: "center" });
          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "normal");
        }
      },
      didDrawPage(data) {
        // Re-dibujar encabezado en cada nueva página generada por autoTable
        drawPageHeader(doc, false);
        // Pie de página temporal (se sobreescribirá al final)
        doc.setFontSize(7);
        doc.setTextColor(140);
        doc.text("Barber School", MARGIN, PAGE_H - 4);
      },
    });

    return doc.lastAutoTable.finalY + 8;
  }

  // ════════════════════════════════════════════════════════════════
  //  RENDERIZAR DOCUMENTO
  // ════════════════════════════════════════════════════════════════
  drawPageHeader(doc, true);
  let y = 28;

  y = drawKpis(doc, y);

  for (let bi = 0; bi < bloques.length; bi++) {
    // Si no cabe otro bloque en la página actual, agregar página nueva
    // (aprox 8mm de header bloque + 12mm de header tabla + 9mm por fila media)
    const spaceLeft = PAGE_H - y - 8; // margen inferior
    const estimatedH = 8 + 10 + inscritosCache.length * 8;
    if (bi > 0 && spaceLeft < Math.min(estimatedH, 60)) {
      doc.addPage();
      drawPageHeader(doc, false);
      y = 28;
    }

    y = drawBloque(doc, bloques[bi], bi, y, true);
  }

  // ── Pie de página en TODAS las páginas ────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(235, 235, 240);
    doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 100);
    doc.setFont("helvetica", "normal");
    doc.text(`Barber School  ·  Planilla de Asistencia  ·  Generado: ${now}`, MARGIN, PAGE_H - 3);
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 3, { align: "right" });
  }

  const safeName = (curso.nombre || "curso").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `asistencia_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);

  if (typeof showToast === "function") {
    showToast({ title: "PDF guardado", message: `${filename}  (${bloques.length} bloque${bloques.length !== 1 ? "s" : ""}, ${totalPages} página${totalPages !== 1 ? "s" : ""})`, type: "success" });
  }
}


// ── Eventos ───────────────────────────────────────────────────────
selCurso?.addEventListener("change", async () => { cambiosPendientes.clear(); await refrescarVisual(); });
inpBuscar?.addEventListener("input", () => { renderGrid({ fechas: fechasCache, inscritos: inscritosCache, filtro: inpBuscar?.value||"" }); });

btnGuardar?.addEventListener("click", async () => {
  const cursoId = Number(selCurso?.value || 0);
  if (!cursoId) {
    if (typeof showToast === "function") showToast({ title: "Sin curso", message: "Selecciona un curso.", type: "warning" });
    else alert("Selecciona un curso.");
    return;
  }
  try { await guardarCambios(cursoId); }
  catch (e) {
    console.error(e);
    if (typeof showToast === "function") showToast({ title: "Error al guardar", message: e.message || "Error desconocido", type: "error" });
    else alert("Error guardando: " + (e.message || "desconocido"));
  }
});

btnExportarPDF?.addEventListener("click", exportarAsistenciaPDF);

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await cargarCursos();
    await refrescarVisual();
  } catch (e) {
    console.error(e);
    if (msgAs)  msgAs.textContent = "Error cargando asistencia.";
    if (asGrid) asGrid.innerHTML  = `<div class="text-danger small p-3">Error: ${esc(e.message||"desconocido")}</div>`;
  }
});

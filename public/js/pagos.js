// public/js/pagos.js
(() => {
  "use strict";

  // ================= HTTP =================
  async function fetchJSON(url, options = {}) {
    options.credentials = "include";

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000); // 25s

    let r;
    try {
      r = await fetch(url, { ...options, signal: ctrl.signal });
    } catch (e) {
      if (e?.name === "AbortError") throw new Error("Tiempo de espera agotado");
      throw e;
    } finally {
      clearTimeout(t);
    }

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

  // ================= estado global =================
  let cursosCache = [];
  let deudoresCache = [];
  let cursoPagadoCompleto = false;
  let saldoCursoActual = null;
  let openingFromDeudores = false;

  let alumnosCache = [];

  let cuotasModelo = []; // [{nro, monto}]
  let cuotaFechas = []; // index 1..n => 'YYYY-MM-DD'
  let cuotaSeleccionada = null; // idx 0..n-1

  let pagosPorCuota = new Map(); // nro -> pagoRow
  let pagoSeleccionado = null;

  let selectedAlumnoId = "";
  let selectedAlumnoDocumento = "";
  let selectedAlumnoNombre = "";

  let prevNroCuotas = null;

function resetCuotasState() {
  cuotasModelo = [];
  cuotaFechas = [];
  cuotaSeleccionada = null;

  pagosPorCuota = new Map();
  pagoSeleccionado = null;

  prevNroCuotas = 1;

  if (pgCuotasList) pgCuotasList.innerHTML = "";
  if (pgTotalPagado) pgTotalPagado.textContent = "0";
  if (pgSaldo) pgSaldo.textContent = "0";
}

function resetPagoModalState({ keepCurso = false, keepAlumno = false } = {}) {
  // Curso
  if (!keepCurso) {
    if (pgCursoId) pgCursoId.value = "";
  }

  // Cuotas
  resetCuotasState();
  if (pgNroCuotas) {
    pgNroCuotas.value = "1";
    pgNroCuotas.disabled = false;
  }

  // Alumno
  if (!keepAlumno) {
    if (pgDocumento) pgDocumento.value = "";
    if (pgAlumno) pgAlumno.value = "";
    clearAlumnoUI();
  }

  // Otros
  if (pgObs) pgObs.value = "";
  if (msgPago) {
    msgPago.textContent = "";
    msgPago.className = "text-muted";
  }

  cursoPagadoCompleto = false;
  saldoCursoActual = null;
  if (btnGuardarPago) btnGuardarPago.disabled = false;
}



  // ================= ELEMENTOS (FILTROS) =================
  const btnFiltrarPagos = document.getElementById("btnFiltrarPagos");
  const pBuscar = document.getElementById("pBuscar");
  const pEstado = document.getElementById("pEstado");
  const pMes = document.getElementById("pMes");
  const pResumen = document.getElementById("pResumen");
  const tablaPagosBody = document.querySelector("#tablaPagos tbody");

  // ================= ELEMENTOS (MODAL) =================
  const formPago = document.getElementById("formPago");
  const msgPago = document.getElementById("msgPago");
  const btnGuardarPago = formPago?.querySelector('button[type="submit"]');

  const pgCursoId = document.getElementById("pgCursoId");
  const pgNroCuotas = document.getElementById("pgNroCuotas");

  const pgDocumento = document.getElementById("pgDocumento");
  const pgAlumno = document.getElementById("pgAlumno");
  const pgAlumnoId = document.getElementById("pgAlumnoId");

  const pgMetodo = document.getElementById("pgMetodo");
  const pgFecha = document.getElementById("pgFecha");
  const pgObs = document.getElementById("pgObs");

  const pgTotalCurso = document.getElementById("pgTotalCurso");
  const pgCursoInfo = document.getElementById("pgCursoInfo");
  const pgCuotasList = document.getElementById("pgCuotasList");
  const pgTotalPagado = document.getElementById("pgTotalPagado");
  const pgSaldo = document.getElementById("pgSaldo");

  const pgAlumnosDL = document.getElementById("pgAlumnosDL");
  const pgDocDL = document.getElementById("pgDocDL");

  const pgAlumnosList = document.getElementById("pgAlumnosList");
  const pgAlumnoSearch = document.getElementById("pgAlumnoSearch");
  const pgAlumnoSearchBtn = document.getElementById("pgAlumnoSearchBtn");

  // ================= API =================
  async function apiGetCursos() {
    const data = await fetchJSON("/api/cursos");
    return Array.isArray(data) ? data : [];
  }

  async function apiGetAlumnos() {
    const data = await fetchJSON("/api/alumnos");
    return Array.isArray(data) ? data : [];
  }


  // Deudores por curso (solo alumnos con saldo > 0)
  async function apiGetDeudores({ curso_id, q = "" } = {}) {
    const p = new URLSearchParams();
    if (curso_id) p.append("curso_id", String(curso_id));
    if (q) p.append("q", String(q));
    const data = await fetchJSON(`/api/reportes/deudores?${p.toString()}`);
    // backend retorna { ok:true, data:[...] }
    return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  }

  // Reset plan de cuotas: borra pagos de una inscripción (cuando el usuario confirma cambio de nro cuotas)
  async function apiResetPlan(inscripcion_id) {
    return fetchJSON("/api/pagos/reset-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscripcion_id }),
    });
  }

  async function apiGetAlumnoByDocumento(doc) {
    try {
      return await fetchJSON(`/api/alumnos/by-documento/${encodeURIComponent(doc)}`);
    } catch (_) {
      return null;
    }
  }

  async function apiGetPagos(params = {}) {
    const p = new URLSearchParams();
    if (params.q) p.append("q", params.q);
    if (params.buscar) p.append("buscar", params.buscar);
    if (params.estado) p.append("estado", params.estado);
    if (params.mes) p.append("mes", params.mes);

    const qs = p.toString();
    const data = await fetchJSON("/api/pagos" + (qs ? `?${qs}` : ""));
    // tu backend devuelve array directo
    return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  }

  async function apiPostPago(payload) {
    return fetchJSON("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function apiDeletePago(id) {
    if (!id) throw new Error("ID inválido");
    return fetchJSON(`/api/pagos/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // ================= INSCRIPCIONES (para obtener inscripcion_id) =================
  async function apiFindInscripcionActiva(alumno_id, curso_id) {
    const qs = new URLSearchParams({
      alumno_id: String(alumno_id || ""),
      curso_id: String(curso_id || ""),
      estado: "Activa",
      limit: "1",
      offset: "0",
    }).toString();

    const res = await fetchJSON(`/api/inscripciones?${qs}`);
    const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    const row = rows[0];
    return row?.inscripcion_id || row?.id || null;
  }

// ❌ NO auto-crear inscripciones desde Pagos.
// Pago debe requerir inscripcion_id existente (flujo: primero Inscribir, luego Pagar).
async function getInscripcionIdRequired(alumno_id, curso_id) {
  const insId = await apiFindInscripcionActiva(alumno_id, curso_id);
  if (insId) return insId;

  const err = new Error("El alumno no está inscrito en este curso. Primero inscribe y luego registra el pago.");
  err.code = "NO_INSCRIPCION";
  throw err;
}




  // ================= HELPERS =================
  function normStr(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : "";
  }

  function isoDateOrEmpty(s) {
    const v = String(s || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  }

  function parseCuotaNroFromObs(obs) {
    const m = String(obs || "").match(/cuota\s*([0-9]+)/i);
    return m ? Number(m[1]) : null;
  }

  function getCursoSel() {
    return cursosCache.find((c) => String(c.id) === String(pgCursoId?.value)) || null;
  }

  function setAlumnoUI(a) {
    if (!a) return;
    pgAlumno.value = a.nombre || "";
    pgDocumento.value = a.documento || "";
    pgAlumnoId.value = a.id || "";

    selectedAlumnoId = String(a.id || "");
    selectedAlumnoDocumento = String(a.documento || "");
    selectedAlumnoNombre = String(a.nombre || "");
  }

  function clearAlumnoUI() {
    pgAlumnoId.value = "";
    selectedAlumnoId = "";
    selectedAlumnoDocumento = "";
    selectedAlumnoNombre = "";

    // ✅ clave: si cambia alumno, no deben quedar cuotas anteriores
    resetCuotasState();
    if (pgNroCuotas) {
      pgNroCuotas.value = "1";
      pgNroCuotas.disabled = false;
    }
    if (btnGuardarPago) btnGuardarPago.disabled = false;
    cursoPagadoCompleto = false;
    saldoCursoActual = null;
  }

  function splitDias(diasStr) {
    const raw = String(diasStr || "").trim();
    if (!raw) return [];
    return raw
      .split(/[\-\,\/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function weekdayFromEsName(name) {
    const n = String(name || "").toLowerCase();
    if (n.startsWith("lun")) return 1;
    if (n.startsWith("mar")) return 2;
    if (n.startsWith("mie") || n.startsWith("mié")) return 3;
    if (n.startsWith("jue")) return 4;
    if (n.startsWith("vie")) return 5;
    if (n.startsWith("sab") || n.startsWith("sáb")) return 6;
    if (n.startsWith("dom")) return 0;
    return null;
  }

  function addDays(iso, days) {
    const [y, m, d] = iso.split("-").map((x) => Number(x));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function compareISO(a, b) {
    return String(a).localeCompare(String(b));
  }

  // Genera fechas de clases reales según dias y nro_clases.
  function buildCourseOccurrences(curso) {
    const start = isoDateOrEmpty(curso?.fecha_inicio);
    const nro = Number(curso?.nro_clases || 0);
    if (!start || !Number.isFinite(nro) || nro <= 0) return [];

    const dias = splitDias(curso?.dias);
    const wdays = dias.map(weekdayFromEsName).filter((x) => x != null);
    const wset = new Set(wdays.length ? wdays : [new Date(start + "T00:00:00Z").getUTCDay()]);

    const out = [];
    let cursor = start;
    for (let guard = 0; guard < 800 && out.length < nro; guard++) {
      const dt = new Date(cursor + "T00:00:00Z");
      const wd = dt.getUTCDay();
      if (wset.has(wd)) out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  function computeCourseEnd(curso) {
    const occ = buildCourseOccurrences(curso);
    return occ.length ? occ[occ.length - 1] : "";
  }

  function computeDefaultCuotaFechas(curso, nroCuotas) {
    const start = isoDateOrEmpty(curso?.fecha_inicio);
    const occ = buildCourseOccurrences(curso);
    const end = occ.length ? occ[occ.length - 1] : "";

    const out = Array.from({ length: nroCuotas + 1 }, () => ""); // 0 unused
    if (!start) return out;

    if (!end) {
      for (let k = 1; k <= nroCuotas; k++) out[k] = start;
      return out;
    }

    const totalClases = occ.length;
    for (let k = 1; k <= nroCuotas; k++) {
      const idx1 = Math.ceil((k * totalClases) / nroCuotas) - 1;
      const idx = Math.max(0, Math.min(totalClases - 1, idx1));
      out[k] = occ[idx] || end;
    }
    return out;
  }

  function setFechaConstraintsForSelectedCuota() {
    const curso = getCursoSel();
    const start = isoDateOrEmpty(curso?.fecha_inicio);
    const end = computeCourseEnd(curso);

    if (!pgFecha) return;

    const nro = cuotaSeleccionada != null ? cuotasModelo[cuotaSeleccionada]?.nro : null;
    pgFecha.max = end || "";

    if (nro && nro >= 2 && start) pgFecha.min = start;
    else pgFecha.min = "";
  }

  // ================= UI: CURSOS =================
  function fillCursosSelect() {
    if (!pgCursoId) return;
    pgCursoId.innerHTML = cursosCache.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  }

  // ================= UI: ALUMNOS =================
  function fillAlumnosAutocomplete() {
    if (pgAlumnosDL) {
      pgAlumnosDL.innerHTML = alumnosCache
        .slice(0, 500)
        .map((a) => `<option value="${esc(a.nombre)}"></option>`)
        .join("");
    }

    if (pgDocDL) {
      pgDocDL.innerHTML = alumnosCache
        .slice(0, 500)
        .map((a) => `<option value="${esc(a.documento)}">${esc(a.nombre)}</option>`)
        .join("");
    }
  }

  
  function fillAlumnosList(list) {
    if (!pgAlumnosList) return;

    if (!Array.isArray(list) || !list.length) {
      pgAlumnosList.innerHTML = `<div class="text-muted small p-2">No hay alumnos con deuda para este curso.</div>`;
      return;
    }

    pgAlumnosList.innerHTML = list
      .slice(0, 300)
      .map((row) => {
        // row puede venir desde deudores (con monto_adeudado/inscripcion_id) o desde alumnosCache
        const alumnoId = row.alumno_id ?? row.id;
        const nombre = row.alumno_nombre ?? row.nombre ?? "";
        const documento = row.alumno_documento ?? row.documento ?? "";
        const deuda = Number(row.monto_adeudado ?? row.deuda ?? NaN);

        const right = Number.isFinite(deuda)
          ? `<span class="badge text-bg-warning">Debe: ${bs(deuda)}</span>`
          : `<span class="text-muted">${esc(documento)}</span>`;

        return `
      <button type="button" class="list-group-item list-group-item-action" 
              data-id="${esc(alumnoId)}" 
              data-ins="${esc(row.inscripcion_id ?? "")}">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div class="fw-semibold text-truncate">${esc(nombre)}</div>
          <div class="text-nowrap">${right}</div>
        </div>
        <div class="small text-muted">${esc(documento)}</div>
      </button>
    `;
      })
      .join("");

    pgAlumnosList.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const a = alumnosCache.find((x) => String(x.id) === String(id)) || null;
        if (a) {
          setAlumnoUI(a);
          await refreshPagosPorCuota();
          renderCuotas();
          if (msgPago) {
            msgPago.textContent = "Alumno seleccionado ✔";
            msgPago.className = "text-muted";
          }
        }
      });
    });
  }

  async function refreshDeudoresList({ q = "" } = {}) {
    const cursoId = normStr(pgCursoId?.value);
    if (!cursoId) {
      deudoresCache = [];
      fillAlumnosList([]);
      return;
    }
    try {
      const rows = await apiGetDeudores({ curso_id: cursoId, q });
      deudoresCache = Array.isArray(rows) ? rows : [];
      fillAlumnosList(deudoresCache);
    } catch (e) {
      console.error(e);
      deudoresCache = [];
      if (pgAlumnosList) {
        pgAlumnosList.innerHTML = `<div class="text-danger small p-2">Error cargando alumnos con deuda.</div>`;
      }
    }
  }

  function totalPagadoCursoActual() {
    const rows = Array.from(pagosPorCuota?.values?.() || []);
    return rows.reduce((acc, r) => acc + Number(r?.monto || 0), 0);
  }

  function applyCursoPagadoUI({ totalPagado = 0, totalCurso = 0 } = {}) {
    const saldo = Math.max(0, Number(totalCurso || 0) - Number(totalPagado || 0));
    saldoCursoActual = saldo;
    cursoPagadoCompleto = saldo <= 0 && totalCurso > 0;

    if (pgTotalPagado) pgTotalPagado.textContent = bs(totalPagado);
    if (pgSaldo) pgSaldo.textContent = bs(saldo);

    if (cursoPagadoCompleto) {
      if (msgPago) {
        msgPago.textContent = "Este alumno no tiene deuda en este curso. Curso pagado completo.";
        msgPago.className = "text-muted";
      }
      if (pgNroCuotas) {
        pgNroCuotas.value = "1";
        pgNroCuotas.disabled = true;
      }
      if (btnGuardarPago) btnGuardarPago.disabled = true;
    } else {
      if (pgNroCuotas) pgNroCuotas.disabled = false;
      if (btnGuardarPago) btnGuardarPago.disabled = false;
    }
  }

async function refreshPagosPorCuota() {
    pagosPorCuota = new Map();
    pagoSeleccionado = null;
    if (btnGuardarPago) btnGuardarPago.disabled = false;

    const doc = normStr(pgDocumento?.value);
    const cursoId = normStr(pgCursoId?.value);
    if (!doc || !cursoId) return;

    let rows = [];
    try {
      rows = await apiGetPagos({ q: doc });
    } catch (_) {
      return;
    }

    const filtrados = rows.filter(
      (r) => normStr(r.alumno_documento) === doc && String(r.curso_id) === String(cursoId)
    );

    const curso = getCursoSel();
    const totalCurso = Number(curso?.precio || 0);
    const totalPagado = filtrados
      .filter(r => String(r.estado || '').toLowerCase() === 'pagado')
      .reduce((acc, r) => acc + Number(r.monto || 0), 0);

    for (const r of filtrados) {
      const nro = parseCuotaNroFromObs(r.observaciones);
      if (!nro) continue;
      const prev = pagosPorCuota.get(nro);
      if (!prev) {
        pagosPorCuota.set(nro, r);
      } else {
        const a = `${isoDateOrEmpty(prev.fecha)}-${String(prev.id || 0)}`;
        const b = `${isoDateOrEmpty(r.fecha)}-${String(r.id || 0)}`;
        if (b > a) pagosPorCuota.set(nro, r);
      }
    }
    applyCursoPagadoUI({ totalPagado, totalCurso });

  }

  // ================= CUOTAS =================
  function rebuildCuotas() {
    const curso = getCursoSel();
    if (!curso) {
      cuotasModelo = [];
      cuotaFechas = [];
      cuotaSeleccionada = null;
      pagoSeleccionado = null;
      renderCuotas();
      return;
    }

    const total = Number(curso.precio || 0);
    const n = Number(pgNroCuotas?.value || 1);
    const montoCuota = n ? total / n : total;

    cuotasModelo = Array.from({ length: n }, (_, i) => ({
      nro: i + 1,
      monto: Number(montoCuota.toFixed(2)),
    }));

    cuotaFechas = computeDefaultCuotaFechas(curso, n);
    cuotaSeleccionada = null;
    pagoSeleccionado = null;
    renderCuotas();
  }

  function renderCuotas() {
    const curso = getCursoSel();
    const total = Number(curso?.precio || 0);

    if (pgTotalCurso) pgTotalCurso.textContent = bs(total);
    if (pgCursoInfo)
      pgCursoInfo.textContent = curso ? `Precio: ${bs(curso.precio)} · Curso: ${curso.nombre}` : "—";

    if (!cuotasModelo.length) {
      if (pgCuotasList) pgCuotasList.innerHTML = `<div class="text-muted">No hay cuotas</div>`;
      if (pgTotalPagado) pgTotalPagado.textContent = bs(0);
      if (pgSaldo) pgSaldo.textContent = bs(total);
      return;
    }

    if (pgCuotasList) {
      pgCuotasList.innerHTML = cuotasModelo
        .map((c, i) => {
          const pago = pagosPorCuota.get(c.nro);
          const isSelected = cuotaSeleccionada === i;

          let cls = "btn-outline-secondary";
          if (pago) cls = "btn-outline-primary";
          if (isSelected) cls = "btn-success";

          const badge = pago ? `<span class="ms-2 badge text-bg-primary">Pagado</span>` : "";
          const due = cuotaFechas?.[c.nro]
            ? `<div class="small text-muted">Vence: ${cuotaFechas[c.nro]}</div>`
            : "";

          return `
            <button type="button" class="btn btn-sm ${cls} text-start" data-idx="${i}">
              <div class="d-flex justify-content-between align-items-center">
                <div>Cuota ${c.nro} — ${bs(c.monto)}</div>
                <div>${badge}</div>
              </div>
              ${due}
            </button>
          `;
        })
        .join("");

      pgCuotasList.querySelectorAll("button[data-idx]").forEach((b) => {
        b.addEventListener("click", () => {
          cuotaSeleccionada = Number(b.dataset.idx);
          const cuota = cuotasModelo[cuotaSeleccionada];
          const pago = pagosPorCuota.get(cuota.nro) || null;
          pagoSeleccionado = pago;

          setFechaConstraintsForSelectedCuota();

          if (pago) {
            if (pgFecha) pgFecha.value = isoDateOrEmpty(pago.fecha) || pgFecha.value;
            if (pgMetodo && pago.metodo) pgMetodo.value = pago.metodo;
            if (pgObs) pgObs.value = String(pago.observaciones || "");

            if (msgPago) {
              msgPago.textContent = `Esta cuota ya fue pagada el ${isoDateOrEmpty(pago.fecha) || "(sin fecha)"} (${pago.metodo || "—"}).`;
              msgPago.className = "text-primary";
            }
            if (btnGuardarPago) btnGuardarPago.disabled = true;
          } else {
            if (btnGuardarPago) btnGuardarPago.disabled = false;

            if (pgFecha) {
              const sug = cuotaFechas?.[cuota.nro] || "";
              if (sug) pgFecha.value = sug;
            }

            if (pgObs) {
              const cur = normStr(pgObs.value);
              const isDefaultLike = !cur || /^cuota\s*\d+/i.test(cur);
              if (isDefaultLike) {
                pgObs.value = `Cuota ${cuota.nro} - ${curso?.nombre || ""}`.trim();
              }
            }

            if (msgPago) {
              msgPago.textContent = "";
              msgPago.className = "text-muted";
            }
          }

          const pagado = cuota?.monto || 0;
          if (pgTotalPagado) pgTotalPagado.textContent = bs(pagado);
          if (pgSaldo) pgSaldo.textContent = bs(Math.max(0, total - pagado));

          renderCuotas();
        });
      });
    }

    const pagado = cuotaSeleccionada != null ? cuotasModelo[cuotaSeleccionada].monto : 0;
    if (pgTotalPagado) pgTotalPagado.textContent = bs(pagado);
    if (pgSaldo) pgSaldo.textContent = bs(Math.max(0, total - pagado));
  }

  // ================= TABLA PAGOS =================
  function setTablaLoading() {
    if (!tablaPagosBody) return;
    tablaPagosBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Cargando pagos...</td></tr>`;
  }

  function renderPagosTable(rows) {
    if (!tablaPagosBody) return;

    if (!rows.length) {
      tablaPagosBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No hay pagos.</td></tr>`;
      if (pResumen) pResumen.textContent = "0 pagos";
      return;
    }

    tablaPagosBody.innerHTML = rows
      .map((r) => {
        const estado = r.estado || "Pendiente";
        const badge =
          estado === "Pagado" ? "bg-success" : estado === "Vencido" ? "bg-danger" : "bg-secondary";

        return `
          <tr>
            <td>${esc(r.id)}</td>
            <td>${esc((r.fecha || "").slice(0, 10) || "—")}</td>
            <td>${esc(r.alumno_nombre || "—")}</td>
            <td>${esc(r.alumno_documento || "—")}</td>
            <td>${esc(r.curso_nombre || "—")}</td>
            <td class="text-end">${bs(r.monto)}</td>
            <td><span class="badge ${badge}">${esc(estado)}</span></td>
            <td>${esc(r.metodo || "—")}</td>
            <td class="text-muted small">${esc(r.observaciones || "—")}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-danger" data-del-id="${esc(r.id)}">
                Eliminar
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    // ✅ listeners eliminar (DESPUÉS del innerHTML)
    tablaPagosBody.querySelectorAll("button[data-del-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-id");
        const ok = window.confirm(`¿Eliminar el pago #${id}? Esta acción no se puede deshacer.`);
        if (!ok) return;

        try {
          btn.disabled = true;
          await apiDeletePago(id);
          await cargarPagos();
          await refreshPagosPorCuota();
          renderCuotas();
        } catch (e) {
          alert("No se pudo eliminar: " + String(e.message || e));
        } finally {
          btn.disabled = false;
        }
      });
    });

    if (pResumen) pResumen.textContent = `${rows.length} pago${rows.length !== 1 ? "s" : ""}`;
  }

  async function cargarPagos() {
    const q = (pBuscar?.value || "").trim();
    const estado = (pEstado?.value || "").trim();
    const mes = (pMes?.value || "").trim();

    const params = {};
    if (q) params.q = q;
    if (estado && estado !== "Todos") params.estado = estado;
    if (mes) params.mes = mes;

    setTablaLoading();

    try {
      const rows = await apiGetPagos(params);
      renderPagosTable(rows);
    } catch (e) {
      console.error(e);
      if (tablaPagosBody) {
        tablaPagosBody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error: ${esc(
          e.message || e
        )}</td></tr>`;
      }
      if (pResumen) pResumen.textContent = "0 pagos";
    }
  }

  // ================= EVENTOS (FILTROS) =================
  btnFiltrarPagos?.addEventListener("click", cargarPagos);
  pBuscar?.addEventListener("keydown", (e) => e.key === "Enter" && cargarPagos());
  pEstado?.addEventListener("change", cargarPagos);
  pMes?.addEventListener("change", cargarPagos);

  // ================= EVENTOS (MODAL) =================
  pgCursoId?.addEventListener("change", async () => {
    // ✅ al cambiar curso, resetea plan de cuotas y recarga deudores del curso
    if (pgNroCuotas) {
      pgNroCuotas.value = "1";
      pgNroCuotas.disabled = false;
    }
    prevNroCuotas = 1;

    await refreshDeudoresList({ q: normStr(pgAlumnoSearch?.value) });

    rebuildCuotas();
    await refreshPagosPorCuota();
    renderCuotas();
  });

  pgNroCuotas?.addEventListener("change", async () => {
    if (cursoPagadoCompleto) {
      // si el curso está pagado, nro cuotas no debe modificarse
      pgNroCuotas.value = "1";
      pgNroCuotas.disabled = true;
      return;
    }

    const nuevo = Number(pgNroCuotas.value || 1);
    const hayPagos = pagosPorCuota && pagosPorCuota.size > 0;
    const cambioReal = prevNroCuotas != null && nuevo !== prevNroCuotas;

    if (cambioReal && hayPagos) {
      const ok = window.confirm(
        "Ya existen pagos registrados con el plan anterior. Si cambias el número de cuotas, se borrarán esos pagos para reconfigurar el plan de forma consistente. ¿Continuar?"
      );
      if (!ok) {
        pgNroCuotas.value = String(prevNroCuotas);
        return;
      }

try {
  const alumno_id = Number(pgAlumnoId?.value || 0);
  const curso_id = Number(pgCursoId?.value || 0);
  const inscripcion_id = await getInscripcionIdRequired(alumno_id, curso_id);

  await apiResetPlan(inscripcion_id);
  cuotaSeleccionada = null;
pagoSeleccionado = null;

  // ✅ IMPORTANTE: refrescar lista principal (tabla)
  await cargarPagos();

  // ✅ refrescar estado del modal
  await refreshPagosPorCuota();
  renderCuotas();
} catch (e) {
        console.error(e);
        if (msgPago) {
          msgPago.textContent = "No se pudo resetear el plan de cuotas: " + String(e.message || e);
          msgPago.className = "text-danger";
        }
        // revertir
        pgNroCuotas.value = String(prevNroCuotas);
        return;
      }
    }

    prevNroCuotas = nuevo;
    rebuildCuotas();
    await refreshPagosPorCuota();
    renderCuotas();
  });

  // Autorrelleno por CI
  let ciTimer = null;
  pgDocumento?.addEventListener("input", () => {
    clearAlumnoUI();
    const doc = normStr(pgDocumento.value);
    if (ciTimer) clearTimeout(ciTimer);

    ciTimer = setTimeout(async () => {
      if (doc.length < 4) return;
      const a = await apiGetAlumnoByDocumento(doc);
      if (a && a.id) {
        setAlumnoUI(a);
        await refreshPagosPorCuota();
        renderCuotas();
        if (msgPago) {
          msgPago.textContent = "Alumno encontrado por CI ✔";
          msgPago.className = "text-muted";
        }
      }
    }, 250);
  });

  pgAlumno?.addEventListener("change", async () => {
    const q = normStr(pgAlumno.value).toLowerCase();
    const a = alumnosCache.find((x) => normStr(x.nombre).toLowerCase() === q);
    if (a) {
      setAlumnoUI(a);
      await refreshPagosPorCuota();
      renderCuotas();
    }
  });

  pgAlumno?.addEventListener("input", () => {
    const nombre = normStr(pgAlumno.value);
    if (!nombre) {
      clearAlumnoUI();
      pgDocumento.value = "";
      return;
    }

    if (selectedAlumnoNombre && nombre !== selectedAlumnoNombre) {
      clearAlumnoUI();
      if (selectedAlumnoDocumento && normStr(pgDocumento.value) === selectedAlumnoDocumento) {
        pgDocumento.value = "";
      }
    }
  });

function filterAlumnosList() {
  const q = normStr(pgAlumnoSearch?.value);
  // ✅ en Pagos solo mostramos alumnos con deuda del curso seleccionado
  refreshDeudoresList({ q });
}


  pgAlumnoSearchBtn?.addEventListener("click", filterAlumnosList);
  pgAlumnoSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      filterAlumnosList();
    }
  });

  pgFecha?.addEventListener("change", () => {
    if (cuotaSeleccionada == null) return;

    const curso = getCursoSel();
    const start = isoDateOrEmpty(curso?.fecha_inicio);
    const end = computeCourseEnd(curso);

    const cuota = cuotasModelo[cuotaSeleccionada];
    const nro = cuota?.nro || 0;

    const v = isoDateOrEmpty(pgFecha.value);
    if (!v) return;

    if (end && compareISO(v, end) > 0) {
      pgFecha.value = end;
      if (msgPago) {
        msgPago.textContent = `La fecha no puede superar el fin del curso (${end}).`;
        msgPago.className = "text-danger";
      }
      return;
    }

    if (nro >= 2 && start && compareISO(v, start) < 0) {
      pgFecha.value = start;
      if (msgPago) {
        msgPago.textContent = `La fecha de esta cuota debe ser posterior o igual al inicio de clases (${start}).`;
        msgPago.className = "text-danger";
      }
      return;
    }

    cuotaFechas[nro] = v;
    if (msgPago) {
      msgPago.textContent = "";
      msgPago.className = "text-muted";
    }
    renderCuotas();
  });

  // ================= GUARDAR PAGO =================
  formPago?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (pagoSeleccionado) {
      msgPago.textContent = "Esta cuota ya está pagada. (Si necesitas corregir, anula/edita el pago anterior).";
      msgPago.className = "text-danger";
      return;
    }

    const cursoId = normStr(pgCursoId?.value);
    if (!cursoId) {
      msgPago.textContent = "Selecciona un curso.";
      msgPago.className = "text-danger";
      return;
    }

    const doc = normStr(pgDocumento?.value);
    if (!doc) {
      msgPago.textContent = "Ingresa el Documento/CI del alumno.";
      msgPago.className = "text-danger";
      return;
    }

    const alumnoDb = await apiGetAlumnoByDocumento(doc);
    if (!alumnoDb || !alumnoDb.id) {
      msgPago.textContent = "CI no encontrado. Selecciona un alumno o registra el alumno primero.";
      msgPago.className = "text-danger";
      return;
    }
    setAlumnoUI(alumnoDb);

    if (cuotaSeleccionada == null) {
      msgPago.textContent = "Selecciona una cuota.";
      msgPago.className = "text-danger";
      return;
    }

    const fecha = isoDateOrEmpty(pgFecha?.value);
    if (!fecha) {
      msgPago.textContent = "Fecha inválida (usa YYYY-MM-DD).";
      msgPago.className = "text-danger";
      return;
    }

    const curso = getCursoSel();
    const cuota = cuotasModelo[cuotaSeleccionada];

    const start = isoDateOrEmpty(curso?.fecha_inicio);
    const end = computeCourseEnd(curso);
    if (end && compareISO(fecha, end) > 0) {
      msgPago.textContent = `La fecha no puede superar el fin del curso (${end}).`;
      msgPago.className = "text-danger";
      return;
    }
    if (cuota.nro >= 2 && start && compareISO(fecha, start) < 0) {
      msgPago.textContent = `Para esta cuota, la fecha debe ser >= inicio de clases (${start}).`;
      msgPago.className = "text-danger";
      return;
    }

    try {
      msgPago.textContent = "Guardando pago...";
      msgPago.className = "text-muted";

const inscripcion_id = await getInscripcionIdRequired(alumnoDb.id, Number(cursoId));


      await apiPostPago({
        inscripcion_id,
        fecha,
        monto: cuota.monto,
        metodo: pgMetodo?.value || "Efectivo",
        estado: "Pagado",
        observaciones: normStr(pgObs?.value) || `Cuota ${cuota.nro} - ${curso?.nombre || ""}`,
      });

      msgPago.textContent = "Pago registrado ✔";
      msgPago.className = "text-success";

      await cargarPagos();
      await refreshPagosPorCuota();
      renderCuotas();
    } catch (e2) {
      console.error(e2);
      msgPago.textContent = "Error: " + String(e2.message || "desconocido");
      msgPago.className = "text-danger";
    }
  });

  // ================= “PAGAR DESDE DEUDORES” =================
  async function openModalIfRequested() {
    const open = sessionStorage.getItem("pay_open_modal");
    if (!open) return;

        openingFromDeudores = true;

// limpiar flag para que no reabra siempre
    sessionStorage.removeItem("pay_open_modal");

    const doc = sessionStorage.getItem("pay_alumno_documento") || "";
    const nombre = sessionStorage.getItem("pay_alumno_nombre") || "";
    const cursoId = sessionStorage.getItem("pay_curso_id") || "";

    // prefill
    if (cursoId && pgCursoId) pgCursoId.value = cursoId;
    if (doc && pgDocumento) pgDocumento.value = doc;
    if (nombre && pgAlumno) pgAlumno.value = nombre;

    // sincroniza alumno real
    if (doc) {
      const a = await apiGetAlumnoByDocumento(doc);
      if (a?.id) setAlumnoUI(a);
    }

    rebuildCuotas();
    await refreshPagosPorCuota();
    renderCuotas();

    // abrir modal
    const modalEl = document.getElementById("modalPago");
    if (modalEl && window.bootstrap?.Modal) {
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      m.show();
    }
  }

  // ================= INIT =================
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      // 1) cargar tabla rápido (y con loading controlado)
      await cargarPagos();

      // 2) cargar el resto
      const [cursos, alumnos] = await Promise.all([
        apiGetCursos().catch(() => []),
        apiGetAlumnos().catch(() => []),
      ]);

      cursosCache = cursos;
      alumnosCache = alumnos;

      fillCursosSelect();
      fillAlumnosAutocomplete();
      fillAlumnosList(alumnosCache);

      rebuildCuotas();

      // si viene desde Deudores -> “Pagar”
      await openModalIfRequested();
    } catch (e) {
      console.error(e);
      if (tablaPagosBody) {
        tablaPagosBody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error cargando pagos.</td></tr>`;
      }
    }
  });

  // Al abrir modal: fecha por defecto hoy
    document.getElementById("modalPago")?.addEventListener("show.bs.modal", async () => {
    // ✅ reset estado al abrir modal (default nro cuotas = 1)
    resetPagoModalState({ keepCurso: openingFromDeudores, keepAlumno: openingFromDeudores });
    await refreshDeudoresList();
  });

document.getElementById("modalPago")?.addEventListener("shown.bs.modal", async () => {
    if (btnGuardarPago) btnGuardarPago.disabled = false;

    if (pgFecha && !pgFecha.value) {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      pgFecha.value = `${yyyy}-${mm}-${dd}`;
    }

    prevNroCuotas = Number(pgNroCuotas?.value || 1);

    await refreshPagosPorCuota();
    renderCuotas();
    openingFromDeudores = false;
  });
})();

// public/js/deudores.js
(() => {
  "use strict";

  async function fetchJSON(url, options = {}) {
    options.credentials = "include";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
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
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  function normStr(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : "";
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Elementos tabla
  const dBuscar = document.getElementById("dBuscar");
  const dMes = document.getElementById("dMes");
  const dCurso = document.getElementById("dCurso");
  const btnFiltrarDeudores = document.getElementById("btnFiltrarDeudores");
  const dResumen = document.getElementById("dResumen");
  const tbody = document.querySelector("#tablaDeudores tbody");

  // Modal detalle (existente)
  const modalDetalleEl = document.getElementById("modalDeudaDetalle");
  const detAlumno = document.getElementById("detAlumno");
  const detCurso = document.getElementById("detCurso");
  const tablaDetalleDeuda = document.getElementById("tablaDetalleDeuda");
  const detTotal = document.getElementById("detTotal");
  let modalDetalle = null;

  // Modal pago inline
  const modalPagoEl = document.getElementById("modalPagoDeudor");
  const pagoAlumnoNombre = document.getElementById("pagoAlumnoNombre");
  const pagoAlumnoCI = document.getElementById("pagoAlumnoCI");
  const pagoCursoNombre = document.getElementById("pagoCursoNombre");
  const pagoMes = document.getElementById("pagoMes");
  const pagoMonto = document.getElementById("pagoMonto");
  const pagoFecha = document.getElementById("pagoFecha");
  const pagoMetodo = document.getElementById("pagoMetodo");
  const pagoObs = document.getElementById("pagoObs");
  const pagoMsg = document.getElementById("pagoMsg");
  const btnConfirmarPago = document.getElementById("btnConfirmarPago");
  let modalPago = null;
  let currentPagoData = null;

  // API
  async function apiGetCursos() {
    const data = await fetchJSON("/api/cursos");
    return Array.isArray(data) ? data : [];
  }

  async function apiGetDeudores(params = {}) {
    const p = new URLSearchParams();
    if (params.q) p.append("q", params.q);
    if (params.mes) p.append("mes", params.mes);
    if (params.curso_id) p.append("curso_id", params.curso_id);
    const qs = p.toString();
    const res = await fetchJSON("/api/reportes/deudores" + (qs ? `?${qs}` : ""));
    return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
  }

  async function apiPostPago(payload) {
    return fetchJSON("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function apiFindInscripcion(alumno_id, curso_id) {
    if (!alumno_id || !curso_id) return null;
    const qs = new URLSearchParams({
      alumno_id: String(alumno_id),
      curso_id: String(curso_id),
      estado: "Activa",
      limit: "1",
    }).toString();
    const res = await fetchJSON(`/api/inscripciones?${qs}`);
    const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    const row = rows[0];
    return row?.inscripcion_id || row?.id || null;
  }

  // UI
  function fillCursosSelect(cursos) {
    if (!dCurso) return;
    dCurso.innerHTML =
      `<option value="">Todos</option>` +
      cursos.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  }

  function renderDeudores(rows) {
    if (!tbody) return;
    const clean = (Array.isArray(rows) ? rows : []).filter((r) => Number(r.monto_adeudado || 0) > 0);

    if (!clean.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay deudores.</td></tr>`;
      if (dResumen) dResumen.textContent = "0 deudores";
      return;
    }

    tbody.innerHTML = clean.map((r) => `
      <tr>
        <td>${esc(r.alumno_nombre || "—")}</td>
        <td>${esc(r.alumno_documento || "—")}</td>
        <td>${esc(r.curso_nombre || "—")}</td>
        <td>${esc(r.mes || "—")}</td>
        <td class="text-danger fw-semibold">${bs(r.monto_adeudado)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary me-1" data-action="ver"
            data-alumno="${esc(r.alumno_nombre || "")}"
            data-curso="${esc(r.curso_nombre || "")}"
            data-monto="${esc(r.monto_adeudado || 0)}"
            data-mes="${esc(r.mes || "")}"
          >Ver</button>
          <button class="btn btn-sm btn-success" data-action="pagar"
            data-alumnonombre="${esc(r.alumno_nombre || "")}"
            data-alumnoid="${esc(r.alumno_id || "")}"
            data-doc="${esc(r.alumno_documento || "")}"
            data-cursoid="${esc(r.curso_id || "")}"
            data-cursonombre="${esc(r.curso_nombre || "")}"
            data-mes="${esc(r.mes || "")}"
            data-monto="${esc(r.monto_adeudado || 0)}"
            data-inscid="${esc(r.inscripcion_id || "")}"
          >💳 Pagar</button>
        </td>
      </tr>
    `).join("");

    if (dResumen) dResumen.textContent = `${clean.length} deudor${clean.length !== 1 ? "es" : ""}`;
  }

  async function cargarDeudores() {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Cargando...</td></tr>`;
    try {
      const q = normStr(dBuscar?.value);
      const mes = normStr(dMes?.value);
      const curso_id = normStr(dCurso?.value);
      const params = {};
      if (q) params.q = q;
      if (mes) params.mes = mes;
      if (curso_id) params.curso_id = curso_id;
      const rows = await apiGetDeudores(params);
      renderDeudores(rows);
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${esc(e.message || e)}</td></tr>`;
      if (dResumen) dResumen.textContent = "—";
    }
  }

  // Modal Pago inline
  function abrirModalPago(data) {
    currentPagoData = data;
    if (pagoAlumnoNombre) pagoAlumnoNombre.textContent = data.alumno_nombre || "—";
    if (pagoAlumnoCI) pagoAlumnoCI.textContent = data.alumno_documento || "—";
    if (pagoCursoNombre) pagoCursoNombre.textContent = data.curso_nombre || "—";
    if (pagoMes) pagoMes.textContent = data.mes || "—";
    if (pagoMonto) pagoMonto.textContent = bs(data.monto_adeudado);
    if (pagoFecha) pagoFecha.value = todayISO();
    if (pagoMetodo) pagoMetodo.value = "Efectivo";
    if (pagoObs) pagoObs.value = `Pago mensualidad ${data.mes || ""} — ${data.curso_nombre || ""}`.trim();
    if (pagoMsg) { pagoMsg.textContent = ""; pagoMsg.className = "text-muted"; }
    if (btnConfirmarPago) btnConfirmarPago.disabled = false;
    if (!modalPago && window.bootstrap?.Modal && modalPagoEl) {
      modalPago = new bootstrap.Modal(modalPagoEl);
    }
    modalPago?.show?.();
  }

  async function confirmarPago() {
    if (!currentPagoData) return;
    const fecha = normStr(pagoFecha?.value);
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      if (pagoMsg) { pagoMsg.textContent = "Fecha inválida."; pagoMsg.className = "text-danger"; }
      return;
    }
    const metodo = normStr(pagoMetodo?.value) || "Efectivo";
    const obs = normStr(pagoObs?.value) || `Mensualidad ${currentPagoData.mes || ""}`;
    const monto = Number(currentPagoData.monto_adeudado || 0);
    if (monto <= 0) {
      if (pagoMsg) { pagoMsg.textContent = "El monto adeudado es 0."; pagoMsg.className = "text-danger"; }
      return;
    }
    if (btnConfirmarPago) btnConfirmarPago.disabled = true;
    if (pagoMsg) { pagoMsg.textContent = "Procesando..."; pagoMsg.className = "text-muted"; }
    try {
      let inscripcion_id = currentPagoData.inscripcion_id || null;
      if (!inscripcion_id && currentPagoData.alumno_id && currentPagoData.curso_id) {
        inscripcion_id = await apiFindInscripcion(currentPagoData.alumno_id, currentPagoData.curso_id);
      }
      if (!inscripcion_id) {
        throw new Error("No se encontró inscripción activa para este alumno y curso.");
      }
      await apiPostPago({
        inscripcion_id,
        fecha,
        monto,
        metodo,
        estado: "Pagado",
        observaciones: obs,
      });
      if (pagoMsg) { pagoMsg.textContent = "✅ Pago registrado correctamente."; pagoMsg.className = "text-success"; }
      setTimeout(async () => {
        modalPago?.hide?.();
        await cargarDeudores();
      }, 1000);
    } catch (e) {
      console.error(e);
      if (pagoMsg) { pagoMsg.textContent = "Error: " + (e.message || "desconocido"); pagoMsg.className = "text-danger"; }
      if (btnConfirmarPago) btnConfirmarPago.disabled = false;
    }
  }

  // Eventos
  btnFiltrarDeudores?.addEventListener("click", cargarDeudores);
  dBuscar?.addEventListener("keydown", (e) => { if (e.key === "Enter") cargarDeudores(); });
  dMes?.addEventListener("change", cargarDeudores);
  dCurso?.addEventListener("change", cargarDeudores);
  btnConfirmarPago?.addEventListener("click", confirmarPago);

  tbody?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "ver") {
      if (!modalDetalle && window.bootstrap?.Modal && modalDetalleEl) modalDetalle = new bootstrap.Modal(modalDetalleEl);
      const alumno = btn.getAttribute("data-alumno") || "";
      const curso = btn.getAttribute("data-curso") || "";
      const mes = btn.getAttribute("data-mes") || "";
      const monto = Number(btn.getAttribute("data-monto") || 0);
      if (detAlumno) detAlumno.textContent = alumno;
      if (detCurso) detCurso.textContent = `${curso} · ${mes || "—"}`;
      if (tablaDetalleDeuda) {
        tablaDetalleDeuda.innerHTML = `<tr><td>Mensualidad pendiente</td><td>${esc(mes || "—")}</td><td class="text-danger">${bs(monto)}</td></tr>`;
      }
      if (detTotal) detTotal.textContent = bs(monto);
      modalDetalle?.show?.();
      return;
    }
    if (action === "pagar") {
      abrirModalPago({
        alumno_nombre: btn.getAttribute("data-alumnonombre") || "",
        alumno_id: btn.getAttribute("data-alumnoid") || "",
        alumno_documento: btn.getAttribute("data-doc") || "",
        curso_id: btn.getAttribute("data-cursoid") || "",
        curso_nombre: btn.getAttribute("data-cursonombre") || "",
        mes: btn.getAttribute("data-mes") || "",
        monto_adeudado: Number(btn.getAttribute("data-monto") || 0),
        inscripcion_id: btn.getAttribute("data-inscid") || null,
      });
    }
  });

  // Init
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const cursos = await apiGetCursos().catch(() => []);
      fillCursosSelect(cursos);
    } catch (_) {}
    await cargarDeudores();
  });

  window.cargarDeudores = cargarDeudores;
})();

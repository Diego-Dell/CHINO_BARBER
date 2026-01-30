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

  function normStr(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : "";
  }

  // =========================
  // Elementos
  // =========================
  const dBuscar = document.getElementById("dBuscar");
  const dMes = document.getElementById("dMes");
  const dCurso = document.getElementById("dCurso");
  const btnFiltrarDeudores = document.getElementById("btnFiltrarDeudores");
  const dResumen = document.getElementById("dResumen");
  const tbody = document.querySelector("#tablaDeudores tbody");

  // Modal detalle
  const modalEl = document.getElementById("modalDeudaDetalle");
  const detAlumno = document.getElementById("detAlumno");
  const detCurso = document.getElementById("detCurso");
  const tablaDetalleDeuda = document.getElementById("tablaDetalleDeuda");
  const detTotal = document.getElementById("detTotal");
  let modal = null;

  // =========================
  // API
  // =========================
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
    const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    return rows;
  }

  // =========================
  // UI
  // =========================
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

    tbody.innerHTML = clean
      .map((r) => {
        return `
          <tr>
            <td>${esc(r.alumno_nombre || "—")}</td>
            <td>${esc(r.alumno_documento || "—")}</td>
            <td>${esc(r.curso_nombre || "—")}</td>
            <td>${esc(r.mes || "—")}</td>
            <td class="text-danger">${bs(r.monto_adeudado)}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-secondary" data-action="ver"
                data-alumno="${esc(r.alumno_nombre || "")}"
                data-doc="${esc(r.alumno_documento || "")}"
                data-curso="${esc(r.curso_nombre || "")}"
                data-monto="${esc(r.monto_adeudado || 0)}"
                data-mes="${esc(r.mes || "")}"
              >Ver</button>

              <button class="btn btn-sm btn-success" data-action="pagar"
                data-doc="${esc(r.alumno_documento || "")}"
                data-cursoid="${esc(r.curso_id || "")}"
              >Pagar</button>
            </td>
          </tr>
        `;
      })
      .join("");

    if (dResumen) dResumen.textContent = `${clean.length} deudor${clean.length !== 1 ? "es" : ""}`;
  }

  async function cargarDeudores() {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Cargando...</td></tr>`;

    try {
      const q = normStr(dBuscar?.value);
      const mes = normStr(dMes?.value); // YYYY-MM
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

  // =========================
  // Eventos
  // =========================
  btnFiltrarDeudores?.addEventListener("click", cargarDeudores);
  dBuscar?.addEventListener("keydown", (e) => { if (e.key === "Enter") cargarDeudores(); });
  dMes?.addEventListener("change", cargarDeudores);
  dCurso?.addEventListener("change", cargarDeudores);

  // Acciones tabla
  tbody?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");

    if (action === "ver") {
      if (!modal && window.bootstrap?.Modal && modalEl) modal = new bootstrap.Modal(modalEl);

      const alumno = btn.getAttribute("data-alumno") || "";
      const curso = btn.getAttribute("data-curso") || "";
      const mes = btn.getAttribute("data-mes") || "";
      const monto = Number(btn.getAttribute("data-monto") || 0);

      if (detAlumno) detAlumno.textContent = alumno;
      if (detCurso) detCurso.textContent = `${curso} · ${mes || "—"}`;
      if (tablaDetalleDeuda) {
        tablaDetalleDeuda.innerHTML = `
          <tr>
            <td>Mensualidad pendiente</td>
            <td>${esc(mes || "—")}</td>
            <td class="text-danger">${bs(monto)}</td>
          </tr>
        `;
      }
      if (detTotal) detTotal.textContent = bs(monto);

      modal?.show?.();
      return;
    }

    if (action === "pagar") {
      const doc = btn.getAttribute("data-doc") || "";
      const cursoId = btn.getAttribute("data-cursoid") || "";

      // Lleva a pagos y (si ya lo tenías implementado) abre modal con datos
      const qs = new URLSearchParams();
      if (doc) qs.set("ci", doc);
      if (cursoId) qs.set("curso_id", cursoId);
      qs.set("openPago", "1");

      window.location.href = `pagos.html?${qs.toString()}`;
    }
  });

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const cursos = await apiGetCursos().catch(() => []);
      fillCursosSelect(cursos);
    } catch (_) {}
    await cargarDeudores();
  });

  // Si tu HTML llama cargarDeudores() desde onclick del botón "Actualizar"
  window.cargarDeudores = cargarDeudores;
})();

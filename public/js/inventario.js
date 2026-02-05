// public/js/inventario.js
(() => {
  "use strict";

  async function fetchJSON(url, options = {}) {
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

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function toNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  function bs(n) {
    const v = toNum(n, 0);
    return "Bs " + v.toFixed(2);
  }
  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function badgeEstadoItem(estado, stock, min) {
    const st = String(estado || "Activo");
    if (st !== "Activo") return `<span class="badge bg-secondary">Inactivo</span>`;
    if (toNum(stock, 0) <= toNum(min, 0)) return `<span class="badge bg-danger">Stock bajo</span>`;
    return `<span class="badge bg-success">OK</span>`;
  }

  // Tabs (buttons) - usamos los data-bs-target
  const tabMateriales = document.querySelector('[data-bs-target="#tabMateriales"]');
  const tabKardex = document.querySelector('[data-bs-target="#tabKardex"]');
  const tabAlertas = document.querySelector('[data-bs-target="#tabAlertas"]');
  const tabPrestamos = document.querySelector('[data-bs-target="#tabPrestamos"]');
  const tabResumen = document.querySelector('[data-bs-target="#tabResumen"]');

  // Panels (tab panes)
  const panelMateriales = document.getElementById("tabMateriales");
  const panelKardex = document.getElementById("tabKardex");
  const panelAlertas = document.getElementById("tabAlertas");
  const panelPrestamos = document.getElementById("tabPrestamos");
  const panelResumen = document.getElementById("tabResumen");

  // Header buttons
  const btnActualizar = document.getElementById("btnActualizarInventario");
  const btnNuevo = document.getElementById("btnNuevoItem");
  const btnConsumo = document.getElementById("btnConsumir");
  const btnComprar = document.getElementById("btnComprar");
  const btnNuevoPrestamo = document.getElementById("btnNuevoPrestamo");

  // Filtros
  const qBuscar = document.getElementById("invBuscar");
  const fEstado = document.getElementById("invEstado");
  const btnFiltrar = document.getElementById("btnFiltrarInv");
  const resumenTxt = document.getElementById("invResumen");

  // Tablas
  const tbodyItems = document.querySelector("#tablaItems tbody");
  const tbodyMovs = document.querySelector("#tablaMovs tbody");
  const tbodyAlertas = document.querySelector("#tablaAlertas tbody");
  const tbodyPrestamos = document.querySelector("#tablaPrestamos tbody");

  // KPIs
  const kActivos = document.getElementById("kpiActivos");
  const kAlertas = document.getElementById("kpiAlertas");
  const kConsumoMes = document.getElementById("kpiConsumoMes");
  const kCostoMes = document.getElementById("kpiCostoMes");

  // Modales / forms
  const modalItemEl = document.getElementById("modalItem");
  const formItem = document.getElementById("formItem");
  const msgItem = document.getElementById("msgItem");

  const itId = document.getElementById("itId");
  const itProducto = document.getElementById("itProducto");
  const itCategoria = document.getElementById("itCategoria");
  const itUnidad = document.getElementById("itUnidad");
  const itMin = document.getElementById("itMin");
  const itPrecio = document.getElementById("itPrecio");
  const itEstado = document.getElementById("itEstado");

  const modalConsEl = document.getElementById("modalConsumo");
  const formCons = document.getElementById("formConsumo");
  const msgCons = document.getElementById("msgConsumo");
  const csItem = document.getElementById("csItem");
  const csCantidad = document.getElementById("csCantidad");
  const csCurso = document.getElementById("csCurso");
  const csInstructor = document.getElementById("csInstructor") || document.getElementById("csInstr");
  const csFecha = document.getElementById("csFecha");
  const csPrecio = document.getElementById("csPrecio");
  const csNota = document.getElementById("csNota") || document.getElementById("csMotivo");

  const modalIngEl = document.getElementById("modalIngreso");
  const formIng = document.getElementById("formIngreso");
  const msgIng = document.getElementById("msgIngreso");
  const igItem = document.getElementById("igItem");
  const igCantidad = document.getElementById("igCantidad") || document.getElementById("igCant");
  const igFecha = document.getElementById("igFecha");
  const igNota = document.getElementById("igNota") || document.getElementById("igMotivo");

  const modalPrestEl = document.getElementById("modalPrestamo");
  const formPrest = document.getElementById("formPrestamo");
  const msgPrest = document.getElementById("msgPrestamo");
  const prItem = document.getElementById("prItem");
  const prCantidad = document.getElementById("prCantidad");
  const prCurso = document.getElementById("prCurso");
  const prInstructor = document.getElementById("prInstructor");
  const prFecha = document.getElementById("prFecha");
  const prNota = document.getElementById("prNota");

  // Cache
  let itemsCache = [];
  let cursosCache = [];
  let instructoresCache = [];

  function fillOptions(selectEl, list, { placeholder, getValue, getLabel }) {
    if (!selectEl) return;
    const opts = [`<option value="">${esc(placeholder || "-- Seleccionar --")}</option>`].concat(
      list.map((x) => `<option value="${esc(getValue(x))}">${esc(getLabel(x))}</option>`)
    );
    selectEl.innerHTML = opts.join("");
  }

  async function cargarCursos() {
    try {
      const r = await fetchJSON("/api/cursos");
      cursosCache = Array.isArray(r) ? r : [];
    } catch (_) {
      cursosCache = [];
    }
    fillOptions(csCurso, cursosCache, { placeholder: "(Opcional) Curso", getValue: (c) => c.id, getLabel: (c) => c.nombre });
    fillOptions(prCurso, cursosCache, { placeholder: "(Opcional) Curso", getValue: (c) => c.id, getLabel: (c) => c.nombre });
  }

  async function cargarInstructores() {
    try {
      const r = await fetchJSON("/api/instructores");
      instructoresCache = Array.isArray(r) ? r : [];
    } catch (_) {
      instructoresCache = [];
    }
    fillOptions(csInstructor, instructoresCache, { placeholder: "(Opcional) Instructor", getValue: (i) => i.id, getLabel: (i) => i.nombre });
    fillOptions(prInstructor, instructoresCache, { placeholder: "Instructor responsable *", getValue: (i) => i.id, getLabel: (i) => i.nombre });
  }

  function fillItemsSelects() {
    const list = itemsCache.filter((x) => String(x.estado) === "Activo");
    const opts = { placeholder: "-- Seleccionar material --", getValue: (i) => i.id, getLabel: (i) => i.producto };
    fillOptions(csItem, list, opts);
    fillOptions(igItem, list, opts);
    fillOptions(prItem, list, opts);
  }
  function getItemById(id) {
    return itemsCache.find((x) => Number(x.id) === Number(id));
  }

  function renderItems(rows) {
    if (!tbodyItems) return;

    if (!rows.length) {
      tbodyItems.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay materiales.</td></tr>`;
      if (resumenTxt) resumenTxt.textContent = "0 materiales";
      return;
    }

    tbodyItems.innerHTML = rows
      .map(
        (it) => `
      <tr>
        <td>${it.id}</td>
        <td class="fw-semibold">${esc(it.producto)}</td>
        <td>${esc(it.categoria || "")}</td>
        <td class="text-center">${toNum(it.stock, 0)}</td>
        <td class="text-center">${toNum(it.stock_minimo, 0)}</td>
        <td class="text-end">${bs(it.precio)}</td>
        <td>${badgeEstadoItem(it.estado, it.stock, it.stock_minimo)}</td>
        <td>
          <button class="btn btn-outline-primary btn-sm" onclick="window.editarItem(${it.id})">Editar</button>
        </td>
      </tr>
    `
      )
      .join("");

    if (resumenTxt) resumenTxt.textContent = `${rows.length} material${rows.length !== 1 ? "es" : ""}`;
  }

  function renderMovs(rows) {
    if (!tbodyMovs) return;
    if (!rows.length) {
      tbodyMovs.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No hay movimientos.</td></tr>`;
      return;
    }
    tbodyMovs.innerHTML = rows
      .map(
        (m) => `
      <tr>
        <td>${m.id}</td>
        <td>${esc(String(m.fecha || "").slice(0, 10))}</td>
        <td>${esc(m.item_producto || "")}</td>
        <td>${esc(m.tipo || "")}</td>
        <td class="text-center">${toNum(m.cantidad, 0)}</td>
        <td class="text-end">${bs(m.costo_total || 0)}</td>
        <td>${esc(m.curso_nombre || "")}</td>
        <td>${esc(m.instructor_nombre || "")}</td>
        <td>${esc(m.nota || "")}</td>
      </tr>
    `
      )
      .join("");
  }

  function renderAlertas(rows) {
    if (!tbodyAlertas) return;
    if (!rows.length) {
      tbodyAlertas.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Sin alertas.</td></tr>`;
      return;
    }
    tbodyAlertas.innerHTML = rows
      .map(
        (it) => `
      <tr>
        <td>${it.id}</td>
        <td class="fw-semibold">${esc(it.producto)}</td>
        <td>${esc(it.categoria || "")}</td>
        <td class="text-center">${toNum(it.stock, 0)}</td>
        <td class="text-center">${toNum(it.stock_minimo, 0)}</td>
        <td>${badgeEstadoItem(it.estado, it.stock, it.stock_minimo)}</td>
      </tr>
    `
      )
      .join("");
  }

  function renderPrestamos(rows) {
    if (!tbodyPrestamos) return;
    if (!rows.length) {
      tbodyPrestamos.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No hay préstamos.</td></tr>`;
      return;
    }
    tbodyPrestamos.innerHTML = rows
      .map(
        (p) => `
      <tr>
        <td>${p.id}</td>
        <td>${esc(String(p.fecha_salida || "").slice(0, 10))}</td>
        <td>${esc(p.item_producto || "")}</td>
        <td class="text-center">${toNum(p.cantidad, 0)}</td>
        <td>${esc(p.instructor_nombre || "")}</td>
        <td>${esc(p.curso_nombre || "")}</td>
        <td><span class="badge ${
          p.estado === "Pendiente" ? "bg-warning text-dark" : p.estado === "Devuelto" ? "bg-success" : "bg-secondary"
        }">${esc(p.estado || "")}</span></td>
        <td>${esc(String(p.fecha_devolucion || "").slice(0, 10))}</td>
        <td class="text-nowrap">
          ${
            p.estado === "Pendiente"
              ? `
            <button class="btn btn-outline-success btn-sm" onclick="window.devolverPrestamo(${p.id})">Devolver</button>
            <button class="btn btn-outline-dark btn-sm" onclick="window.cobrarPrestamo(${p.id})">Cobrar</button>
          `
              : "—"
          }
        </td>
      </tr>
    `
      )
      .join("");
  }

  function updateKpis() {
    const activos = itemsCache.filter((x) => String(x.estado) === "Activo").length;
    if (kActivos) kActivos.textContent = String(activos);

    const alertas = itemsCache.filter((x) => String(x.estado) === "Activo" && toNum(x.stock, 0) <= toNum(x.stock_minimo, 0)).length;
    if (kAlertas) kAlertas.textContent = String(alertas);
  }

  async function cargarItems() {
    const params = new URLSearchParams();
    const q = (qBuscar?.value || "").trim();
    const est = (fEstado?.value || "").trim();
    if (q) params.append("q", q);
    if (est) params.append("estado", est);

    const res = await fetchJSON(`/api/inventario/items?${params.toString()}`);
    itemsCache = Array.isArray(res?.items) ? res.items : [];
    renderItems(itemsCache);
    fillItemsSelects();
    updateKpis();
  }

  async function cargarMovs() {
    const res = await fetchJSON("/api/inventario/movimientos");
    const rows = Array.isArray(res?.items) ? res.items : [];
    renderMovs(rows);

    const ym = hoyISO().slice(0, 7);
    const consumoMes = rows
      .filter((r) => String(r.fecha || "").startsWith(ym) && String(r.tipo || "").toLowerCase().includes("egr"))
      .reduce((a, b) => a + toNum(b.cantidad, 0), 0);

    const costoMes = rows
      .filter((r) => String(r.fecha || "").startsWith(ym) && String(r.tipo || "").toLowerCase().includes("egr"))
      .reduce((a, b) => a + toNum(b.costo_total, 0), 0);

    if (kConsumoMes) kConsumoMes.textContent = String(consumoMes);
    if (kCostoMes) kCostoMes.textContent = bs(costoMes);
  }

  async function cargarAlertas() {
    const res = await fetchJSON("/api/inventario/alertas");
    renderAlertas(Array.isArray(res?.items) ? res.items : []);
  }

  async function cargarPrestamos() {
    const res = await fetchJSON("/api/inventario/prestamos");
    renderPrestamos(Array.isArray(res?.items) ? res.items : []);
  }

  async function recargarTodo() {
    btnActualizar?.setAttribute("disabled", "disabled");
    try {
      await Promise.allSettled([cargarItems(), cargarMovs(), cargarAlertas(), cargarPrestamos()]);
    } finally {
      btnActualizar?.removeAttribute("disabled");
    }
  }

  // Actions
  window.editarItem = function (id) {
    const it = getItemById(id);
    if (!it) return alert("Item no encontrado");

    itId.value = it.id;
    itProducto.value = it.producto || "";
    itCategoria.value = it.categoria || "";
    itUnidad.value = it.unidad || "";
    itMin.value = toNum(it.stock_minimo, 0);
    itPrecio.value = toNum(it.precio, 0);
    itEstado.value = it.estado || "Activo";
    msgItem.textContent = "";

    new bootstrap.Modal(modalItemEl).show();
  };

  btnNuevo?.addEventListener("click", () => {
    itId.value = "";
    itProducto.value = "";
    itCategoria.value = "";
    itUnidad.value = "";
    itMin.value = 0;
    itPrecio.value = 0;
    itEstado.value = "Activo";
    msgItem.textContent = "";
    new bootstrap.Modal(modalItemEl).show();
  });

  formItem?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      producto: (itProducto.value || "").trim(),
      categoria: (itCategoria.value || "").trim(),
      unidad: (itUnidad.value || "").trim(),
      stock_minimo: toNum(itMin.value, 0),
      precio: toNum(itPrecio.value, 0),
      estado: (itEstado.value || "Activo").trim(),
    };
    if (!payload.producto) {
      msgItem.textContent = "Producto es obligatorio.";
      msgItem.className = "text-danger small";
      return;
    }

    try {
      msgItem.textContent = "Guardando...";
      msgItem.className = "text-muted small";

      const id = toNum(itId.value, 0);
      if (id) {
        await fetchJSON(`/api/inventario/items/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJSON(`/api/inventario/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      msgItem.textContent = "✅ Guardado.";
      msgItem.className = "text-success small";
      await cargarItems();
      setTimeout(() => bootstrap.Modal.getInstance(modalItemEl)?.hide(), 400);
    } catch (err) {
      msgItem.textContent = "Error: " + String(err.message || "desconocido");
      msgItem.className = "text-danger small";
    }
  });

  btnConsumo?.addEventListener("click", () => {
    csItem.value = "";
    csCantidad.value = 1;
    csCurso.value = "";
    csInstructor.value = "";
    csFecha.value = hoyISO();
    csPrecio.value = "";
    if (csNota) csNota.value = "";
    msgCons.textContent = "";
    new bootstrap.Modal(modalConsEl).show();
  });

  csItem?.addEventListener("change", () => {
    const it = getItemById(csItem.value);
    if (csPrecio) csPrecio.value = it ? bs(it.precio) : "";
  });

  formCons?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item_id = toNum(csItem.value, 0);
    const cantidad = toNum(csCantidad.value, 0);
    if (!item_id) return (msgCons.textContent = "Selecciona un material.");
    if (cantidad <= 0) return (msgCons.textContent = "Cantidad inválida.");

    try {
      msgCons.textContent = "Guardando...";
      msgCons.className = "text-muted small";

      await fetchJSON("/api/inventario/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id,
          tipo: "Egreso",
          cantidad,
          fecha: csFecha.value || hoyISO(),
          curso_id: toNum(csCurso.value, 0) || null,
          instructor_id: toNum(csInstructor.value, 0) || null,
          nota: (csNota?.value || "").trim() || null,
        }),
      });

      msgCons.textContent = "✅ Registrado.";
      msgCons.className = "text-success small";
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getInstance(modalConsEl)?.hide(), 450);
    } catch (err) {
      msgCons.textContent = "Error: " + String(err.message || "desconocido");
      msgCons.className = "text-danger small";
    }
  });

  btnComprar?.addEventListener("click", () => {
    igItem.value = "";
    igCantidad.value = 1;
    igFecha.value = hoyISO();
    if (igNota) igNota.value = "";
    msgIng.textContent = "";
    new bootstrap.Modal(modalIngEl).show();
  });

  formIng?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item_id = toNum(igItem.value, 0);
    const cantidad = toNum(igCantidad.value, 0);
    if (!item_id) return (msgIng.textContent = "Selecciona un material.");
    if (cantidad <= 0) return (msgIng.textContent = "Cantidad inválida.");

    try {
      msgIng.textContent = "Guardando...";
      msgIng.className = "text-muted small";

      await fetchJSON("/api/inventario/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id,
          tipo: "Ingreso",
          cantidad,
          fecha: igFecha.value || hoyISO(),
          nota: (igNota?.value || "").trim() || null,
        }),
      });

      msgIng.textContent = "✅ Registrado.";
      msgIng.className = "text-success small";
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getInstance(modalIngEl)?.hide(), 450);
    } catch (err) {
      msgIng.textContent = "Error: " + String(err.message || "desconocido");
      msgIng.className = "text-danger small";
    }
  });

  btnNuevoPrestamo?.addEventListener("click", () => {
    prItem.value = "";
    prCantidad.value = 1;
    prCurso.value = "";
    prInstructor.value = "";
    prFecha.value = hoyISO();
    prNota.value = "";
    msgPrest.textContent = "";
    new bootstrap.Modal(modalPrestEl).show();
  });

  formPrest?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item_id = toNum(prItem.value, 0);
    const cantidad = toNum(prCantidad.value, 0);
    const instructor_id = toNum(prInstructor.value, 0);
    if (!item_id) return (msgPrest.textContent = "Selecciona un material.");
    if (!instructor_id) return (msgPrest.textContent = "Selecciona un instructor.");
    if (cantidad <= 0) return (msgPrest.textContent = "Cantidad inválida.");

    try {
      msgPrest.textContent = "Guardando...";
      msgPrest.className = "text-muted small";

      await fetchJSON("/api/inventario/prestamos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id,
          instructor_id,
          curso_id: toNum(prCurso.value, 0) || null,
          cantidad,
          fecha_salida: prFecha.value || hoyISO(),
          nota: (prNota.value || "").trim() || null,
        }),
      });

      msgPrest.textContent = "✅ Registrado.";
      msgPrest.className = "text-success small";
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getInstance(modalPrestEl)?.hide(), 450);
    } catch (err) {
      msgPrest.textContent = "Error: " + String(err.message || "desconocido");
      msgPrest.className = "text-danger small";
    }
  });

  window.devolverPrestamo = async function (id) {
    if (!confirm("¿Marcar como DEVUELTO y devolver stock?")) return;
    try {
      await fetchJSON(`/api/inventario/prestamos/${id}/devolver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha_devolucion: hoyISO() }),
      });
      await recargarTodo();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  window.cobrarPrestamo = async function (id) {
    if (!confirm("¿Marcar como COBRADO? (no devuelve stock)")) return;
    try {
      await fetchJSON(`/api/inventario/prestamos/${id}/cobrar`, { method: "POST" });
      await recargarTodo();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  // Filtros / Refresh
  btnFiltrar?.addEventListener("click", async () => {
    try {
      await cargarItems();
    } catch (e) {
      console.error(e);
    }
  });
  btnActualizar?.addEventListener("click", recargarTodo);
  qBuscar?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnFiltrar?.click();
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    await Promise.allSettled([cargarCursos(), cargarInstructores()]);
    await recargarTodo();
    tabMateriales?.click?.(); // abre Materiales
  });
})();

// public/js/inventario.js
(() => {
  "use strict";

  // ===== Helpers =====
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

  const bs = (n) => "Bs " + Number(n || 0).toFixed(2);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] || c));

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }
  function monthStartISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;
  }
  function nextMonthStartISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+2)}-01`;
  }

  function setMsg(el, text, cls = "text-muted") {
    if (!el) return;
    el.textContent = text || "";
    el.className = cls;
  }

  function fillSelect(el, list, getLabel, withEmpty = false, emptyLabel = "— Selecciona —") {
    if (!el) return;
    const emptyOpt = withEmpty ? `<option value="">${esc(emptyLabel)}</option>` : "";
    el.innerHTML = emptyOpt + list.map(x => `<option value="${esc(x.id)}">${esc(getLabel(x))}</option>`).join("");
  }

  // ===== Elementos del DOM =====
  const msgInv = document.getElementById("msgInv");
  const kpiItems = document.getElementById("kpiItems");
  const kpiAlertas = document.getElementById("kpiAlertas");
  const kpiConsumoMes = document.getElementById("kpiConsumoMes");
  const kpiCostoMes = document.getElementById("kpiCostoMes");

  const qItem = document.getElementById("qItem");
  const fEstado = document.getElementById("fEstado");
  const tablaItemsBody = document.getElementById("tablaItemsBody");
  const itResumen = document.getElementById("itResumen");

  const kItem = document.getElementById("kItem");
  const kTipo = document.getElementById("kTipo");
  const kDesde = document.getElementById("kDesde");
  const kHasta = document.getElementById("kHasta");
  const tablaKardexBody = document.getElementById("tablaKardexBody");
  const kResumen = document.getElementById("kResumen");

  const tablaAlertasBody = document.getElementById("tablaAlertasBody");
  const rDesde = document.getElementById("rDesde");
  const rHasta = document.getElementById("rHasta");
  const tablaResumenCursoBody = document.getElementById("tablaResumenCursoBody");
  const tablaResumenInstructorBody = document.getElementById("tablaResumenInstructorBody");

  const formItem = document.getElementById("formItem");
  const itId = document.getElementById("itId");
  const itProducto = document.getElementById("itProducto");
  const itCategoria = document.getElementById("itCategoria");
  const itUnidad = document.getElementById("itUnidad");
  const itMin = document.getElementById("itMin");
  const itEstadoForm = document.getElementById("itEstadoForm");
  const msgItem = document.getElementById("msgItem");

  const formConsumo = document.getElementById("formConsumo");
  const csItem = document.getElementById("csItem");
  const csCant = document.getElementById("csCant");
  const csFecha = document.getElementById("csFecha");
  const csCurso = document.getElementById("csCurso");
  const csInstructor = document.getElementById("csInstructor");
  const csCosto = document.getElementById("csCosto");
  const csMotivo = document.getElementById("csMotivo");
  const msgConsumo = document.getElementById("msgConsumo");

  const formIngreso = document.getElementById("formIngreso");
  const igItem = document.getElementById("igItem");
  const igCant = document.getElementById("igCant");
  const igFecha = document.getElementById("igFecha");
  const igCosto = document.getElementById("igCosto");
  const igMotivo = document.getElementById("igMotivo");
  const msgIngreso = document.getElementById("msgIngreso");

  const formVenta = document.getElementById("formVenta");
  const vItem = document.getElementById("vItem");
  const vCant = document.getElementById("vCant");
  const vFecha = document.getElementById("vFecha");
  const vCurso = document.getElementById("vCurso");
  const vInstructor = document.getElementById("vInstructor");
  const vPrecio = document.getElementById("vPrecio");
  const vNota = document.getElementById("vNota");
  const msgVenta = document.getElementById("msgVenta");

  const formDevolucion = document.getElementById("formDevolucion");
  const dPrestamo = document.getElementById("dPrestamo");
  const dFecha = document.getElementById("dFecha");
  const dCant = document.getElementById("dCant");
  const dNota = document.getElementById("dNota");
  const msgDevolucion = document.getElementById("msgDevolucion");

  const tblPrestamosPend = document.getElementById("tblPrestamosPend");
  const msgPrestamosPend = document.getElementById("msgPrestamosPend");
  const tblPrestamosTab = document.getElementById("tblPrestamosTab");
  const pResumen = document.getElementById("pResumen");
  const pFiltroEstado = document.getElementById("pFiltroEstado");
  const pFiltroInstructor = document.getElementById("pFiltroInstructor");

  // ===== Cache =====
  let itemsCache = [];
  let cursosCache = [];
  let instructoresCache = [];

  // ===== API calls =====
  async function apiListItems(p = {}) {
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.estado) sp.set("estado", p.estado);
    sp.set("limit", "500");
    sp.set("offset", "0");
    const r = await fetchJSON(`/api/inventario/items?${sp}`);
    return r?.data || [];
  }
  async function apiGetItem(id) {
    return fetchJSON(`/api/inventario/items/${id}`);
  }
  async function apiCreateItem(payload) {
    return fetchJSON("/api/inventario/items", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiUpdateItem(id, payload) {
    return fetchJSON(`/api/inventario/items/${id}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiListMovimientos(p = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) { if (v !== undefined && v !== null && v !== "") sp.set(k, String(v)); }
    const r = await fetchJSON(`/api/inventario/movimientos?${sp}`);
    return r?.data || [];
  }
  async function apiCreateMovimiento(payload) {
    return fetchJSON("/api/inventario/movimientos", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiAlertas() {
    const r = await fetchJSON("/api/inventario/alertas");
    return r?.data || [];
  }
  async function apiResumen(desde, hasta) {
    const sp = new URLSearchParams();
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    const r = await fetchJSON(`/api/inventario/resumen?${sp}`);
    return r?.data || null;
  }
  async function apiCreatePrestamo(payload) {
    return fetchJSON("/api/inventario/prestamos", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiListPrestamos(p = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) { if (v !== undefined && v !== null && v !== "") sp.set(k, String(v)); }
    const r = await fetchJSON(`/api/inventario/prestamos?${sp}`);
    return r?.data || [];
  }
  async function apiDevolverPrestamo(id, payload) {
    return fetchJSON(`/api/inventario/prestamos/${id}/devolver`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiCreateVenta(payload) {
    return fetchJSON("/api/inventario/ventas", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  }
  async function apiVentasResumen(desde, hasta) {
    const sp = new URLSearchParams();
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    const r = await fetchJSON(`/api/inventario/ventas/resumen?${sp}`);
    return r?.data || null;
  }
  async function apiGetCursos() {
    const r = await fetchJSON("/api/cursos");
    return Array.isArray(r) ? r : (r?.data || []);
  }
  async function apiGetInstructores() {
    const r = await fetchJSON("/api/instructores");
    return Array.isArray(r) ? r : (r?.data || []);
  }

  // Stock local estimado (para validación rápida en frontend)
  async function getStockLocal(item_id) {
    try {
      const rows = await apiListMovimientos({ item_id });
      let stock = 0;
      for (const r of rows) {
        const cant = Number(r.cantidad || 0);
        if (r.tipo === "Ingreso" || r.tipo === "Devolucion") stock += cant;
        else if (r.tipo === "Salida" || r.tipo === "Prestamo" || r.tipo === "Venta") stock -= cant;
        else if (r.tipo === "Ajuste") stock += cant;
      }
      return stock;
    } catch (_) { return 0; }
  }

  // ===== Renders =====
  function stockBadge(actual, minimo) {
    const n = Number(actual || 0);
    const m = Number(minimo || 0);
    if (n <= 0) return `<span class="badge bg-danger">Sin stock</span>`;
    if (n <= m) return `<span class="badge bg-warning text-dark">${n}</span>`;
    return `<span class="badge bg-success-subtle text-success border border-success-subtle">${n}</span>`;
  }

  function renderItemsTable(list) {
    if (!tablaItemsBody) return;
    if (!list.length) {
      tablaItemsBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Sin resultados.</td></tr>`;
      if (itResumen) itResumen.textContent = "0 materiales";
      return;
    }
    tablaItemsBody.innerHTML = list.map(it => {
      const estado = it.estado || "Activo";
      const badge = estado === "Activo" ? "bg-success" : "bg-secondary";
      const activarLabel = estado === "Activo" ? "Inactivar" : "Activar";
      return `
        <tr>
          <td class="fw-semibold">${esc(it.producto || "")}</td>
          <td class="text-muted">${esc(it.categoria || "—")}</td>
          <td class="text-muted">${esc(it.unidad || "—")}</td>
          <td class="text-end">${stockBadge(it.stock_actual, it.stock_minimo)}</td>
          <td class="text-end text-muted">${esc(it.stock_minimo ?? 0)}</td>
          <td><span class="badge ${badge}">${esc(estado)}</span></td>
          <td class="text-end">
            <div class="dropdown">
              <button class="btn btn-sm btn-outline-secondary btn-round dropdown-toggle" data-bs-toggle="dropdown">
                Acciones
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="#" data-act="kardex" data-id="${esc(it.id)}">🧾 Ver Kardex</a></li>
                <li><a class="dropdown-item" href="#" data-act="operar" data-id="${esc(it.id)}">⚡ Registrar operación</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" data-act="edit" data-id="${esc(it.id)}">✏️ Editar</a></li>
                <li><a class="dropdown-item text-${estado==="Activo"?"danger":"success"}" href="#" data-act="toggleEstado" data-id="${esc(it.id)}">${estado==="Activo"?"⛔":"✅"} ${activarLabel}</a></li>
              </ul>
            </div>
          </td>
        </tr>`;
    }).join("");
    if (itResumen) itResumen.textContent = `${list.length} material${list.length === 1 ? "" : "es"}`;
    tablaItemsBody.querySelectorAll("[data-act]").forEach(el => {
      el.addEventListener("click", (e) => { e.preventDefault(); handleItemAction(el.dataset.act, el.dataset.id); });
    });
  }

  function renderKardex(rows) {
    if (!tablaKardexBody) return;
    if (!rows.length) {
      tablaKardexBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No hay movimientos para los filtros seleccionados.</td></tr>`;
      if (kResumen) kResumen.textContent = "0 movimientos";
      return;
    }
    tablaKardexBody.innerHTML = rows.map(r => {
      const tipo = r.tipo || "—";
      const badge = tipo === "Ingreso" ? "bg-success" : tipo === "Devolucion" ? "bg-success" : tipo === "Salida" ? "bg-danger" : tipo === "Prestamo" ? "bg-warning text-dark" : tipo === "Venta" ? "bg-primary" : "bg-secondary";
      const tipoTxt = tipo === "Salida" ? "Salida (hist.)" : tipo === "Devolucion" ? "Devolución" : tipo === "Prestamo" ? "Préstamo" : tipo;
      const precio = r.tipo === "Venta" ? (r.precio_unitario || 0) : (r.costo_unitario || 0);
      return `
        <tr>
          <td class="text-muted">${esc(r.id)}</td>
          <td>${esc((r.fecha || "").slice(0,10) || "—")}</td>
          <td><span class="badge ${badge}">${esc(tipoTxt)}</span></td>
          <td class="text-end fw-semibold">${esc(r.cantidad)}</td>
          <td class="text-end text-muted">${bs(precio)}</td>
          <td class="text-muted">${esc(r.motivo || "—")}</td>
          <td class="text-muted">${esc(r.curso_nombre || "—")}</td>
          <td class="text-muted">${esc(r.instructor_nombre || "—")}</td>
        </tr>`;
    }).join("");
    if (kResumen) kResumen.textContent = `${rows.length} movimiento${rows.length === 1 ? "" : "s"}`;
  }

  function renderAlertas(rows) {
    if (!tablaAlertasBody) return;
    if (!rows.length) {
      tablaAlertasBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">✅ Sin alertas. Todos los materiales tienen stock suficiente.</td></tr>`;
      return;
    }
    tablaAlertasBody.innerHTML = rows.map(r => {
      const stock = Number(r.stock_actual || 0);
      const min = Number(r.stock_minimo || 0);
      const stockClass = stock <= 0 ? "text-danger fw-bold" : "text-warning fw-bold";
      return `
        <tr>
          <td class="fw-semibold">${esc(r.producto || "")}</td>
          <td class="text-muted">${esc(r.categoria || "—")}</td>
          <td class="text-end ${stockClass}">${stock}</td>
          <td class="text-end text-muted">${min}</td>
          <td><span class="badge ${stock <= 0 ? "bg-danger" : "bg-warning text-dark"}">${stock <= 0 ? "Sin stock" : "Stock bajo"}</span></td>
        </tr>`;
    }).join("");
  }

  function renderResumenTables(data) {
    const pc = Array.isArray(data?.por_curso) ? data.por_curso : [];
    const pi = Array.isArray(data?.por_instructor) ? data.por_instructor : [];
    tablaResumenCursoBody.innerHTML = pc.length
      ? pc.map(x => `<tr><td>${esc(x.curso_nombre || "—")}</td><td class="text-end fw-semibold">${esc(x.salidas)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="text-muted text-center py-3">Sin datos en el período.</td></tr>`;
    tablaResumenInstructorBody.innerHTML = pi.length
      ? pi.map(x => `<tr><td>${esc(x.instructor_nombre || "—")}</td><td class="text-end fw-semibold">${esc(x.salidas)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="text-muted text-center py-3">Sin datos en el período.</td></tr>`;
  }

  // ===== Loaders =====
  async function cargarItems() {
    const rows = await apiListItems({ q: (qItem?.value || "").trim(), estado: fEstado?.value || "" });
    itemsCache = rows;
    fillSelect(csItem, itemsCache, x => x.producto);
    fillSelect(igItem, itemsCache, x => x.producto);
    fillSelect(kItem, itemsCache, x => x.producto);
    fillSelect(vItem, itemsCache, x => x.producto);
    renderItemsTable(itemsCache);
  }

  async function cargarKardex() {
    const params = {
      item_id: kItem?.value ? Number(kItem.value) : null,
      tipo: kTipo?.value || "",
      desde: kDesde?.value || "",
      hasta: kHasta?.value || ""
    };
    const rows = await apiListMovimientos(params);
    renderKardex(rows);
  }

  async function cargarPrestamosPendientes() {
    try {
      const rows = await apiListPrestamos({ estado: "Pendiente" });
      if (dPrestamo) {
        dPrestamo.innerHTML = `<option value="">— Selecciona préstamo —</option>` + rows.map(p => {
          const pend = Number(p.cantidad || 0) - Number(p.cantidad_devuelta || 0);
          return `<option value="${esc(p.id)}" data-pendiente="${esc(pend)}">#${p.id} — ${p.item_producto} — ${pend} pend. — ${p.instructor_nombre || "Prof."}</option>`;
        }).join("");
      }
      if (tblPrestamosPend) {
        if (!rows.length) {
          tblPrestamosPend.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">✅ Sin préstamos pendientes.</td></tr>`;
        } else {
          tblPrestamosPend.innerHTML = rows.map(p => {
            const pend = Number(p.cantidad || 0) - Number(p.cantidad_devuelta || 0);
            return `
              <tr>
                <td class="text-muted">#${esc(p.id)}</td>
                <td class="fw-semibold">${esc(p.item_producto || "")}</td>
                <td>${esc(p.instructor_nombre || "")}</td>
                <td class="text-muted">${esc(p.curso_nombre || "—")}</td>
                <td class="text-end"><span class="badge bg-warning text-dark">${pend}</span></td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-success btn-round" data-act="devolver" data-id="${esc(p.id)}">↩️ Devolver</button>
                </td>
              </tr>`;
          }).join("");
          tblPrestamosPend.querySelectorAll('[data-act="devolver"]').forEach(btn => {
            btn.addEventListener("click", () => {
              if (dPrestamo) dPrestamo.value = btn.dataset.id;
              const opt = dPrestamo?.options[dPrestamo.selectedIndex];
              const pend = Number(opt?.getAttribute("data-pendiente") || 0);
              if (dCant) dCant.value = pend ? String(pend) : "1";
              if (dFecha && !dFecha.value) dFecha.value = todayISO();
              bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDevolucion")).show();
            });
          });
        }
      }
      if (msgPrestamosPend) setMsg(msgPrestamosPend, rows.length ? `${rows.length} pendiente${rows.length===1?"":"s"}` : "", "text-warning fw-semibold");
    } catch (err) {
      console.error("Error cargando préstamos:", err);
      if (tblPrestamosPend) tblPrestamosPend.innerHTML = `<tr><td colspan="6" class="text-danger">Error cargando préstamos.</td></tr>`;
    }
  }

  async function cargarTabPrestamos() {
    if (!tblPrestamosTab) return;
    tblPrestamosTab.innerHTML = `<tr><td colspan="10" class="text-muted text-center py-4">Cargando…</td></tr>`;
    try {
      const estado = pFiltroEstado ? pFiltroEstado.value : "";
      const rows = await apiListPrestamos(estado ? { estado } : {});

      // Populate instructor filter
      if (pFiltroInstructor && pFiltroInstructor.options.length <= 1) {
        const instructores = [...new Map(rows.map(r => [r.instructor_id, r.instructor_nombre])).entries()];
        instructores.forEach(([id, nombre]) => {
          if (!id) return;
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = nombre || "—";
          pFiltroInstructor.appendChild(opt);
        });
      }

      // Filter by instructor if selected
      const instrId = pFiltroInstructor ? pFiltroInstructor.value : "";
      const filtered = instrId ? rows.filter(r => String(r.instructor_id) === instrId) : rows;

      if (pResumen) pResumen.textContent = `${filtered.length} préstamo${filtered.length === 1 ? "" : "s"}`;

      if (!filtered.length) {
        tblPrestamosTab.innerHTML = `<tr><td colspan="10" class="text-muted text-center py-4">Sin préstamos para los filtros seleccionados.</td></tr>`;
        return;
      }

      tblPrestamosTab.innerHTML = filtered.map(p => {
        const total = Number(p.cantidad || 0);
        const devuelto = Number(p.cantidad_devuelta || 0);
        const pendiente = total - devuelto;
        const esDevuelto = p.estado === "Devuelto";
        const estadoBadge = esDevuelto
          ? `<span class="badge bg-success">Devuelto</span>`
          : `<span class="badge bg-warning text-dark">Pendiente</span>`;
        const accion = esDevuelto
          ? `<span class="text-muted small">—</span>`
          : `<button class="btn btn-sm btn-outline-success btn-round" data-act="devolver-tab" data-id="${esc(p.id)}" data-pend="${pendiente}">↩️ Devolver</button>`;
        return `
          <tr>
            <td class="text-muted">#${esc(p.id)}</td>
            <td class="fw-semibold">${esc(p.item_producto || "")}</td>
            <td>${esc(p.instructor_nombre || "—")}</td>
            <td class="text-muted small">${esc(p.curso_nombre || "—")}</td>
            <td class="text-center text-muted small">${esc(p.fecha || "")}</td>
            <td class="text-center">${total}</td>
            <td class="text-center">${pendiente > 0 ? `<span class="badge bg-warning text-dark">${pendiente}</span>` : `<span class="text-muted">0</span>`}</td>
            <td class="text-muted small">${esc(p.nota || "—")}</td>
            <td class="text-center">${estadoBadge}</td>
            <td class="text-end">${accion}</td>
          </tr>`;
      }).join("");

      // Bind devolver buttons
      tblPrestamosTab.querySelectorAll('[data-act="devolver-tab"]').forEach(btn => {
        btn.addEventListener("click", () => {
          if (dPrestamo) dPrestamo.value = btn.dataset.id;
          const opt = dPrestamo?.options[dPrestamo.selectedIndex];
          const pend = Number(btn.dataset.pend || opt?.getAttribute("data-pendiente") || 0);
          if (dCant) dCant.value = pend ? String(pend) : "1";
          if (dFecha && !dFecha.value) dFecha.value = todayISO();
          bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDevolucion")).show();
        });
      });

    } catch (err) {
      console.error("Error cargando tab préstamos:", err);
      if (tblPrestamosTab) tblPrestamosTab.innerHTML = `<tr><td colspan="10" class="text-danger text-center py-3">Error cargando préstamos.</td></tr>`;
    }
  }

  async function cargarAlertas() {
    const rows = await apiAlertas();
    renderAlertas(rows);
    if (kpiAlertas) kpiAlertas.textContent = String(rows.length);
  }

  async function cargarResumenRango() {
    const data = await apiResumen(rDesde?.value || "", rHasta?.value || "");
    renderResumenTables(data);
  }

  async function cargarKpis() {
    const desde = monthStartISO();
    const hasta = nextMonthStartISO();
    const vMes = await apiVentasResumen(desde, hasta);
    if (kpiConsumoMes) kpiConsumoMes.textContent = String(vMes?.total_ventas ?? 0);
    if (kpiCostoMes) kpiCostoMes.textContent = bs(vMes?.monto_ventas ?? 0);
    const activos = itemsCache.filter(x => (x.estado || "Activo") === "Activo");
    if (kpiItems) kpiItems.textContent = String(activos.length);
  }

  async function recargarTodo() {
    setMsg(msgInv, "Actualizando…", "text-muted");
    try {
      await cargarItems();
      await Promise.all([cargarAlertas(), cargarPrestamosPendientes(), cargarKardex(), cargarResumenRango(), cargarKpis()]);
      setMsg(msgInv, "✔ Listo", "text-success");
      setTimeout(() => setMsg(msgInv, "", "text-muted"), 2500);
    } catch (err) {
      console.error(err);
      setMsg(msgInv, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  }

  // ===== Acciones por fila =====
  async function handleItemAction(act, id) {
    if (act === "kardex") {
      document.querySelector('[data-bs-target="#tabKardex"]')?.click();
      if (kItem) kItem.value = String(id);
      await cargarKardex();
      return;
    }
    if (act === "operar") {
      // Abrir selector, pre-seleccionando el item
      const selectorModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("modalSelector"));
      // Guardamos el item_id a preseleccionar
      document.getElementById("modalSelector").dataset.preItem = id;
      selectorModal.show();
      return;
    }
    const itemResp = await apiGetItem(id);
    if (!itemResp?.data) { alert("No se pudo cargar el material."); return; }
    const item = itemResp.data;

    if (act === "edit") {
      document.getElementById("modalItemTitle").textContent = "Editar material";
      itId.value = item.id;
      itProducto.value = item.producto || "";
      itCategoria.value = item.categoria || "";
      itUnidad.value = item.unidad || "";
      itMin.value = item.stock_minimo ?? 0;
      itEstadoForm.value = item.estado || "Activo";
      setMsg(msgItem, "", "text-muted");
      bootstrap.Modal.getOrCreateInstance(document.getElementById("modalItem")).show();
      return;
    }
    if (act === "toggleEstado") {
      const nuevoEstado = item.estado === "Activo" ? "Inactivo" : "Activo";
      const label = nuevoEstado === "Inactivo" ? "¿Inactivar" : "¿Activar";
      if (!confirm(`${label} el material "${item.producto}"?`)) return;
      try {
        await apiUpdateItem(item.id, { estado: nuevoEstado });
        await cargarItems();
      } catch (err) { alert("Error: " + (err.message || "desconocido")); }
      return;
    }
  }

  // ===== Formulario: Material =====
  formItem?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        producto: (itProducto.value || "").trim(),
        categoria: (itCategoria.value || "").trim() || null,
        unidad: (itUnidad.value || "").trim() || null,
        stock_minimo: Number(itMin.value || 0),
        estado: itEstadoForm.value || "Activo"
      };
      if (!payload.producto) return setMsg(msgItem, "El nombre del producto es obligatorio.", "text-danger");
      setMsg(msgItem, "Guardando…", "text-muted");
      if (itId.value) {
        await apiUpdateItem(Number(itId.value), payload);
      } else {
        await apiCreateItem(payload);
      }
      setMsg(msgItem, "✔ Guardado correctamente", "text-success");
      await cargarItems();
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(document.getElementById("modalItem")).hide(), 600);
    } catch (err) {
      console.error(err);
      setMsg(msgItem, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  });

  // Al abrir modal nuevo material → resetear
  document.getElementById("modalItem")?.addEventListener("show.bs.modal", (e) => {
    // Si se abrió desde el botón "Nuevo material" (no desde editar)
    if (!itId.value) {
      document.getElementById("modalItemTitle").textContent = "Nuevo material";
      formItem?.reset();
      itEstadoForm.value = "Activo";
    }
  });
  document.getElementById("modalItem")?.addEventListener("hidden.bs.modal", () => {
    itId.value = "";
    formItem?.reset();
    setMsg(msgItem, "", "text-muted");
  });

  // ===== Formulario: PRÉSTAMO =====
  formConsumo?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        item_id: Number(csItem.value || 0),
        cantidad: Number(csCant.value || 0),
        fecha: csFecha.value || todayISO(),
        nota: (csMotivo.value || "").trim() || "Préstamo en clase",
        curso_id: csCurso.value ? Number(csCurso.value) : null,
        instructor_id: csInstructor.value ? Number(csInstructor.value) : null,
        costo_unitario: Number(csCosto.value || 0)
      };
      if (!payload.item_id) return setMsg(msgConsumo, "Selecciona un material.", "text-danger");
      if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgConsumo, "Cantidad inválida.", "text-danger");
      if (!payload.instructor_id) return setMsg(msgConsumo, "Selecciona un profesor (obligatorio).", "text-danger");
      const stock = await getStockLocal(payload.item_id);
      if (stock - payload.cantidad < 0) return setMsg(msgConsumo, `Stock insuficiente (disponible: ${stock}).`, "text-danger");
      setMsg(msgConsumo, "Registrando préstamo…", "text-muted");
      await apiCreatePrestamo(payload);
      setMsg(msgConsumo, "✔ Préstamo registrado.", "text-success");
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(document.getElementById("modalConsumo")).hide(), 600);
    } catch (err) {
      console.error(err);
      setMsg(msgConsumo, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  });
  document.getElementById("modalConsumo")?.addEventListener("show.bs.modal", () => {
    if (csFecha && !csFecha.value) csFecha.value = todayISO();
    // Pre-seleccionar item si viene de "Registrar operación"
    const preItem = document.getElementById("modalSelector")?.dataset.preItem;
    if (preItem && csItem) csItem.value = preItem;
    setMsg(msgConsumo, "", "text-muted");
  });
  document.getElementById("modalConsumo")?.addEventListener("hidden.bs.modal", () => {
    formConsumo?.reset();
    setMsg(msgConsumo, "", "text-muted");
  });

  // ===== Formulario: INGRESO =====
  formIngreso?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        item_id: Number(igItem.value || 0),
        tipo: "Ingreso",
        cantidad: Number(igCant.value || 0),
        costo_unitario: Number(igCosto.value || 0),
        fecha: igFecha.value || todayISO(),
        motivo: (igMotivo.value || "").trim() || "Ingreso de stock"
      };
      if (!payload.item_id) return setMsg(msgIngreso, "Selecciona un material.", "text-danger");
      if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgIngreso, "Cantidad inválida.", "text-danger");
      setMsg(msgIngreso, "Registrando ingreso…", "text-muted");
      await apiCreateMovimiento(payload);
      setMsg(msgIngreso, "✔ Ingreso registrado.", "text-success");
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(document.getElementById("modalIngreso")).hide(), 600);
    } catch (err) {
      console.error(err);
      setMsg(msgIngreso, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  });
  document.getElementById("modalIngreso")?.addEventListener("show.bs.modal", () => {
    if (igFecha && !igFecha.value) igFecha.value = todayISO();
    const preItem = document.getElementById("modalSelector")?.dataset.preItem;
    if (preItem && igItem) igItem.value = preItem;
    setMsg(msgIngreso, "", "text-muted");
  });
  document.getElementById("modalIngreso")?.addEventListener("hidden.bs.modal", () => {
    formIngreso?.reset();
    setMsg(msgIngreso, "", "text-muted");
  });

  // ===== Formulario: VENTA =====
  formVenta?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        item_id: Number(vItem.value || 0),
        cantidad: Number(vCant.value || 0),
        precio_unitario: Number(vPrecio.value || 0),
        fecha: vFecha.value || todayISO(),
        nota: (vNota.value || "").trim() || "Venta",
        curso_id: vCurso.value ? Number(vCurso.value) : null,
        instructor_id: vInstructor.value ? Number(vInstructor.value) : null
      };
      if (!payload.item_id) return setMsg(msgVenta, "Selecciona un material.", "text-danger");
      if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgVenta, "Cantidad inválida.", "text-danger");
      if (payload.precio_unitario < 0) return setMsg(msgVenta, "Precio inválido.", "text-danger");
      const stock = await getStockLocal(payload.item_id);
      if (stock - payload.cantidad < 0) return setMsg(msgVenta, `Stock insuficiente (disponible: ${stock}).`, "text-danger");
      setMsg(msgVenta, "Registrando venta…", "text-muted");
      await apiCreateVenta(payload);
      setMsg(msgVenta, "✔ Venta registrada.", "text-success");
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(document.getElementById("modalVenta")).hide(), 600);
    } catch (err) {
      console.error(err);
      setMsg(msgVenta, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  });
  document.getElementById("modalVenta")?.addEventListener("show.bs.modal", () => {
    if (vFecha && !vFecha.value) vFecha.value = todayISO();
    const preItem = document.getElementById("modalSelector")?.dataset.preItem;
    if (preItem && vItem) vItem.value = preItem;
    setMsg(msgVenta, "", "text-muted");
  });
  document.getElementById("modalVenta")?.addEventListener("hidden.bs.modal", () => {
    formVenta?.reset();
    setMsg(msgVenta, "", "text-muted");
  });

  // ===== Formulario: DEVOLUCIÓN =====
  formDevolucion?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const prestamoId = Number(dPrestamo.value || 0);
      const payload = {
        fecha: dFecha.value || todayISO(),
        cantidad: Number(dCant.value || 0),
        nota: (dNota.value || "").trim() || "Devolución"
      };
      if (!prestamoId) return setMsg(msgDevolucion, "Selecciona un préstamo pendiente.", "text-danger");
      if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgDevolucion, "Cantidad inválida.", "text-danger");
      setMsg(msgDevolucion, "Registrando devolución…", "text-muted");
      await apiDevolverPrestamo(prestamoId, payload);
      setMsg(msgDevolucion, "✔ Devolución registrada.", "text-success");
      await recargarTodo();
      setTimeout(() => bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDevolucion")).hide(), 600);
    } catch (err) {
      console.error(err);
      setMsg(msgDevolucion, "Error: " + (err.message || "desconocido"), "text-danger");
    }
  });
  document.getElementById("modalDevolucion")?.addEventListener("show.bs.modal", async () => {
    if (dFecha && !dFecha.value) dFecha.value = todayISO();
    setMsg(msgDevolucion, "", "text-muted");
    await cargarPrestamosPendientes();
  });
  document.getElementById("modalDevolucion")?.addEventListener("hidden.bs.modal", () => {
    formDevolucion?.reset();
    setMsg(msgDevolucion, "", "text-muted");
  });

  // Cambio en select devolución → actualizar cantidad
  dPrestamo?.addEventListener("change", () => {
    const opt = dPrestamo.selectedOptions?.[0];
    const pend = Number(opt?.getAttribute("data-pendiente") || 0);
    if (dCant) dCant.value = pend ? String(pend) : "1";
  });

  // ===== Modal Selector → redirigir al modal correcto =====
  function abrirDesdeSelector(targetModalId) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalSelector")).hide();
    setTimeout(() => {
      bootstrap.Modal.getOrCreateInstance(document.getElementById(targetModalId)).show();
    }, 200);
  }

  document.getElementById("selPrestamo")?.addEventListener("click", () => abrirDesdeSelector("modalConsumo"));
  document.getElementById("selDevolucion")?.addEventListener("click", () => abrirDesdeSelector("modalDevolucion"));
  document.getElementById("selVenta")?.addEventListener("click", () => abrirDesdeSelector("modalVenta"));
  document.getElementById("selIngreso")?.addEventListener("click", () => abrirDesdeSelector("modalIngreso"));

  // Limpiar preItem al cerrar selector
  document.getElementById("modalSelector")?.addEventListener("hidden.bs.modal", () => {
    delete document.getElementById("modalSelector").dataset.preItem;
  });

  // ===== Botones de filtros =====
  document.getElementById("btnReloadInv")?.addEventListener("click", recargarTodo);
  document.getElementById("btnBuscarItems")?.addEventListener("click", cargarItems);
  document.getElementById("btnLimpiarItems")?.addEventListener("click", async () => {
    if (qItem) qItem.value = "";
    if (fEstado) fEstado.value = "";
    await cargarItems();
  });
  document.getElementById("btnKBuscar")?.addEventListener("click", cargarKardex);
  document.getElementById("btnKLimpiar")?.addEventListener("click", async () => {
    if (kTipo) kTipo.value = "";
    if (kDesde) kDesde.value = "";
    if (kHasta) kHasta.value = "";
    await cargarKardex();
  });
  document.getElementById("btnRBuscar")?.addEventListener("click", cargarResumenRango);
  document.getElementById("btnRLimp")?.addEventListener("click", async () => {
    if (rDesde) rDesde.value = "";
    if (rHasta) rHasta.value = "";
    await cargarResumenRango();
  });
  document.getElementById("btnFiltrarPrestamos")?.addEventListener("click", cargarTabPrestamos);
  document.getElementById("btnLimpiarPrestamos")?.addEventListener("click", () => {
    if (pFiltroEstado) pFiltroEstado.value = "Pendiente";
    if (pFiltroInstructor) pFiltroInstructor.value = "";
    cargarTabPrestamos();
  });
  document.getElementById("btnTabPrestamos")?.addEventListener("click", cargarTabPrestamos);

  // Búsqueda con Enter
  qItem?.addEventListener("keydown", (e) => { if (e.key === "Enter") cargarItems(); });

  // ===== INIT =====
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      setMsg(msgInv, "Cargando…", "text-muted");
      [cursosCache, instructoresCache] = await Promise.all([apiGetCursos(), apiGetInstructores()]);

      fillSelect(csCurso, cursosCache, x => x.nombre, true, "— Sin curso —");
      fillSelect(csInstructor, instructoresCache, x => x.nombre, true, "— Selecciona profesor —");
      fillSelect(vCurso, cursosCache, x => x.nombre, true, "— Sin curso —");
      fillSelect(vInstructor, instructoresCache, x => x.nombre, true, "— Sin profesor —");

      await recargarTodo();
    } catch (err) {
      console.error(err);
      setMsg(msgInv, "Error al cargar: " + (err.message || "desconocido"), "text-danger");
    }
  });

})();
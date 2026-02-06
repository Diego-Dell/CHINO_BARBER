// public/js/inventario.js (Materiales de clase)
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

function pad2(n){ return String(n).padStart(2,"0"); }
function todayISO(){
  const d=new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function monthStartISO(d=new Date()){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-01`;
}
function nextMonthStartISO(d=new Date()){
  return `${d.getFullYear()}-${pad2(d.getMonth()+2)}-01`;
}

// ===== Elements =====
const btnReloadInv = document.getElementById("btnReloadInv");
const msgInv = document.getElementById("msgInv");

// KPIs
const kpiItems = document.getElementById("kpiItems");
const kpiAlertas = document.getElementById("kpiAlertas");
const kpiConsumoMes = document.getElementById("kpiConsumoMes");
const kpiCostoMes = document.getElementById("kpiCostoMes");

// Items
const itBuscar = document.getElementById("itBuscar");
const itEstado = document.getElementById("itEstado");
const btnFiltrarItems = document.getElementById("btnFiltrarItems");
const itResumen = document.getElementById("itResumen");
const tablaItemsBody = document.querySelector("#tablaItems tbody");

// Kardex
const kItem = document.getElementById("kItem");
const kTipo = document.getElementById("kTipo");
const kDesde = document.getElementById("kDesde");
const kHasta = document.getElementById("kHasta");
const btnFiltrarKardex = document.getElementById("btnFiltrarKardex");
const kResumen = document.getElementById("kResumen");
const tablaKardexBody = document.querySelector("#tablaKardex tbody");

// Alertas
const aResumen = document.getElementById("aResumen");
const tablaAlertasBody = document.querySelector("#tablaAlertas tbody");

// Resumen
const rDesde = document.getElementById("rDesde");
const rHasta = document.getElementById("rHasta");
const btnResumen = document.getElementById("btnResumen");
const rConsumo = document.getElementById("rConsumo");
const rCosto = document.getElementById("rCosto");
const tablaResumenCursoBody = document.querySelector("#tablaResumenCurso tbody");
const tablaResumenInstructorBody = document.querySelector("#tablaResumenInstructor tbody");

// Modal Item
const formItem = document.getElementById("formItem");
const itemTitle = document.getElementById("itemTitle");
const itId = document.getElementById("itId");
const itProducto = document.getElementById("itProducto");
const itCategoria = document.getElementById("itCategoria");
const itUnidad = document.getElementById("itUnidad");
const itMin = document.getElementById("itMin");
const itEstadoForm = document.getElementById("itEstadoForm");
const msgItem = document.getElementById("msgItem");

// Modal Consumo
const formConsumo = document.getElementById("formConsumo");
const csItem = document.getElementById("csItem");
const csCant = document.getElementById("csCant");
const csFecha = document.getElementById("csFecha");
const csCurso = document.getElementById("csCurso");
const csInstructor = document.getElementById("csInstructor");
const csCosto = document.getElementById("csCosto");
const csMotivo = document.getElementById("csMotivo");
const msgConsumo = document.getElementById("msgConsumo");

// Modal Ingreso
const formIngreso = document.getElementById("formIngreso");
const igItem = document.getElementById("igItem");
const igCant = document.getElementById("igCant");
const igFecha = document.getElementById("igFecha");
const igCosto = document.getElementById("igCosto");
const igMotivo = document.getElementById("igMotivo");
const msgIngreso = document.getElementById("msgIngreso");

// ===== Cache =====
let itemsCache = [];
let cursosCache = [];
let instructoresCache = [];

// ===== API =====
async function apiListItems(params={}){
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.estado) sp.set("estado", params.estado);
  sp.set("limit", params.limit ?? 500);
  sp.set("offset", params.offset ?? 0);
  const r = await fetchJSON(`/api/inventario/items?${sp.toString()}`);
  return r?.data || [];
}

async function apiCreateItem(payload){
  return fetchJSON("/api/inventario/items", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
}

async function apiUpdateItem(id, payload){
  return fetchJSON(`/api/inventario/items/${id}`, {
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
}

async function apiRemoveItem(id){
  return fetchJSON(`/api/inventario/items/${id}`, { method:"DELETE" });
}

async function apiCreateMovimiento(payload){
  return fetchJSON("/api/inventario/movimientos", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
}

async function apiListMovimientos(params={}){
  const sp = new URLSearchParams();
  for (const [k,v] of Object.entries(params)){
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const r = await fetchJSON(`/api/inventario/movimientos${sp.toString() ? `?${sp.toString()}` : ""}`);
  return r?.data || [];
}

async function apiAlertas(){
  const r = await fetchJSON("/api/inventario/alertas");
  return r?.data || [];
}

async function apiResumen(desde, hasta){
  const sp = new URLSearchParams();
  if (desde) sp.set("desde", desde);
  if (hasta) sp.set("hasta", hasta);
  const r = await fetchJSON(`/api/inventario/resumen?${sp.toString()}`);
  return r?.data || null;
}

async function apiGetCursos(){
  const r = await fetchJSON("/api/cursos");
  return Array.isArray(r) ? r : (r?.data || []);
}

async function apiGetInstructores(){
  const r = await fetchJSON("/api/instructores");
  return Array.isArray(r) ? r : (r?.data || []);
}

// ===== UI Helpers =====
function setMsg(el, text, cls="text-muted"){
  if (!el) return;
  el.textContent = text || "";
  el.className = cls;
}

function fillSelect(el, list, getLabel){
  if (!el) return;
  el.innerHTML = list.map(x => `<option value="${esc(x.id)}">${esc(getLabel(x))}</option>`).join("");
}

function fillSelectWithEmpty(el, list, emptyLabel, getLabel){
  if (!el) return;
  el.innerHTML =
    `<option value="">${esc(emptyLabel)}</option>` +
    list.map(x => `<option value="${esc(x.id)}">${esc(getLabel(x))}</option>`).join("");
}

function stockBadge(stock, min){
  const alerta = Number(stock) <= Number(min);
  return alerta
    ? `<span class="badge badge-soft-danger">Stock bajo</span>`
    : `<span class="badge badge-soft-ok">OK</span>`;
}

// ===== Render Items =====
function renderItemsTable(list){
  if (!tablaItemsBody) return;

  if (!list.length){
    tablaItemsBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No hay materiales.</td></tr>`;
    if (itResumen) itResumen.textContent = "0 materiales";
    return;
  }

  tablaItemsBody.innerHTML = list.map(it => {
    const stock = Number(it.stock_actual||0);
    const min = Number(it.stock_minimo||0);
    const alerta = stock <= min;
    const estado = it.estado || "Activo";

    return `
      <tr class="${alerta ? "table-warning" : ""}">
        <td>${esc(it.id)}</td>
        <td class="fw-semibold">${esc(it.producto)}</td>
        <td class="text-muted">${esc(it.categoria||"—")}</td>
        <td class="text-end">${stock}</td>
        <td class="text-end">${min}</td>
        <td>
          ${stockBadge(stock, min)}
          <span class="ms-1 text-muted small">${esc(estado)}</span>
        </td>
        <td>
          <div class="d-flex flex-wrap gap-1">
            <button class="btn btn-sm btn-outline-secondary btn-round" data-act="kardex" data-id="${esc(it.id)}">Kardex</button>
            <button class="btn btn-sm btn-danger btn-round" data-act="consumir" data-id="${esc(it.id)}">Consumir</button>
            <button class="btn btn-sm btn-success btn-round" data-act="reponer" data-id="${esc(it.id)}">Reponer</button>
            <button class="btn btn-sm btn-outline-primary btn-round" data-act="edit" data-id="${esc(it.id)}">Editar</button>
            <button class="btn btn-sm btn-outline-danger btn-round" data-act="inactivar" data-id="${esc(it.id)}">Inactivar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (itResumen) itResumen.textContent = `${list.length} material${list.length!==1?"es":""}`;

  tablaItemsBody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=> handleItemAction(btn.dataset.act, btn.dataset.id));
  });
}

async function handleItemAction(act, id){
  const item = itemsCache.find(x=> String(x.id)===String(id));
  if (!item) return;

  if (act === "kardex"){
    document.querySelector('[data-bs-target="#tabKardex"]')?.click();
    if (kItem) kItem.value = String(item.id);
    await cargarKardex();
    return;
  }

  if (act === "consumir"){
    const modalEl = document.getElementById("modalConsumo");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    csItem.value = String(item.id);
    csCant.value = "1";
    csCosto.value = "0";
    csMotivo.value = "Clase práctica";
    if (!csFecha.value) csFecha.value = todayISO();
    setMsg(msgConsumo, `Material: ${item.producto}`, "text-muted");
    modal.show();
    return;
  }

  if (act === "reponer"){
    const modalEl = document.getElementById("modalIngreso");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    igItem.value = String(item.id);
    igCant.value = "1";
    igCosto.value = "0";
    igMotivo.value = "Reposición";
    if (!igFecha.value) igFecha.value = todayISO();
    setMsg(msgIngreso, `Material: ${item.producto}`, "text-muted");
    modal.show();
    return;
  }

  if (act === "edit"){
    const modalEl = document.getElementById("modalItem");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    itemTitle.textContent = "Editar material";
    itId.value = item.id;
    itProducto.value = item.producto || "";
    itCategoria.value = item.categoria || "";
    itUnidad.value = item.unidad || "";
    itMin.value = Number(item.stock_minimo||0);
    itEstadoForm.value = item.estado || "Activo";
    setMsg(msgItem, `ID #${item.id}`, "text-muted");
    modal.show();
    return;
  }

  if (act === "inactivar"){
    if (!confirm("¿Seguro que deseas inactivar este material?")) return;
    try{
      await apiRemoveItem(item.id);
      await recargarTodo();
    }catch(e){
      alert("Error: " + (e.message||"desconocido"));
    }
    return;
  }
}

// ===== Kardex =====
function renderKardex(rows){
  if (!tablaKardexBody) return;

  if (!rows.length){
    tablaKardexBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No hay movimientos.</td></tr>`;
    if (kResumen) kResumen.textContent = "0 movimientos";
    return;
  }

  tablaKardexBody.innerHTML = rows.map(r=>{
    const tipo = r.tipo || "—";
    const badge =
      tipo === "Ingreso" ? "bg-success" :
      tipo === "Salida" ? "bg-danger" :
      "bg-primary";

    const tipoTxt = tipo === "Salida" ? "Consumo" : tipo;

    return `
      <tr>
        <td>${esc(r.id)}</td>
        <td>${esc((r.fecha||"").slice(0,10) || "—")}</td>
        <td><span class="badge ${badge}">${esc(tipoTxt)}</span></td>
        <td class="text-end">${esc(r.cantidad)}</td>
        <td class="text-end">${bs(r.costo_unitario || 0)}</td>
        <td class="text-muted">${esc(r.motivo||"—")}</td>
        <td>${esc(r.curso_nombre||"—")}</td>
        <td>${esc(r.instructor_nombre||"—")}</td>
      </tr>
    `;
  }).join("");

  if (kResumen) kResumen.textContent = `${rows.length} movimiento${rows.length!==1?"s":""}`;
}

// ===== Alertas =====
function renderAlertas(rows){
  if (!tablaAlertasBody) return;

  if (!rows.length){
    tablaAlertasBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No hay alertas.</td></tr>`;
    if (aResumen) aResumen.textContent = "0 alertas";
    return;
  }

  tablaAlertasBody.innerHTML = rows.map(it=>{
    const stock = Number(it.stock_actual||0);
    const min = Number(it.stock_minimo||0);
    return `
      <tr class="table-warning">
        <td>${esc(it.id)}</td>
        <td class="fw-semibold">${esc(it.producto)}</td>
        <td class="text-muted">${esc(it.categoria||"—")}</td>
        <td class="text-end">${stock}</td>
        <td class="text-end">${min}</td>
        <td>
          <div class="d-flex flex-wrap gap-1">
            <button class="btn btn-sm btn-danger btn-round" data-act="consumir" data-id="${esc(it.id)}">Consumir</button>
            <button class="btn btn-sm btn-success btn-round" data-act="reponer" data-id="${esc(it.id)}">Reponer</button>
            <button class="btn btn-sm btn-outline-secondary btn-round" data-act="kardex" data-id="${esc(it.id)}">Kardex</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  if (aResumen) aResumen.textContent = `${rows.length} alerta${rows.length!==1?"s":""}`;

  tablaAlertasBody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=> handleItemAction(btn.dataset.act, btn.dataset.id));
  });
}

// ===== Resumen =====
function renderResumenTables(data){
  if (!data){
    tablaResumenCursoBody.innerHTML = `<tr><td class="text-muted">—</td><td class="text-end text-muted">—</td></tr>`;
    tablaResumenInstructorBody.innerHTML = `<tr><td class="text-muted">—</td><td class="text-end text-muted">—</td></tr>`;
    return;
  }

  // En tu backend resumen devuelve total_salidas y costo_salidas
  rConsumo.textContent = data.total_salidas ?? 0;
  rCosto.textContent = bs(data.costo_salidas ?? 0);

  const pc = data.costo_total_por_curso || [];
  const pi = data.costo_total_por_instructor || [];

  tablaResumenCursoBody.innerHTML = pc.length
    ? pc.map(r=>`<tr><td>${esc(r.curso_nombre||"—")}</td><td class="text-end">${bs(r.costo_total||0)}</td></tr>`).join("")
    : `<tr><td class="text-muted">Sin datos</td><td class="text-end text-muted">—</td></tr>`;

  tablaResumenInstructorBody.innerHTML = pi.length
    ? pi.map(r=>`<tr><td>${esc(r.instructor_nombre||"—")}</td><td class="text-end">${bs(r.costo_total||0)}</td></tr>`).join("")
    : `<tr><td class="text-muted">Sin datos</td><td class="text-end text-muted">—</td></tr>`;
}

// ===== Loaders =====
async function cargarItems(){
  const q = (itBuscar?.value||"").trim();
  const estado = (itEstado?.value||"").trim();
  const rows = await apiListItems({ q, estado, limit: 500, offset: 0 });
  itemsCache = rows;

  fillSelect(csItem, itemsCache, x => x.producto);
  fillSelect(igItem, itemsCache, x => x.producto);
  fillSelect(kItem, itemsCache, x => x.producto);

  renderItemsTable(itemsCache);
}

async function cargarKardex(){
  const item_id = kItem?.value || "";
  if (!item_id){ renderKardex([]); return; }
  const tipo = kTipo?.value || "";
  const desde = kDesde?.value || "";
  const hasta = kHasta?.value || "";
  const rows = await apiListMovimientos({ item_id, tipo, desde, hasta });
  renderKardex(rows);
}

async function cargarAlertas(){
  const rows = await apiAlertas();
  renderAlertas(rows);
  if (kpiAlertas) kpiAlertas.textContent = String(rows.length);
}

async function cargarResumenRango(){
  const desde = rDesde?.value || "";
  const hasta = rHasta?.value || "";
  const data = await apiResumen(desde, hasta);
  renderResumenTables(data);
}

async function cargarKpisMes(){
  const desde = monthStartISO(new Date());
  const hasta = nextMonthStartISO(new Date());
  const dataMes = await apiResumen(desde, hasta);

  // consumo = salidas
  if (kpiConsumoMes) kpiConsumoMes.textContent = String(dataMes?.total_salidas ?? 0);
  if (kpiCostoMes) kpiCostoMes.textContent = bs(dataMes?.costo_salidas ?? 0);

  const activos = itemsCache.filter(x => (x.estado||"Activo") === "Activo");
  if (kpiItems) kpiItems.textContent = String(activos.length);
}

async function recargarTodo(){
  setMsg(msgInv, "Actualizando...", "text-muted");
  await cargarItems();
  await cargarAlertas();
  await cargarKardex();
  await cargarResumenRango();
  await cargarKpisMes();
  setMsg(msgInv, "Listo ✔", "text-success");
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", async ()=>{
  try{
    setMsg(msgInv, "Cargando...", "text-muted");

    cursosCache = await apiGetCursos();
    instructoresCache = await apiGetInstructores();

    fillSelectWithEmpty(csCurso, cursosCache, "— Sin curso —", x => x.nombre);
    fillSelectWithEmpty(csInstructor, instructoresCache, "— Sin instructor —", x => x.nombre);

    // ingreso no necesita curso/instructor
    // fechas default
    if (csFecha && !csFecha.value) csFecha.value = todayISO();
    if (igFecha && !igFecha.value) igFecha.value = todayISO();

    // resumen default mes actual
    if (rDesde && !rDesde.value) rDesde.value = monthStartISO(new Date());
    if (rHasta && !rHasta.value) rHasta.value = todayISO();

    await recargarTodo();
  }catch(e){
    console.error(e);
    setMsg(msgInv, "Error: " + (e.message||"desconocido"), "text-danger");
  }
});

// ===== Events =====
btnReloadInv?.addEventListener("click", recargarTodo);
btnFiltrarItems?.addEventListener("click", recargarTodo);
itBuscar?.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ e.preventDefault(); recargarTodo(); } });
itEstado?.addEventListener("change", recargarTodo);

btnFiltrarKardex?.addEventListener("click", cargarKardex);
btnResumen?.addEventListener("click", cargarResumenRango);

// ===== Guardar Material (Item) =====
formItem?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  try{
    const payload = {
      producto: (itProducto.value||"").trim(),
      categoria: (itCategoria.value||"").trim(),
      unidad: (itUnidad.value||"").trim(),
      stock_minimo: Number(itMin.value||0),
      estado: (itEstadoForm.value||"Activo"),
    };

    if (!payload.producto){
      setMsg(msgItem, "El material es obligatorio", "text-danger");
      return;
    }

    setMsg(msgItem, "Guardando...", "text-muted");
    const id = (itId.value||"").trim();

    if (id) await apiUpdateItem(id, payload);
    else await apiCreateItem(payload);

    setMsg(msgItem, "Guardado ✔", "text-success");
    await recargarTodo();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalItem")).hide();
  }catch(err){
    console.error(err);
    setMsg(msgItem, "Error: " + (err.message||"desconocido"), "text-danger");
  }
});

// Reset modal item when opened manually
document.getElementById("modalItem")?.addEventListener("show.bs.modal", ()=>{
  if (!itId.value){
    itemTitle.textContent = "Nuevo material";
    itProducto.value = "";
    itCategoria.value = "";
    itUnidad.value = "";
    itMin.value = "0";
    itEstadoForm.value = "Activo";
    setMsg(msgItem, "");
  }
});

// ===== Registrar CONSUMO (Salida) =====
formConsumo?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  try{
    const payload = {
      item_id: Number(csItem.value||0),
      tipo: "Salida",
      cantidad: Number(csCant.value||0),
      costo_unitario: Number(csCosto.value||0),
      fecha: (csFecha.value||todayISO()),
      motivo: (csMotivo.value||"").trim() || "Consumo en clase",
      curso_id: csCurso.value ? Number(csCurso.value) : null,
      instructor_id: csInstructor.value ? Number(csInstructor.value) : null,
    };

    if (!payload.item_id) return setMsg(msgConsumo, "Selecciona un material", "text-danger");
    if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgConsumo, "Cantidad inválida", "text-danger");

    setMsg(msgConsumo, "Registrando consumo...", "text-muted");
    await apiCreateMovimiento(payload);

    setMsg(msgConsumo, "Consumo registrado ✔", "text-success");
    await recargarTodo();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalConsumo")).hide();
  }catch(err){
    console.error(err);
    setMsg(msgConsumo, "Error: " + (err.message||"desconocido"), "text-danger");
  }
});

document.getElementById("modalConsumo")?.addEventListener("shown.bs.modal", ()=>{
  if (csFecha && !csFecha.value) csFecha.value = todayISO();
});

// ===== Registrar INGRESO (Reposición) =====
formIngreso?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  try{
    const payload = {
      item_id: Number(igItem.value||0),
      tipo: "Ingreso",
      cantidad: Number(igCant.value||0),
      costo_unitario: Number(igCosto.value||0),
      fecha: (igFecha.value||todayISO()),
      motivo: (igMotivo.value||"").trim() || "Reposición",
      curso_id: null,
      instructor_id: null,
    };

    if (!payload.item_id) return setMsg(msgIngreso, "Selecciona un material", "text-danger");
    if (!payload.cantidad || payload.cantidad <= 0) return setMsg(msgIngreso, "Cantidad inválida", "text-danger");

    setMsg(msgIngreso, "Registrando ingreso...", "text-muted");
    await apiCreateMovimiento(payload);

    setMsg(msgIngreso, "Ingreso registrado ✔", "text-success");
    await recargarTodo();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalIngreso")).hide();
  }catch(err){
    console.error(err);
    setMsg(msgIngreso, "Error: " + (err.message||"desconocido"), "text-danger");
  }
});

document.getElementById("modalIngreso")?.addEventListener("shown.bs.modal", ()=>{
  if (igFecha && !igFecha.value) igFecha.value = todayISO();
});
})();

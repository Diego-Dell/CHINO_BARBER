// public/js/asistencia.js

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (r.status === 401) {
    window.location.href = "/login.html";
    return null;
  }

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

function parseISO(d) {
  const [y, m, day] = String(d || "").split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}
function toISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "Martes-Jueves", "Lunes, Miércoles", etc -> [2,4]
function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();

  const map = [
    ["lunes", 1],
    ["martes", 2],
    ["miercoles", 3],
    ["miércoles", 3],
    ["jueves", 4],
    ["viernes", 5],
    ["sabado", 6],
    ["sábado", 6],
    ["domingo", 0],
  ];

  const out = new Set();
  for (const [name, idx] of map) {
    if (s.includes(name)) out.add(idx);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
  const fi = String(fecha_inicio || "").slice(0, 10);
  const start = parseISO(fi);
  const n = toNum(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || n <= 0 || weekdays.length === 0) return [];

  const fechas = [];
  let cursor = new Date(start);

  while (fechas.length < n) {
    if (weekdays.includes(cursor.getDay())) {
      fechas.push(toISODate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
    if ((cursor - start) / 86400000 > 1200) break;
  }

  return fechas;
}

// BD -> etiqueta UI
function estadoFromDBToUI(estado) {
  const e = String(estado || "").trim().toLowerCase();
  if (e === "asistio") return "Asistió";
  if (e === "falto") return "Faltó";
  if (e === "justificado") return "Licencia";
  // si BD ya guarda Asistió/Faltó/Licencia:
  if (e.includes("asist")) return "Asistió";
  if (e.includes("falt")) return "Faltó";
  if (e.includes("lic") || e.includes("justif")) return "Licencia";
  return "";
}

// UI -> BD
function estadoUIToDB(estadoUI) {
  const e = String(estadoUI || "").trim().toLowerCase();
  if (e === "asistió" || e === "asistio") return "Asistio";
  if (e === "faltó" || e === "falto") return "Falto";
  if (e === "licencia") return "Justificado";
  return "Asistio";
}

// UI -> class
function estadoToDotClass(ui) {
  const e = String(ui || "").toLowerCase();
  if (e.includes("asist")) return "as_ok";
  if (e.includes("falt")) return "as_bad";
  if (e.includes("lic")) return "as_lic";
  return "as_empty";
}

// ===============================
// DOM
// ===============================
const selCurso = document.getElementById("aCurso");
const inpBuscar = document.getElementById("aBuscar");
const msgAs = document.getElementById("msgAs");

// contenedor grilla (tu HTML lo tiene como #asGrid)
const asGrid = document.getElementById("asGrid");

// info opcional (si existe)
const asInfoCurso = document.getElementById("asInfoCurso");

// botón guardar (si existe en tu leyenda/modal)
const btnGuardar = document.getElementById("btnGuardarAsVisual") || document.getElementById("btnGuardarAsistencia") || null;

// ===============================
// Cache
// ===============================
let cursosCache = [];
let fechasCache = [];
let inscritosCache = [];
let asistenciasCache = new Map(); // key: fecha -> Map(inscripcion_id -> "Asistió/Faltó/Licencia")
let cambiosPendientes = new Map(); // key: `${inscId}|${fecha}` -> "Asistió/Faltó/Licencia"

// ===============================
// API calls
// ===============================
async function cargarCursos() {
  const data = await fetchJSON("/api/cursos");
  cursosCache = Array.isArray(data) ? data : [];

  if (!selCurso) return;

  selCurso.innerHTML = cursosCache.length
    ? cursosCache.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")
    : `<option value="">(sin cursos)</option>`;
}

async function getInscritos(cursoId) {
  // intenta query principal
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  let res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  let arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

  // fallback por endpoint alterno si existe
  if (!arr.length) {
    try {
      const res2 = await fetchJSON(`/api/inscripciones/por-curso/${cursoId}`);
      arr = Array.isArray(res2) ? res2 : (Array.isArray(res2?.data) ? res2.data : []);
    } catch (_) {}
  }

  return arr
    .map((r) => ({
      inscripcion_id: r.inscripcion_id ?? r.inscripcionId ?? r.id,
      alumno_nombre: r.alumno_nombre ?? r.nombre ?? "",
      alumno_documento: r.alumno_documento ?? r.documento ?? "",
    }))
    .filter((x) => x.inscripcion_id);
}

async function getAsistenciaDia(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO).slice(0, 10) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (!inscId) continue;
    const ui = estadoFromDBToUI(r.estado);
    m.set(Number(inscId), ui);
  }
  return m;
}

// ===============================
// Render grid (1 sola grilla)
// ===============================
function renderGrid({ curso, fechas, inscritos, filtro }) {
  if (!asGrid) return;

  const q = String(filtro || "").toLowerCase().trim();

  const rows = inscritos.filter((a) => {
    if (!q) return true;
    return (
      String(a.alumno_nombre || "").toLowerCase().includes(q) ||
      String(a.alumno_documento || "").toLowerCase().includes(q)
    );
  });

  asGrid.style.setProperty("--ncols", fechas.length);

  const cells = [];

  // HEADER
  cells.push(`<div class="asCell asHead asName">Alumno</div>`);
  cells.push(`<div class="asCell asHead asCI">CI</div>`);

  for (const f of fechas) {
    cells.push(`<div class="asCell asHead"><div class="asDate">${esc(f.slice(5))}</div></div>`);
  }

  // BODY
  for (const a of rows) {
    const inscId = Number(a.inscripcion_id);
    const name = a.alumno_nombre || "(sin nombre)";
    const ci = a.alumno_documento || "—";

    cells.push(`<div class="asCell asName">${esc(name)}</div>`);
    cells.push(`<div class="asCell asCI">${esc(ci)}</div>`);

    for (const f of fechas) {
      const key = `${inscId}|${f}`;
      const mapDia = asistenciasCache.get(f);
      const base = mapDia ? (mapDia.get(inscId) || "") : "";
      const val = cambiosPendientes.get(key) ?? base;
      const cls = estadoToDotClass(val);
      const title = val ? val : "Sin registro";

      // clickable cell
      cells.push(`
        <div class="asCell">
          <button
            class="asPick"
            data-insc="${esc(inscId)}"
            data-fecha="${esc(f)}"
            title="${esc(title)}"
            type="button">
            <span class="asDot ${esc(cls)}"></span>
          </button>
        </div>
      `);
    }
  }

  if (!rows.length) {
    // si no hay alumnos filtrados
    // (pero mantenemos header)
  }

  asGrid.innerHTML = cells.join("");

  // listeners de cada celda (selector A/F/L)
  asGrid.querySelectorAll(".asPick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inscId = Number(btn.getAttribute("data-insc"));
      const fecha = btn.getAttribute("data-fecha");
      abrirSelectorEstado({ inscId, fecha });
    });
  });
}

// ===============================
// Selector modal/simple (dropdown)
// ===============================
function abrirSelectorEstado({ inscId, fecha }) {
  const key = `${inscId}|${fecha}`;

  const baseMap = asistenciasCache.get(fecha);
  const base = baseMap ? (baseMap.get(inscId) || "") : "";
  const actual = cambiosPendientes.get(key) ?? base;

  const opc = window.prompt(
    `Asistencia ${fecha}
A = Asistió
F = Faltó
L = Licencia

Actual: ${actual || "Sin registro"}

Escribe: A / F / L`,
    actual
      ? actual.startsWith("Asist") ? "A"
        : actual.startsWith("Falt") ? "F"
        : "L"
      : ""
  );

  if (opc === null) return;

  const v = String(opc).trim().toUpperCase();
  let nuevo = "";

  if (v === "A") nuevo = "Asistió";
  else if (v === "F") nuevo = "Faltó";
  else if (v === "L") nuevo = "Licencia";
  else return;

  // 🔴 ESTA LÍNEA ES LA CLAVE (ANTES FALLABA)
  cambiosPendientes.set(key, nuevo);

  renderGrid({
    fechas: fechasCache,
    inscritos: inscritosCache,
    filtro: inpBuscar?.value || ""
  });

  if (msgAs) {
    msgAs.textContent =
      `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · cambios pendientes: ${cambiosPendientes.size}`;
  }
}


// ===============================
// Guardar cambios (bulk)
// ===============================
async function guardarCambios(cursoId) {
  if (!cambiosPendientes.size) {
    alert("No hay cambios para guardar.");
    return;
  }

  const items = [];
  for (const [key, ui] of cambiosPendientes.entries()) {
    const [inscIdStr, fecha] = key.split("|");
    const inscId = Number(inscIdStr);

    // si vacío => podrías implementar DELETE, pero por ahora lo guardamos como Asistio? NO.
    // Mejor: si vacío, lo mandamos como null y el backend lo convierte default,
    // PERO no conviene. Aquí lo omitimos para no ensuciar.
    if (!ui) continue;

    items.push({
      inscripcion_id: inscId,
      fecha,
      estado: estadoUIToDB(ui),
    });
  }

  if (!items.length) {
    alert("No hay cambios válidos para guardar.");
    cambiosPendientes.clear();
    return;
  }

  if (msgAs) msgAs.textContent = "Guardando cambios...";

  await fetchJSON("/api/asistencia/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  cambiosPendientes.clear();

  // recarga BD para asegurarnos que pinta lo guardado
  await refrescarVisual();

  if (msgAs) msgAs.textContent = `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · guardado ✅`;
}

// ===============================
// Refrescar todo (BD)
// ===============================
async function refrescarVisual() {
  const cursoId = Number(selCurso?.value || 0);
  const curso = cursosCache.find((c) => Number(c.id) === cursoId);

  if (!cursoId || !curso) {
    if (msgAs) msgAs.textContent = "Selecciona un curso.";
    if (asGrid) asGrid.innerHTML = "";
    if (asInfoCurso) asInfoCurso.textContent = "";
    return;
  }

  // info curso arriba
  const instructor = curso.instructor_nombre || curso.instructor || "—";
  const inicio = String(curso.fecha_inicio || curso.fechaInicio || "").slice(0, 10) || "—";
  const dias = curso.dias || "—";
  const clases = toNum(curso.nro_clases || curso.nroClases || 0, 0);

  if (asInfoCurso) {
    asInfoCurso.textContent = `Curso: ${curso.nombre} · Instructor: ${instructor} · Inicio: ${inicio} · Días: ${dias} · Clases: ${clases}`;
  }

  fechasCache = buildFechasClases({
    fecha_inicio: curso.fecha_inicio || curso.fechaInicio || "",
    dias: curso.dias || "",
    nro_clases: curso.nro_clases || curso.nroClases || 0,
  });

  if (!fechasCache.length) {
    if (msgAs) msgAs.textContent = "No se pudieron calcular fechas (revisa inicio/días/nro_clases).";
    if (asGrid) asGrid.innerHTML = "";
    return;
  }

  if (msgAs) msgAs.textContent = "Cargando inscritos...";
  inscritosCache = await getInscritos(cursoId);

  if (msgAs) msgAs.textContent = "Cargando asistencia desde BD...";
  asistenciasCache = new Map();

  // cargar cada fecha (simple y seguro)
  for (const f of fechasCache) {
    const m = await getAsistenciaDia(cursoId, f);
    asistenciasCache.set(f, m);
  }

  // render
  renderGrid({
    curso,
    fechas: fechasCache,
    inscritos: inscritosCache,
    filtro: inpBuscar?.value || "",
  });

  if (msgAs) msgAs.textContent = `${inscritosCache.length} alumno(s) · ${fechasCache.length} clase(s) · cambios: ${cambiosPendientes.size}`;
}

// ===============================
// Eventos
// ===============================
selCurso?.addEventListener("change", async () => {
  cambiosPendientes.clear();
  await refrescarVisual();
});

inpBuscar?.addEventListener("input", () => {
  renderGrid({
    curso: null,
    fechas: fechasCache,
    inscritos: inscritosCache,
    filtro: inpBuscar?.value || "",
  });
});

btnGuardar?.addEventListener("click", async () => {
  const cursoId = Number(selCurso?.value || 0);
  if (!cursoId) return alert("Selecciona un curso.");
  try {
    await guardarCambios(cursoId);
  } catch (e) {
    console.error(e);
    alert("Error guardando: " + (e.message || "desconocido"));
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await cargarCursos();
    await refrescarVisual();
  } catch (e) {
    console.error(e);
    if (msgAs) msgAs.textContent = "Error cargando asistencia.";
    if (asGrid) asGrid.innerHTML = `<div class="text-danger small p-3">Error: ${esc(e.message || "desconocido")}</div>`;
  }

  const btnGuardar =
  document.getElementById("btnGuardarAsVisual") ||
  document.getElementById("btnGuardarAsistencia");

if (btnGuardar) {
  btnGuardar.addEventListener("click", async () => {
    try {
      await guardarCambios();
    } catch (e) {
      console.error(e);
      if (msgAs) msgAs.textContent = "Error guardando: " + (e.message || "desconocido");
    }
  });
}

});

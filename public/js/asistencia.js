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

// Convierte "Martes-Jueves", "Lunes, Miércoles", etc. -> [2,4] (JS: 0 dom..6 sáb)
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
  const fi = (fecha_inicio || "").slice(0, 10);
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
    if ((cursor - start) / 86400000 > 900) break; // seguridad
  }
  return fechas;
}

// BD -> etiqueta visible
function estadoToLabel(estado) {
  const e = String(estado || "");
  // si tu backend guarda "Justificado" lo mostramos como Licencia
  if (e === "Justificado") return "Licencia";
  return e;
}

// etiqueta -> clase (cuadrito)
function dotClass(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("asist")) return "as_ok";
  if (e.includes("falt")) return "as_bad";
  if (e.includes("lic") || e.includes("just")) return "as_lic";
  return "as_empty";
}

// DOM
const selCurso = document.getElementById("aCurso");
const inpBuscar = document.getElementById("aBuscar");
const msgAs = document.getElementById("msgAs");
const asInfoCurso = document.getElementById("asInfoCurso");

let cursosCache = [];

async function cargarCursos() {
  const data = await fetchJSON("/api/cursos");
  cursosCache = Array.isArray(data) ? data : [];

  selCurso.innerHTML = cursosCache.length
    ? cursosCache.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
    : `<option value="">(sin cursos)</option>`;
}

async function getInscritos(cursoId) {
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

  return arr.map(r => ({
    inscripcion_id: r.inscripcion_id ?? r.id,
    nombre: r.alumno_nombre ?? r.nombre ?? "",
    documento: r.alumno_documento ?? r.documento ?? "",
  })).filter(x => x.inscripcion_id);
}

async function getAsistenciaDia(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (!inscId) continue;
    m.set(Number(inscId), r.estado ? estadoToLabel(r.estado) : "");
  }
  return m;
}

/**
 * Render 100% alineado:
 * UNA SOLA GRILLA (header + body) -> #asGrid
 */
function renderAsistenciaVisual({ fechas, alumnos }) {
  const grid = document.getElementById("asGrid");
  if (!grid) return;

  // mostramos fechas como "MM-DD"
  const fechasUI = fechas.map(f => String(f).slice(5));

  grid.style.setProperty("--ncols", fechasUI.length);

  const cells = [];

  // HEADER
  cells.push(`<div class="asCell asHead asName">Alumno</div>`);
  cells.push(`<div class="asCell asHead asCI">CI</div>`);

  for (const f of fechasUI) {
    cells.push(`<div class="asCell asHead"><div class="asDate">${esc(f)}</div></div>`);
  }

  // ROWS
  for (const a of alumnos) {
    cells.push(`<div class="asCell asName">${esc(a.nombre || "(sin nombre)")}</div>`);
    cells.push(`<div class="asCell asCI">${esc(a.documento || "—")}</div>`);

    for (const fISO of fechas) {
      const estado = a.asistencias?.[fISO] || "";
      const title = estado ? estado : "Sin registro";

      cells.push(`
        <div class="asCell">
          <div class="asDot ${dotClass(estado)}" title="${esc(title)}"></div>
        </div>
      `);
    }
  }

  grid.innerHTML = cells.join("");
}

async function refrescarVisual() {
  const cursoId = Number(selCurso?.value || 0);
  const curso = cursosCache.find(c => Number(c.id) === cursoId);

  if (!cursoId || !curso) {
    if (msgAs) msgAs.textContent = "Selecciona un curso.";
    const grid = document.getElementById("asGrid");
    if (grid) grid.innerHTML = "";
    if (asInfoCurso) asInfoCurso.textContent = "";
    return;
  }

  const fechas = buildFechasClases({
    fecha_inicio: curso.fecha_inicio || curso.fechaInicio || "",
    dias: curso.dias || "",
    nro_clases: curso.nro_clases || curso.nroClases || 0
  });

  const instructor = curso.instructor_nombre || curso.instructor || "";
  const inicio = (curso.fecha_inicio || curso.fechaInicio || "").slice(0, 10) || "—";
  const clases = toNum(curso.nro_clases || curso.nroClases, 0);

  if (asInfoCurso) {
    asInfoCurso.textContent =
      `Curso: ${curso.nombre} · Instructor: ${instructor || "—"} · Inicio: ${inicio} · Días: ${curso.dias || "—"} · Clases: ${clases}`;
  }

  if (!fechas.length) {
    if (msgAs) msgAs.textContent = "No se pudieron calcular fechas (revisa inicio/días/nro_clases).";
    renderAsistenciaVisual({ fechas: [], alumnos: [] });
    return;
  }

  if (msgAs) msgAs.textContent = "Cargando desde la BD…";

  const inscritos = await getInscritos(cursoId);

  // Map por fecha: fechaISO -> Map(inscId -> estado)
  const porFecha = new Map();
  for (const f of fechas) {
    const mapa = await getAsistenciaDia(cursoId, f);
    porFecha.set(f, mapa);
  }

  // build alumnos con asistencias por fecha ISO
  const q = String(inpBuscar?.value || "").toLowerCase().trim();

  const alumnos = inscritos
    .filter(a => {
      if (!q) return true;
      return (
        String(a.nombre || "").toLowerCase().includes(q) ||
        String(a.documento || "").toLowerCase().includes(q)
      );
    })
    .map(a => {
      const inscId = Number(a.inscripcion_id);
      const asistencias = {};
      for (const f of fechas) {
        asistencias[f] = porFecha.get(f)?.get(inscId) || "";
      }
      return { nombre: a.nombre, documento: a.documento, asistencias };
    });

  renderAsistenciaVisual({ fechas, alumnos });
  if (msgAs) msgAs.textContent = `${inscritos.length} alumno(s) · ${fechas.length} clase(s)`;
}

selCurso?.addEventListener("change", () => refrescarVisual());
inpBuscar?.addEventListener("input", () => refrescarVisual());

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await cargarCursos();
    await refrescarVisual();
  } catch (e) {
    console.error(e);
    if (msgAs) msgAs.textContent = "Error cargando asistencia.";
    const grid = document.getElementById("asGrid");
    if (grid) grid.innerHTML = `<div class="text-danger small">Error: ${esc(e.message || "desconocido")}</div>`;
  }
});



// ===============================
// BOTÓN: Agregar asistencia (bulk)
// ===============================
const btnAgregarAsistencia = document.getElementById("btnAgregarAsistencia");

async function postBulkAsistencia({ cursoId, items }) {
  // Endpoint sugerido (debes tenerlo en backend)
  // items: [{ fecha, inscripcion_id, estado }]
  return fetchJSON("/api/asistencia/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curso_id: cursoId, items }),
  });
}

btnAgregarAsistencia?.addEventListener("click", async () => {
  try {
    const cursoId = Number(selCurso?.value || 0);
    const curso = cursosCache.find(c => Number(c.id) === cursoId);

    if (!cursoId || !curso) {
      alert("Selecciona un curso primero.");
      return;
    }

    const fechas = buildFechasClases({
      fecha_inicio: curso.fecha_inicio || curso.fechaInicio || "",
      dias: curso.dias || "",
      nro_clases: curso.nro_clases || curso.nroClases || 0
    });

    if (!fechas.length) {
      alert("No se pudieron calcular fechas (revisa inicio/días/nro_clases).");
      return;
    }

    if (!confirm(`Se agregará asistencia para ${fechas.length} clases. ¿Continuar?`)) return;

    if (msgAs) msgAs.textContent = "Agregando asistencia en BD…";

    // 1) alumnos inscritos
    const inscritos = await getInscritos(cursoId);
    if (!inscritos.length) {
      alert("No hay alumnos inscritos activos.");
      if (msgAs) msgAs.textContent = "";
      return;
    }

    // 2) Consultar qué ya existe, para no duplicar:
    // armamos un map por fecha (fechaISO -> Map(inscId -> estado))
    const porFecha = new Map();
    for (const f of fechas) {
      const mapa = await getAsistenciaDia(cursoId, f);
      porFecha.set(f, mapa);
    }

    // 3) Generar items SOLO donde no existe registro
    // estado por defecto: "Asistió"
    const items = [];
    for (const f of fechas) {
      const mapa = porFecha.get(f);
      for (const a of inscritos) {
        const inscId = Number(a.inscripcion_id);
        const yaExiste = mapa?.has(inscId);
        if (!yaExiste) {
          items.push({ fecha: f, inscripcion_id: inscId, estado: "Asistió" });
        }
      }
    }

    if (!items.length) {
      if (msgAs) msgAs.textContent = "Ya existe asistencia para todas las clases.";
      await refrescarVisual();
      return;
    }

    // 4) Guardar en lote
    await postBulkAsistencia({ cursoId, items });

    if (msgAs) msgAs.textContent = `Asistencia agregada: ${items.length} registros.`;
    await refrescarVisual();
  } catch (e) {
    console.error(e);
    if (msgAs) msgAs.textContent = "Error agregando asistencia.";
    alert("Error: " + String(e.message || "desconocido"));
  }
});



// ========= ASISTENCIA VISUAL TIPO FOTO (modal) =========

// helpers (si ya los tienes en este archivo, NO los dupliques)
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
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// "Martes-Jueves" -> weekdays
function normDiasToWeekdays(diasStr) {
  const s = String(diasStr || "").toLowerCase();
  const map = [
    ["lunes", 1], ["martes", 2], ["miercoles", 3], ["miércoles", 3],
    ["jueves", 4], ["viernes", 5], ["sabado", 6], ["sábado", 6], ["domingo", 0],
  ];
  const out = new Set();
  for (const [name, idx] of map) if (s.includes(name)) out.add(idx);
  return Array.from(out).sort((a,b)=>a-b);
}

function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
  const fi = (fecha_inicio || "").slice(0, 10);
  const start = parseISO(fi);
  const n = toNum(nro_clases, 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || n <= 0 || weekdays.length === 0) return [];

  const fechas = [];
  let cursor = new Date(start);

  while (fechas.length < n) {
    if (weekdays.includes(cursor.getDay())) fechas.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if ((cursor - start) / 86400000 > 900) break;
  }
  return fechas;
}

// Map estado a letra
function estadoToLetra(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("asist")) return "A";
  if (e.includes("falt")) return "F";
  if (e.includes("lic") || e.includes("justif")) return "L";
  return "";
}
function letraToEstado(letra) {
  if (letra === "A") return "Asistió";
  if (letra === "F") return "Faltó";
  if (letra === "L") return "Licencia";
  return "";
}

// --- API (usa TU fetchJSON ya existente en cursos.js) ---
// Debes tener: GET /api/inscripciones?curso_id= &estado=Activa  (con alumno_nombre, alumno_documento, inscripcion_id/id)
// Debes tener: GET /api/asistencia?curso_id= &fecha=YYYY-MM-DD (con inscripcion_id y estado)
// Para guardar: puedes tener POST /api/asistencia (uno por uno) o bulk. Te dejo saveCells uno por uno.

async function apiGetInscritos(cursoId) {
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  return arr.map(r => ({
    inscripcion_id: r.inscripcion_id ?? r.id,
    alumno_nombre: r.alumno_nombre ?? r.nombre ?? "",
    alumno_documento: r.alumno_documento ?? r.documento ?? "",
  })).filter(x => x.inscripcion_id);
}

async function apiGetAsistenciaDia(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (!inscId) continue;
    m.set(Number(inscId), estadoToLetra(r.estado || ""));
  }
  return m;
}

// Guardar: 1 por celda (seguro, no requiere bulk)
async function apiUpsertAsistencia({ curso_id, inscripcion_id, fecha, estado }) {
  // Ajusta si tu backend usa otra ruta/fields
  return fetchJSON("/api/asistencia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curso_id, inscripcion_id, fecha, estado }),
  });
}

// ===== estado global del modal =====
let AS_FOTO = {
  cursoId: 0,
  fechas: [],
  alumnos: [],
  // Map key "inscId|fecha" -> letra
  values: new Map(),
  // dirty changes: Map key -> letra
  dirty: new Map(),
  curso: null
};

function keyCell(inscId, fechaISO) {
  return `${Number(inscId)}|${fechaISO}`;
}

function renderAsistenciaFotoModal() {
  const grid = document.getElementById("asFotoGrid");
  if (!grid) return;

  const { fechas, alumnos } = AS_FOTO;

  if (!fechas.length) {
    grid.innerHTML = `<div class="text-muted">No se pudieron calcular fechas (revisa inicio/días/nro_clases).</div>`;
    return;
  }

  // Define columnas: 1 col nombres + N fechas
  // grid-template-columns dinámico:
  grid.style.gridTemplateColumns = `var(--nameCol) repeat(${fechas.length}, var(--cell))`;

  const parts = [];

  // Header row: (vacío para la col nombre) + fechas
  parts.push(`<div></div>`);
  for (const f of fechas) {
    parts.push(`<div class="asfoto-h">${esc(f.slice(5))}</div>`);
  }

  // Rows: alumno name + cells
  for (const a of alumnos) {
    parts.push(`
      <div>
        <div class="asfoto-name">${esc(a.alumno_nombre || "—")}</div>
        <div class="asfoto-ci">${esc(a.alumno_documento || "")}</div>
      </div>
    `);

    for (const f of fechas) {
      const inscId = a.inscripcion_id;
      const k = keyCell(inscId, f);
      const letra = AS_FOTO.values.get(k) || ""; // A/F/L/""
      parts.push(`
        <div class="asfoto-cell" data-k="${esc(k)}" data-v="${esc(letra)}">
          <select class="asfoto-select" data-k="${esc(k)}">
            <option value="" ${letra==="" ? "selected":""}></option>
            <option value="A" ${letra==="A" ? "selected":""}>A</option>
            <option value="F" ${letra==="F" ? "selected":""}>F</option>
            <option value="L" ${letra==="L" ? "selected":""}>L</option>
          </select>
        </div>
      `);
    }
  }

  grid.innerHTML = parts.join("");

  // listeners a selects
  grid.querySelectorAll(".asfoto-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const k = e.target.getAttribute("data-k");
      const v = e.target.value; // A/F/L/""
      AS_FOTO.dirty.set(k, v);
      AS_FOTO.values.set(k, v);

      // pinta la celda
      const cell = grid.querySelector(`.asfoto-cell[data-k="${CSS.escape(k)}"]`);
      if (cell) cell.setAttribute("data-v", v);

      const msg = document.getElementById("asFotoMsg");
      if (msg) msg.textContent = `Cambios sin guardar: ${AS_FOTO.dirty.size}`;
    });
  });
}

// ===== abre el modal =====
window.abrirAsistenciaFoto = async function (cursoId) {
  const title = document.getElementById("asFotoTitle");
  const sub = document.getElementById("asFotoSub");
  const msg = document.getElementById("asFotoMsg");
  const grid = document.getElementById("asFotoGrid");

  AS_FOTO = { cursoId: Number(cursoId), fechas: [], alumnos: [], values: new Map(), dirty: new Map(), curso: null };

  try {
    if (msg) msg.textContent = "Cargando…";
    if (grid) grid.innerHTML = "";

    // trae curso desde cache (si tienes cursosCache global)
    const curso = (window.cursosCache || []).find(c => Number(c.id) === Number(cursoId)) || null;
    AS_FOTO.curso = curso;

    const nombreCurso = curso?.nombre || `Curso #${cursoId}`;
    const instructor = curso?.instructor_nombre || curso?.instructor || "—";
    const inicio = (curso?.fecha_inicio || "").slice(0,10) || "—";
    const dias = curso?.dias || "—";
    const clases = toNum(curso?.nro_clases, 0);

    if (title) title.textContent = `ASISTENCIA — ${nombreCurso}`;
    if (sub) sub.textContent = `Instructor: ${instructor} · Inicio: ${inicio} · Días: ${dias} · Clases: ${clases}`;

    // fechas del curso
    const fechas = buildFechasClases({
      fecha_inicio: curso?.fecha_inicio || curso?.fechaInicio || "",
      dias: curso?.dias || "",
      nro_clases: curso?.nro_clases || curso?.nroClases || 0
    });
    AS_FOTO.fechas = fechas;

    // alumnos inscritos
    const alumnos = await apiGetInscritos(cursoId);
    AS_FOTO.alumnos = alumnos;

    // cargar asistencia de BD por fecha (si hay muchas clases, esto hace varias llamadas)
    for (const f of fechas) {
      const mapDia = await apiGetAsistenciaDia(cursoId, f);
      for (const a of alumnos) {
        const k = keyCell(a.inscripcion_id, f);
        const letra = mapDia.get(Number(a.inscripcion_id)) || "";
        AS_FOTO.values.set(k, letra);
      }
    }

    renderAsistenciaFotoModal();

    if (msg) msg.textContent = `Alumnos: ${alumnos.length} · Clases: ${fechas.length}`;

    new bootstrap.Modal(document.getElementById("modalAsistenciaFoto")).show();
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "Error cargando asistencia.";
    if (grid) grid.innerHTML = `<div class="text-danger">Error: ${esc(e.message || "desconocido")}</div>`;
    new bootstrap.Modal(document.getElementById("modalAsistenciaFoto")).show();
  }
};

// ===== guardar cambios =====
document.getElementById("btnGuardarAsFoto")?.addEventListener("click", async () => {
  const msg = document.getElementById("asFotoMsg");
  try {
    if (!AS_FOTO.cursoId) return;

    if (!AS_FOTO.dirty.size) {
      if (msg) msg.textContent = "No hay cambios para guardar.";
      return;
    }

    if (msg) msg.textContent = "Guardando…";

    // guardar 1 por 1 (seguro)
    for (const [k, letra] of AS_FOTO.dirty.entries()) {
      const [inscIdStr, fecha] = k.split("|");
      const inscId = Number(inscIdStr);
      const estado = letraToEstado(letra); // "Asistió" / "Faltó" / "Licencia" / ""

      // si queda vacío, puedes decidir: no guardar / o guardar como "Sin registro".
      // aquí: si vacío, NO guarda.
      if (!estado) continue;

      await apiUpsertAsistencia({
        curso_id: AS_FOTO.cursoId,
        inscripcion_id: inscId,
        fecha,
        estado
      });
    }

    AS_FOTO.dirty.clear();
    if (msg) msg.textContent = "✅ Guardado.";
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "Error guardando.";
    alert("Error: " + String(e.message || "desconocido"));
  }
});

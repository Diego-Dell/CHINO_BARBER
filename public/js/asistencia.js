// public/js/asistencia.js

async function fetchJSON(url, options = {}) {
  options.credentials = "include";
  const r = await fetch(url, options);

  if (r.status === 401) {
    window.location.href = "/login.html";
    return null;
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

// DOM
const aFecha = document.getElementById("aFecha");
const aCurso = document.getElementById("aCurso");
const aBuscar = document.getElementById("aBuscar");
const tablaAsistencia = document.getElementById("tablaAsistencia");
const msgAs = document.getElementById("msgAs");

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function setMsg(text, cls = "text-muted small") {
  if (!msgAs) return;
  msgAs.textContent = text || "";
  msgAs.className = cls;
}

// cache (lo que devuelve /api/asistencia)
let filasAsistencia = [];

// =========================
// CARGAR CURSOS
// =========================
async function cargarCursos() {
  try {
    const cursos = await fetchJSON("/api/cursos");
    const rows = Array.isArray(cursos) ? cursos : (Array.isArray(cursos?.data) ? cursos.data : []);

    aCurso.innerHTML =
      `<option value="">-- Seleccionar curso --</option>` +
      rows
        .map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`)
        .join("");
  } catch (err) {
    console.error(err);
    aCurso.innerHTML = `<option value="">Error al cargar cursos</option>`;
  }
}

// =========================
// CARGAR INSCRITOS + ASISTENCIA DEL DÍA
// GET /api/asistencia?curso_id=&fecha=
// =========================
async function cargarAsistencia() {
  const curso_id = Number(aCurso?.value);
  const fecha = (aFecha?.value || "").trim();
  const q = (aBuscar?.value || "").trim().toLowerCase();

  if (!curso_id) {
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Seleccioná un curso.</td></tr>`;
    return;
  }
  if (!fecha) {
    setMsg("Elegí una fecha.", "text-danger small");
    return;
  }

  try {
    setMsg("Cargando...", "text-muted small");

    const res = await fetchJSON(`/api/asistencia?curso_id=${curso_id}&fecha=${encodeURIComponent(fecha)}`);

    // soportar array directo o {ok,data}
    const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    filasAsistencia = data;

    // filtro buscar
    const filtrado = q
      ? data.filter((r) =>
          String(r.alumno_nombre || "").toLowerCase().includes(q) ||
          String(r.alumno_documento || "").toLowerCase().includes(q)
        )
      : data;

    renderTabla(filtrado);
    setMsg("");
  } catch (err) {
    console.error(err);
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Error al cargar asistencia.</td></tr>`;
    setMsg(err.message || "Error al cargar.", "text-danger small");
  }
}

// =========================
// RENDER
// =========================
function renderTabla(rows) {
  if (!rows.length) {
    tablaAsistencia.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Sin alumnos inscritos</td></tr>`;
    return;
  }

  tablaAsistencia.innerHTML = rows
    .map((it, i) => {
      // si ya había asistencia guardada, viene it.estado
      const estadoActual = (it.estado || "Asistio").trim();

      return `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.alumno_nombre || "")}</td>
        <td>${esc(it.alumno_documento || "")}</td>
        <td>
          <select class="form-select form-select-sm estado-asistencia"
                  data-inscripcion-id="${it.inscripcion_id}">
            <option value="Asistio" ${estadoActual === "Asistio" ? "selected" : ""}>Asistió</option>
            <option value="Falto" ${estadoActual === "Falto" ? "selected" : ""}>Faltó</option>
            <option value="Justificado" ${estadoActual === "Justificado" ? "selected" : ""}>Justificado</option>
          </select>
        </td>
      </tr>
    `;
    })
    .join("");
}

// =========================
// GUARDAR ASISTENCIA (BULK)
// =========================
async function guardarAsistencia() {
  const fecha = (aFecha?.value || "").trim();
  const curso_id = Number(aCurso?.value);

  if (!fecha || !curso_id) {
    setMsg("Elegí fecha y curso.", "text-danger small");
    return;
  }

  const registros = [...document.querySelectorAll(".estado-asistencia")]
    .map((sel) => ({
      inscripcion_id: Number(sel.dataset.inscripcionId),
      estado: String(sel.value || "").trim(), // Asistio/Falto/Justificado
      observacion: "",
    }))
    .filter((x) => Number.isFinite(x.inscripcion_id) && x.inscripcion_id > 0);

  if (!registros.length) {
    setMsg("No hay registros para guardar.", "text-danger small");
    return;
  }

  try {
    setMsg("Guardando...", "text-muted small");

    await fetchJSON("/api/asistencia/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, curso_id, registros }),
    });

    setMsg("Asistencia guardada.", "text-success small");
    setTimeout(() => setMsg(""), 1200);

    // recargar para mostrar lo guardado
    await cargarAsistencia();
  } catch (err) {
    console.error(err);
    setMsg(err.message || "Error al guardar.", "text-danger small");
  }
}

// =========================
// EVENTOS
// =========================
document.getElementById("btnCargarAlumnos")?.addEventListener("click", cargarAsistencia);
document.getElementById("btnGuardarAsistencia")?.addEventListener("click", guardarAsistencia);

aBuscar?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    cargarAsistencia();
  }
});

aCurso?.addEventListener("change", () => cargarAsistencia());
aFecha?.addEventListener("change", () => cargarAsistencia());

document.addEventListener("DOMContentLoaded", async () => {
  if (aFecha) aFecha.value = hoyISO();
  await cargarCursos();
});

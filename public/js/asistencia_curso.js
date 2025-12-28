// public/js/asistencia_curso.js

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

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
}

function diaCorto(iso) {
  const d = new Date(iso + "T00:00:00");
  const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  return dias[d.getDay()];
}

function labelEstado(estado) {
  if (estado === "Asistio") return "Asistió";
  if (estado === "Falto") return "Faltó";
  if (estado === "Justificado") return "Licencia";
  return "—";
}

function selectEstadoHTML(inscripcion_id, fecha, actual) {
  const v = String(actual || "");
  return `
    <select class="form-select form-select-sm celda-asistencia"
            data-inscripcion-id="${inscripcion_id}"
            data-fecha="${fecha}">
      <option value="" ${!v ? "selected" : ""}>—</option>
      <option value="Asistio" ${v === "Asistio" ? "selected" : ""}>Asistió</option>
      <option value="Falto" ${v === "Falto" ? "selected" : ""}>Faltó</option>
      <option value="Justificado" ${v === "Justificado" ? "selected" : ""}>Licencia</option>
    </select>
  `;
}

// DOM esperados (modal)
const modalAsCurso = document.getElementById("modalAsistenciaCurso");
const titleAsCurso = document.getElementById("titleAsCurso");
const infoAsCurso = document.getElementById("infoAsCurso");
const theadAsCurso = document.getElementById("theadAsCurso");
const tbodyAsCurso = document.getElementById("tbodyAsCurso");
const btnGuardarAsCurso = document.getElementById("btnGuardarAsCurso");

let ctxCurso = { curso_id: null, fechas: [] };

window.abrirAsistenciaCurso = async function (curso_id) {
  try {
    if (!modalAsCurso) return alert("Falta el modal #modalAsistenciaCurso");

    if (titleAsCurso) titleAsCurso.textContent = "Cargando...";
    if (infoAsCurso) infoAsCurso.textContent = "";
    if (theadAsCurso) theadAsCurso.innerHTML = "";
    if (tbodyAsCurso) tbodyAsCurso.innerHTML = `<tr><td class="text-muted">Cargando...</td></tr>`;

    const res = await fetchJSON(`/api/asistencia/curso/${curso_id}/resumen`);
    if (!res?.ok) throw new Error(res?.error || "Respuesta inválida");

    const curso = res.curso || {};
    const fechas = Array.isArray(res.fechas) ? res.fechas : [];
    const alumnos = Array.isArray(res.alumnos) ? res.alumnos : [];

    ctxCurso = { curso_id: Number(curso_id), fechas };

    const profe = curso.instructor_nombre ? ` — Instructor: ${curso.instructor_nombre}` : "";
    if (titleAsCurso) titleAsCurso.textContent = `Asistencia del curso — ${curso.nombre || ("Curso #" + curso_id)}${profe}`;

    if (infoAsCurso) {
      infoAsCurso.textContent = `Clases: ${curso.nro_clases || 0} | Cupo: ${curso.cupo || 0} | Días: ${curso.dias || ""}`;
    }

    // Header
    const ths = [
      `<th>#</th>`,
      `<th>Alumno</th>`,
      `<th>CI</th>`,
      ...fechas.map((f, idx) => `<th class="text-center">Clase ${idx + 1}<br><small class="text-muted">${diaCorto(f)} ${f}</small></th>`)
    ];
    theadAsCurso.innerHTML = `<tr>${ths.join("")}</tr>`;

    if (!alumnos.length) {
      tbodyAsCurso.innerHTML = `<tr><td colspan="${3 + fechas.length}" class="text-center text-muted">No hay alumnos inscritos.</td></tr>`;
      new bootstrap.Modal(modalAsCurso).show();
      return;
    }

    // Body
    tbodyAsCurso.innerHTML = alumnos.map((a, i) => {
      const asistencia = a.asistencia || {};
      const celdas = fechas.map((f) => {
        const actual = asistencia?.[f]?.estado || "";
        return `<td class="text-center">${selectEstadoHTML(a.inscripcion_id, f, actual)}</td>`;
      }).join("");

      return `
        <tr>
          <td>${i + 1}</td>
          <td class="fw-semibold">${esc(a.alumno_nombre || "")}</td>
          <td>${esc(a.alumno_documento || "")}</td>
          ${celdas}
        </tr>
      `;
    }).join("");

    new bootstrap.Modal(modalAsCurso).show();
  } catch (err) {
    console.error(err);
    alert("Error al cargar resumen: " + (err.message || "desconocido"));
  }
};

// Guardar (bulk) todo lo que el usuario cambió
btnGuardarAsCurso?.addEventListener("click", async () => {
  try {
    const { curso_id, fechas } = ctxCurso;
    if (!curso_id || !fechas?.length) return;

    // convertimos celdas -> registros agrupados por fecha
    // endpoint bulk actual guarda por UNA fecha; entonces guardamos 1 fecha a la vez
    const celdas = [...document.querySelectorAll(".celda-asistencia")];

    // fecha -> registros[]
    const byFecha = new Map();
    for (const sel of celdas) {
      const inscripcion_id = Number(sel.dataset.inscripcionId);
      const fecha = String(sel.dataset.fecha || "");
      const estado = String(sel.value || "").trim();

      if (!inscripcion_id || !fecha) continue;
      if (!estado) continue; // si queda en "—" no guardamos nada

      if (!byFecha.has(fecha)) byFecha.set(fecha, []);
      byFecha.get(fecha).push({ inscripcion_id, estado, observacion: "" });
    }

    // guardar cada fecha
    for (const [fecha, registros] of byFecha.entries()) {
      await fetchJSON("/api/asistencia/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, curso_id, registros })
      });
    }

    alert("✅ Asistencia del curso guardada.");
  } catch (err) {
    console.error(err);
    alert("Error al guardar: " + (err.message || "desconocido"));
  }
});

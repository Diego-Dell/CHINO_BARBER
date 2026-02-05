// public/js/cursos.js
(() => {
  "use strict";

  // ===============================
  // FETCH helper
  // ===============================
  async function fetchJSON(url, options = {}) {
    options.credentials = "include";

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);

    let r;
    try {
      r = await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }

    const ct = r.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");

    if (r.status === 401) {
      // si tu sistema usa login
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

  // ===============================
  // Utils
  // ===============================
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const toNum = (v, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  const bs = (n) => "Bs " + toNum(n, 0).toFixed(2);

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function parseISO(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function toISODate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function horarioTexto(c) {
    const dias = String(c.dias || "").trim();
    const h = String(c.hora_inicio || c.horaInicio || "").trim();
    const dur = c.duracion != null ? String(c.duracion) : "";
    const parts = [];
    if (dias) parts.push(dias);
    if (h) parts.push(h);
    if (dur) parts.push(`Dur ${dur}`);
    return parts.join(" · ");
  }

  // -------------------------------
  // Días -> weekdays
  // -------------------------------
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
    for (const [name, idx] of map) if (s.includes(name)) out.add(idx);
    return Array.from(out).sort((a, b) => a - b);
  }

  // Calcula fechas reales del curso (según inicio, días y nro_clases)
  function buildFechasClases({ fecha_inicio, dias, nro_clases }) {
    const start = parseISO(fecha_inicio);
    const n = toNum(nro_clases, 0);
    const weekdays = normDiasToWeekdays(dias);

    if (!start || n <= 0 || weekdays.length === 0) return [];

    const fechas = [];
    let cursor = new Date(start);

    while (fechas.length < n) {
      if (weekdays.includes(cursor.getDay())) fechas.push(toISODate(cursor));
      cursor.setDate(cursor.getDate() + 1);

      // guard-rail (evitar loop infinito)
      if ((cursor - start) / 86400000 > 1000) break;
    }
    return fechas;
  }

  // -------------------------------
  // Estado automático (REGLAS TUYAS)
  // -------------------------------
  function estadoAutoCurso(c) {
    const inscritos = toNum(c.inscritos, 0);
    const inicioISO = String(c.fecha_inicio || c.fechaInicio || "").slice(0, 10);
    const inicio = parseISO(inicioISO);
    const hoy = parseISO(hoyISO());

    // si no hay fecha válida, lo dejamos Programado
    if (!inicio || !hoy) return "Programado";

    // si ya llegó el día de inicio (o pasó) y NO hay alumnos => Cancelado
    if (hoy >= inicio && inscritos === 0) return "Cancelado";

    // aún no inicia => Programado
    if (hoy < inicio) return "Programado";

    // ya inició: calculamos última clase
    const fechas = buildFechasClases({
      fecha_inicio: inicioISO,
      dias: c.dias || "",
      nro_clases: c.nro_clases || c.nroClases || 0,
    });

    if (!fechas.length) {
      // si no puedo calcular fechas pero ya inició, lo tomo como En curso (salvo cancelado ya cubierto)
      return "En curso";
    }

    const ultima = parseISO(fechas[fechas.length - 1]);

    // si ya pasó la última clase => Finalizado
    if (ultima && hoy > ultima) return "Finalizado";

    // si no pasó la última => En curso
    return "En curso";
  }

  function badgeEstadoCurso(estado) {
    const e = String(estado || "").toLowerCase();
    if (e === "en curso") return "bg-primary";
    if (e === "finalizado") return "bg-secondary";
    if (e === "cancelado") return "bg-danger";
    return "bg-warning text-dark"; // Programado
  }

  function badgeEstadoInscripcion(estado) {
    const st = String(estado || "");
    const cls = st === "Activa" ? "bg-success" : "bg-secondary";
    return `<span class="badge ${cls}">${esc(st)}</span>`;
  }

  // ===============================
  // DOM
  // ===============================
  const tbody = document.querySelector("#tablaCursos tbody");
  const cBuscar = document.getElementById("cBuscar");
  const cEstado = document.getElementById("cEstado");
  const cResumen = document.getElementById("cResumen");
  const btnFiltrarCursos = document.getElementById("btnFiltrarCursos");
  const btnRefrescarCursos = document.getElementById("btnRefrescarCursos");

  // crear
  const formCurso = document.getElementById("formCurso");
  const msgCurso = document.getElementById("msgCurso");

  const cursoNombre = document.getElementById("cursoNombre");
  const cursoInstructorId = document.getElementById("cursoInstructorId");
  const cursoFechaInicio = document.getElementById("cursoFechaInicio");
  const cursoNroClases = document.getElementById("cursoNroClases");
  const cursoCupo = document.getElementById("cursoCupo");
  const cursoDias = document.getElementById("cursoDias");
  const cursoHoraInicio = document.getElementById("cursoHoraInicio");
  const cursoDuracion = document.getElementById("cursoDuracion");
  const cursoPrecio = document.getElementById("cursoPrecio");
  const cursoEstado = document.getElementById("cursoEstado"); // lo vamos a bloquear (si existe)

  // editar
  const formCursoEdit = document.getElementById("formCursoEdit");
  const msgEditCurso = document.getElementById("msgEditCurso");

  const cEditId = document.getElementById("cEditId");
  const cEditNombre = document.getElementById("cEditNombre");
  const cEditInstructorId = document.getElementById("cEditInstructorId");
  const cEditFechaInicio = document.getElementById("cEditFechaInicio");
  const cEditNroClases = document.getElementById("cEditNroClases");
  const cEditCupo = document.getElementById("cEditCupo");
  const cEditDias = document.getElementById("cEditDias");
  const cEditHoraInicio = document.getElementById("cEditHoraInicio");
  const cEditDuracion = document.getElementById("cEditDuracion");
  const cEditPrecio = document.getElementById("cEditPrecio");
  const cEditEstado = document.getElementById("cEditEstado"); // lo vamos a bloquear (si existe)

  // modal ver alumnos
  const modalVerAlumnosEl = document.getElementById("modalVerAlumnos");
  const tituloVerAlumnosEl = document.getElementById("tituloVerAlumnos");
  const tablaVerAlumnosEl = document.getElementById("tablaVerAlumnos");
  const msgVerAlumnosEl = document.getElementById("msgVerAlumnos");

  // asistencia visual (modal)
  const modalAsisEl = document.getElementById("modalAsistenciaVisual");
  const tituloAsVisual = document.getElementById("tituloAsVisual");
  const subAsVisual = document.getElementById("subAsVisual");
  const contAsVisual = document.getElementById("contenedorAsVisual");

  // ===============================
  // Cache
  // ===============================
  let cursosCache = [];
  let instructoresCache = [];

  // Exponer cache para otros módulos si lo necesitan
  window.cursosCache = cursosCache;

  // ===============================
  // Instructores
  // ===============================
  function fillSelectInstructores(selectEl, selectedId = "") {
    if (!selectEl) return;
    const sel = String(selectedId ?? "");

    selectEl.innerHTML =
      `<option value="">-- Seleccionar instructor --</option>` +
      instructoresCache
        .map((i) => {
          const id = String(i.id);
          const nombre = i.nombre || "";
          return `<option value="${esc(id)}" ${id === sel ? "selected" : ""}>${esc(nombre)}</option>`;
        })
        .join("");
  }

  async function cargarInstructores() {
    const data = await fetchJSON("/api/instructores");
    instructoresCache = Array.isArray(data) ? data : [];
    fillSelectInstructores(cursoInstructorId, "");
    fillSelectInstructores(cEditInstructorId, "");
  }

  // ===============================
  // Render tabla cursos
  // ===============================
  function renderCursos(rows) {
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No hay cursos.</td></tr>`;
      if (cResumen) cResumen.textContent = "0 cursos";
      return;
    }

    tbody.innerHTML = rows
      .map((c) => {
        const instructor = c.instructor_nombre || c.instructor || "";
        const inscritos = toNum(c.inscritos, 0);
        const cupo = toNum(c.cupo, 0);
        const insText = `${inscritos}/${cupo || 0}`;

        const estadoAuto = estadoAutoCurso(c);

        return `
          <tr>
            <td>${c.id}</td>
            <td class="fw-semibold">${esc(c.nombre)}</td>
            <td>${esc(instructor)}</td>
            <td>${esc(horarioTexto(c))}</td>
            <td class="text-center">${toNum(c.nro_clases, 0)}</td>
            <td class="text-center">${esc(insText)}</td>
            <td class="text-end">${bs(c.precio)}</td>
            <td>
              <span class="badge ${badgeEstadoCurso(estadoAuto)}">${esc(estadoAuto)}</span>
            </td>
            <td>
              <div class="d-flex gap-2">
                <button class="btn btn-outline-primary btn-sm" onclick="abrirEditarCurso(${c.id})">Editar</button>
                <button class="btn btn-outline-secondary btn-sm" onclick="verAlumnosCurso(${c.id})">Ver alumnos</button>
  <button class="btn btn-outline-dark btn-sm"
  onclick="verAsistenciaVisual(${c.id}, '${esc(c.nombre)}')">
  Ver asistencia
</button>

              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    if (cResumen) cResumen.textContent = `${rows.length} curso${rows.length !== 1 ? "s" : ""}`;
  }

  // ===============================
  // Cargar cursos (y filtrar por estado AUTO)
  // ===============================
  async function cargarCursos() {
    // Traemos todos (o con q) desde backend.
    // El filtro por estado lo haremos con el estado automático calculado.
    const params = new URLSearchParams();
    const q = (cBuscar?.value || "").trim();

    if (q) params.append("q", q);

    let url = "/api/cursos";
    const qs = params.toString();
    if (qs) url += "?" + qs;

    const data = await fetchJSON(url);
    cursosCache = Array.isArray(data) ? data : [];
    window.cursosCache = cursosCache;

    // Filtro por estado (usa cálculo automático)
    const filtroEstado = String(cEstado?.value || "").trim();
    let rows = [...cursosCache];

    if (filtroEstado) {
      // “Activo” ya no existe, si el select todavía lo tiene, lo tratamos como En curso
      const target = filtroEstado === "Activo" ? "En curso" : filtroEstado;
      rows = rows.filter((c) => estadoAutoCurso(c) === target);
    }

    renderCursos(rows);
  }

  // ===============================
  // Abrir modal editar
  // ===============================
  window.abrirEditarCurso = function (id) {
    const c = cursosCache.find((x) => Number(x.id) === Number(id));
    if (!c) return alert("Curso no encontrado");

    if (cEditId) cEditId.value = c.id ?? "";
    if (cEditNombre) cEditNombre.value = c.nombre ?? "";

    fillSelectInstructores(cEditInstructorId, c.instructor_id ?? "");

    if (cEditFechaInicio) cEditFechaInicio.value = String(c.fecha_inicio || "").slice(0, 10);
    if (cEditNroClases) cEditNroClases.value = toNum(c.nro_clases, 1);
    if (cEditCupo) cEditCupo.value = toNum(c.cupo, 1);

    if (cEditDias) cEditDias.value = c.dias ?? "";
    if (cEditHoraInicio) cEditHoraInicio.value = String(c.hora_inicio || "").slice(0, 5);
    if (cEditDuracion) cEditDuracion.value = toNum(c.duracion, 1);

    if (cEditPrecio) cEditPrecio.value = toNum(c.precio, 0);

    // Estado: solo mostrar automático y BLOQUEADO
    const estAuto = estadoAutoCurso(c);
    if (cEditEstado) {
      // si tu HTML todavía tiene select, lo bloqueamos
      cEditEstado.innerHTML = `<option value="${esc(estAuto)}">${esc(estAuto)}</option>`;
      cEditEstado.value = estAuto;
      cEditEstado.disabled = true;
    }

    if (msgEditCurso) {
      msgEditCurso.textContent = "";
      msgEditCurso.className = "text-muted small";
    }

    new bootstrap.Modal(document.getElementById("modalCursoEdit")).show();
  };

  // ===============================
  // Crear curso (SIN enviar estado)
  // ===============================
  formCurso?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      nombre: (cursoNombre?.value || "").trim(),
      instructor_id: toNum(cursoInstructorId?.value, 0),
      fecha_inicio: (cursoFechaInicio?.value || "").trim() || hoyISO(),
      nro_clases: toNum(cursoNroClases?.value, 0),
      cupo: toNum(cursoCupo?.value, 0),
      dias: (cursoDias?.value || "").trim(),
      hora_inicio: (cursoHoraInicio?.value || "").trim(),
      duracion: toNum(cursoDuracion?.value, 0),
      precio: toNum(cursoPrecio?.value, 0),
      // ✅ NO enviar estado (automático)
    };

    // Validaciones
    if (!payload.nombre) {
      msgCurso.textContent = "El nombre del curso es obligatorio.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.instructor_id) {
      msgCurso.textContent = "Selecciona un instructor.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.nro_clases || payload.nro_clases < 1) {
      msgCurso.textContent = "Número de clases inválido.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.cupo || payload.cupo < 1) {
      msgCurso.textContent = "Cupo inválido.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.dias) {
      msgCurso.textContent = "Días es obligatorio.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.hora_inicio) {
      msgCurso.textContent = "Hora de inicio es obligatoria.";
      msgCurso.className = "text-danger small";
      return;
    }
    if (!payload.duracion || payload.duracion < 1) {
      msgCurso.textContent = "Duración inválida.";
      msgCurso.className = "text-danger small";
      return;
    }

    try {
      msgCurso.textContent = "Guardando...";
      msgCurso.className = "text-muted small";

      await fetchJSON("/api/cursos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      msgCurso.textContent = "Curso creado.";
      msgCurso.className = "text-success small";

      formCurso.reset();

      // Estado: bloquear si existe el select en el HTML
      if (cursoEstado) {
        cursoEstado.innerHTML = `<option value="Automático">Automático</option>`;
        cursoEstado.value = "Automático";
        cursoEstado.disabled = true;
      }

      fillSelectInstructores(cursoInstructorId, "");

      await cargarCursos();

      setTimeout(() => {
        bootstrap.Modal.getInstance(document.getElementById("modalCurso"))?.hide();
        msgCurso.textContent = "";
      }, 700);
    } catch (err) {
      console.error(err);
      msgCurso.textContent = "Error al guardar: " + String(err.message || "desconocido");
      msgCurso.className = "text-danger small";
    }
  });

  // ===============================
  // Guardar edición (SIN enviar estado)
  // ===============================
  formCursoEdit?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = toNum(cEditId?.value, 0);

    const payload = {
      nombre: (cEditNombre?.value || "").trim(),
      instructor_id: toNum(cEditInstructorId?.value, 0),
      fecha_inicio: (cEditFechaInicio?.value || "").trim(),
      nro_clases: toNum(cEditNroClases?.value, 0),
      cupo: toNum(cEditCupo?.value, 0),
      dias: (cEditDias?.value || "").trim(),
      hora_inicio: (cEditHoraInicio?.value || "").trim(),
      duracion: toNum(cEditDuracion?.value, 0),
      precio: toNum(cEditPrecio?.value, 0),
      // ✅ NO enviar estado (automático)
    };

    if (!id) {
      msgEditCurso.textContent = "ID inválido.";
      msgEditCurso.className = "text-danger small";
      return;
    }
    if (!payload.nombre) {
      msgEditCurso.textContent = "El nombre es obligatorio.";
      msgEditCurso.className = "text-danger small";
      return;
    }
    if (!payload.instructor_id) {
      msgEditCurso.textContent = "Selecciona un instructor.";
      msgEditCurso.className = "text-danger small";
      return;
    }
    if (!payload.nro_clases || payload.nro_clases < 1) {
      msgEditCurso.textContent = "Número de clases inválido.";
      msgEditCurso.className = "text-danger small";
      return;
    }
    if (!payload.cupo || payload.cupo < 1) {
      msgEditCurso.textContent = "Cupo inválido.";
      msgEditCurso.className = "text-danger small";
      return;
    }

    try {
      msgEditCurso.textContent = "Guardando...";
      msgEditCurso.className = "text-muted small";

      await fetchJSON(`/api/cursos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      msgEditCurso.textContent = "Actualizado.";
      msgEditCurso.className = "text-success small";

      await cargarCursos();

      setTimeout(() => {
        bootstrap.Modal.getInstance(document.getElementById("modalCursoEdit"))?.hide();
        msgEditCurso.textContent = "";
      }, 650);
    } catch (err) {
      console.error(err);
      msgEditCurso.textContent = "Error al guardar: " + String(err.message || "desconocido");
      msgEditCurso.className = "text-danger small";
    }
  });

  // ===============================
  // Ver alumnos (modal)
  // ===============================
  window.verAlumnosCurso = async function (cursoId) {
    const c = cursosCache.find((x) => Number(x.id) === Number(cursoId));
    const cursoNombre = c?.nombre || `Curso #${cursoId}`;
    const profe = c?.instructor_nombre ? ` | Instructor: ${c.instructor_nombre}` : "";

    try {
      if (!modalVerAlumnosEl) return;

      if (tituloVerAlumnosEl) tituloVerAlumnosEl.textContent = `Alumnos inscritos — ${cursoNombre}${profe}`;

      if (msgVerAlumnosEl) {
        msgVerAlumnosEl.textContent = "Cargando...";
        msgVerAlumnosEl.className = "text-muted small mb-2";
      }
      if (tablaVerAlumnosEl) {
        tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Cargando...</td></tr>`;
      }

      const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
      const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
      const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];

      if (!data.length) {
        tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay alumnos inscritos.</td></tr>`;
        if (msgVerAlumnosEl) msgVerAlumnosEl.textContent = "";
        new bootstrap.Modal(modalVerAlumnosEl).show();
        return;
      }

      if (msgVerAlumnosEl) {
        msgVerAlumnosEl.textContent = `${data.length} alumno${data.length !== 1 ? "s" : ""} inscrito${
          data.length !== 1 ? "s" : ""
        }`;
        msgVerAlumnosEl.className = "text-muted small mb-2";
      }

      tablaVerAlumnosEl.innerHTML = data
        .map(
          (r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="fw-semibold">${esc(r.alumno_nombre || r.nombre || "")}</td>
            <td>${esc(r.alumno_documento || r.documento || "")}</td>
            <td>${esc(r.alumno_telefono || r.telefono || "")}</td>
            <td>${esc(r.alumno_email ?? "")}</td>
            <td>${badgeEstadoInscripcion(r.estado_inscripcion ?? r.estado ?? "")}</td>
          </tr>
        `
        )
        .join("");

      new bootstrap.Modal(modalVerAlumnosEl).show();
    } catch (err) {
      console.error(err);
      if (msgVerAlumnosEl) {
        msgVerAlumnosEl.textContent = `Error: ${err.message}`;
        msgVerAlumnosEl.className = "text-danger small mb-2";
      }
      if (tablaVerAlumnosEl) {
        tablaVerAlumnosEl.innerHTML = `<tr><td colspan="6" class="text-center text-danger">No se pudo cargar.</td></tr>`;
      }
      new bootstrap.Modal(modalVerAlumnosEl).show();
    }
  };

  // ===============================
  // Asistencia visual (usa tu endpoint /api/asistencia/curso/:id/resumen)
  // ===============================
  function diaCorto(iso) {
    const d = new Date(iso + "T00:00:00");
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    return dias[d.getDay()];
  }
  function ddmm(iso) {
    const [y, m, d] = String(iso).split("-");
    return `${d}-${m}`;
  }
  function colorEstado(estado) {
    const e = String(estado || "").toLowerCase();
    if (e.includes("asist")) return "#21b14b";
    if (e.includes("falt")) return "#e9151b";
    if (e.includes("lic") || e.includes("justif")) return "#00a7e6";
    return "#e9ecef";
  }
  function labelEstadoCorto(estado) {
    const e = String(estado || "").toLowerCase();
    if (e.includes("asist")) return "Asistió";
    if (e.includes("falt")) return "Faltó";
    if (e.includes("lic") || e.includes("justif")) return "Licencia";
    return "Sin marcar";
  }

// ===============================
// VER ASISTENCIA (SOLO LECTURA) ✅
// NO EDITA / NO GUARDA
// ===============================

// ---- helpers (si ya los tienes, NO dupliques; si no están, déjalos) ----
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
  const fi = String(fecha_inicio || "").slice(0, 10);
  const start = parseISO(fi);
  const n = Number(nro_clases || 0);
  const weekdays = normDiasToWeekdays(dias);

  if (!start || !n || n <= 0 || weekdays.length === 0) return [];

  const fechas = [];
  let cursor = new Date(start);

  // seguridad para evitar bucle infinito
  let guard = 0;
  while (fechas.length < n && guard < 900) {
    if (weekdays.includes(cursor.getDay())) fechas.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return fechas;
}

function estadoToLetra(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("asist")) return "A";
  if (e.includes("falt")) return "F";
  if (e.includes("lic") || e.includes("justif")) return "L";
  return "";
}

function colorEstado(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("asist")) return "#16a34a";  // verde
  if (e.includes("falt")) return "#dc2626";   // rojo
  if (e.includes("lic")) return "#0284c7";    // azul
  return "#e9ecef";                           // gris
}

function diaCorto(iso) {
  const d = new Date(iso + "T00:00:00");
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  return dias[d.getDay()];
}

function ddmm(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}-${m}`;
}

// --- usa tus endpoints EXISTENTES ---
// 1) inscritos
async function apiGetInscritosLectura(cursoId) {
  const p = new URLSearchParams({ curso_id: String(cursoId), estado: "Activa" });
  const res = await fetchJSON(`/api/inscripciones?${p.toString()}`);
  const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  return arr.map(r => ({
    inscripcion_id: r.inscripcion_id ?? r.id,
    alumno_nombre: r.alumno_nombre ?? r.nombre ?? "",
    alumno_documento: r.alumno_documento ?? r.documento ?? "",
  })).filter(x => x.inscripcion_id);
}

// 2) asistencia por fecha (esta ruta sí suele existir en tu sistema)
async function apiGetAsistenciaDiaLectura(cursoId, fechaISO) {
  const p = new URLSearchParams({ curso_id: String(cursoId), fecha: String(fechaISO) });
  const res = await fetchJSON(`/api/asistencia?${p.toString()}`);
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

  // Map inscripcion_id -> letra A/F/L
  const m = new Map();
  for (const r of rows) {
    const inscId = r.inscripcion_id ?? r.inscripcionId ?? r.id;
    if (!inscId) continue;
    m.set(Number(inscId), estadoToLetra(r.estado || ""));
  }
  return m;
}

// ===============================
// FUNCIÓN GLOBAL que llama el botón
// ===============================
window.verAsistenciaVisual = async function (cursoId, cursoNombre = "") {
  const modalEl = document.getElementById("modalAsistenciaVisual");
  const titulo = document.getElementById("tituloAsVisual");
  const sub = document.getElementById("subAsVisual");
  const cont = document.getElementById("contenedorAsVisual");

  if (!modalEl || !cont) {
    alert("Falta el modalAsistenciaVisual o #contenedorAsVisual en cursos.html");
    return;
  }

  try {
    if (titulo) titulo.textContent = "Cargando...";
    if (sub) sub.textContent = "—";
    cont.innerHTML = `<div class="text-muted">Cargando...</div>`;

    // ✅ ESTE endpoint debe existir (es el que ya te funciona):
    // GET /api/asistencia/curso/:id/resumen
    const res = await fetchJSON(`/api/asistencia/curso/${cursoId}/resumen`);
    if (!res?.ok) throw new Error(res?.error || "API route not found");

    const curso = res.curso || {};
    const fechas = Array.isArray(res.fechas) ? res.fechas : [];
    const alumnos = Array.isArray(res.alumnos) ? res.alumnos : [];

    const profe = curso.instructor_nombre ? ` | ${curso.instructor_nombre}` : "";
    if (titulo) titulo.textContent = `ASISTENCIA — ${cursoNombre || curso.nombre || ("Curso #" + cursoId)}${profe}`;

    const inicio = (curso.fecha_inicio || "").slice(0, 10) || "—";
    const dias = curso.dias || "—";
    if (sub) sub.textContent = `Inicio: ${inicio} · Días: ${dias} · Clases: ${fechas.length}`;

    // Helpers UI
    const ddmm = (iso) => {
      const [y, m, d] = String(iso).slice(0, 10).split("-");
      return `${m}-${d}`;
    };

    const estadoToDot = (estado) => {
      const e = String(estado || "").toLowerCase();
      if (e.includes("asist")) return "ok";
      if (e.includes("falt")) return "bad";
      if (e.includes("lic") || e.includes("justif")) return "lic";
      return "emp";
    };

    if (!fechas.length) {
      cont.innerHTML = `<div class="text-muted">Este curso no tiene clases generadas.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    if (!alumnos.length) {
      cont.innerHTML = `<div class="text-muted">No hay alumnos inscritos.</div>`;
      new bootstrap.Modal(modalEl).show();
      return;
    }

    // Grid dinámico: 2 columnas fijas (Alumno/CI) + N fechas
    // Para parecerse a la imagen 2: primeras dos columnas “anchas”
    const cols = `220px 140px repeat(${fechas.length}, 70px)`;

    // Header
    let html = `
      <div class="asv-card">
        <div class="asv-topline">
          <div>
            <div class="asv-title">Asistencia del curso</div>
            <div class="asv-sub">
              Curso: ${esc(cursoNombre || curso.nombre || "—")}
              · Instructor: ${esc(curso.instructor_nombre || "—")}
              · Inicio: ${esc(inicio)}
              · Días: ${esc(dias)}
              · Clases: ${fechas.length}
            </div>
          </div>

          <div class="asv-badges">
            <span class="asv-badge">👥 ${alumnos.length} alumnos</span>
            <span class="asv-badge">📅 ${fechas.length} clases</span>
          </div>
        </div>

        <div class="asv-gridwrap">
          <div class="asv-grid" style="grid-template-columns:${cols}">
            <div class="asv-hdr">Alumno</div>
            <div class="asv-hdr">CI</div>
            ${fechas.map(f => `<div class="asv-hdr date">${esc(ddmm(f))}</div>`).join("")}
    `;

    // Rows
    for (const a of alumnos) {
      const nombre = a.alumno_nombre || a.nombre || "—";
      const doc = a.alumno_documento || a.documento || "—";
      const mapAs = a.asistencia || {}; // { "YYYY-MM-DD": {estado} }

      html += `
        <div class="asv-cellbox">
          <div class="asv-name">${esc(nombre)}</div>
        </div>
        <div class="asv-cellbox">
          <div class="asv-ci">${esc(doc)}</div>
        </div>
      `;

      for (const f of fechas) {
        const estado = mapAs?.[f]?.estado || "";
        const dot = estadoToDot(estado);
        const tip = `${f} — ${estado || "Sin marcar"}`;
        html += `
          <div class="asv-cell" title="${esc(tip)}">
            <div class="asv-dot ${dot}"></div>
          </div>
        `;
      }
    }

    html += `
          </div>
        </div>
      </div>
    `;

    cont.innerHTML = html;
    new bootstrap.Modal(modalEl).show();
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div class="text-danger">Error: ${esc(err.message || "desconocido")}</div>`;
    new bootstrap.Modal(modalEl).show();
  }
};



  // ===============================
  // Eventos filtros + refrescar
  // ===============================
  btnFiltrarCursos?.addEventListener("click", cargarCursos);
  btnRefrescarCursos?.addEventListener("click", cargarCursos);

  cBuscar?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      cargarCursos();
    }
  });

  // ===============================
  // Init
  // ===============================
  document.addEventListener("DOMContentLoaded", async () => {
    // Bloquear estado (si el HTML todavía lo tiene como select)
    if (cursoEstado) {
      cursoEstado.innerHTML = `<option value="Automático">Automático</option>`;
      cursoEstado.value = "Automático";
      cursoEstado.disabled = true;
    }
    if (cEditEstado) {
      cEditEstado.innerHTML = `<option value="Automático">Automático</option>`;
      cEditEstado.value = "Automático";
      cEditEstado.disabled = true;
    }

    // Si el filtro aún tiene "Activo", no pasa nada (solo no mostrará cursos)
    try {
      await cargarInstructores();
    } catch (e) {
      console.error("No se pudo cargar instructores:", e);
    }

    try {
      await cargarCursos();
    } catch (e) {
      console.error("No se pudo cargar cursos:", e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">Error al cargar cursos.</td></tr>`;
      if (cResumen) cResumen.textContent = "0 cursos";
    }
  });
})();



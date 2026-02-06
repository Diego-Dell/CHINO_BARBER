// public/js/index.dashboard.js
// Solo para index.html (Dashboard). No toca otras páginas.

(() => {
  "use strict";

  async function fetchJSON(url, options = {}) {
    const r = await fetch(url, { credentials: "include", ...options });
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
    String(s ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));

  const $ = (id) => document.getElementById(id);

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }

  // Normaliza strings tipo estado: " En   curso " => "en curso"
  function norm(s) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  // -------- KPIs --------
  async function cargarKpis() {
    // KPIs base desde endpoint actual
    const dash = await fetchJSON("/api/reportes/dashboard");
    const d = dash?.data || dash || {};

    setText("kpiIngresosMes", bs(d.ingresos_mes_actual));
    setText("kpiPagos", String(d.total_pagos_registrados ?? d.total_pagos ?? 0));

    // Alumnos: dividimos activos/inactivos desde /api/alumnos
    const alumnosRaw = await fetchJSON("/api/alumnos").catch(() => []);
    const alumnos =
      Array.isArray(alumnosRaw) ? alumnosRaw :
      Array.isArray(alumnosRaw?.data) ? alumnosRaw.data :
      [];

    const activos = alumnos.filter((a) => norm(a.estado) === "activo").length;
    const inactivos = alumnos.filter((a) => norm(a.estado) === "inactivo").length;

    setText("kpiAlumnosActivos", String(activos));
    setText("kpiAlumnosInactivos", String(inactivos));
    setText("kpiAlumnos", String(activos + inactivos));
  }

  // -------- Panel tipo agenda --------
  function hoyISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function cargarPanelCursos() {
    const wrap = $("panelCursos");
    const sub = $("panelCursosSub");
    if (!wrap) return;

    wrap.innerHTML = `<div class="text-muted">Cargando…</div>`;
    if (sub) sub.textContent = `Cursos en estado "En curso" · ${hoyISO()}`;

    const cursosResp = await fetchJSON("/api/cursos").catch(() => null);

    // ✅ soporta /api/cursos -> []  ó  {ok:true, data:[]}
    const cursos =
      Array.isArray(cursosResp) ? cursosResp :
      Array.isArray(cursosResp?.data) ? cursosResp.data :
      [];

    // ✅ filtro tolerante del estado
// Día actual abreviado (lun, mar, mie, jue, vie, sab, dom)
function hoyAbrev() {
  const map = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  return map[new Date().getDay()];
}

// Convierte "Mar y Jue" → ["mar","jue"]
function parseDias(diasTexto) {
  if (!diasTexto) return [];
  return diasTexto
    .toLowerCase()
    .replace(/á/g, "a")
    .replace(/é/g, "e")
    .replace(/í/g, "i")
    .replace(/ó/g, "o")
    .replace(/ú/g, "u")
    .replace(/[^a-z]/g, " ")
    .split(" ")
    .map((d) => {
      if (d.startsWith("lun")) return "lun";
      if (d.startsWith("mar")) return "mar";
      if (d.startsWith("mie")) return "mie";
      if (d.startsWith("jue")) return "jue";
      if (d.startsWith("vie")) return "vie";
      if (d.startsWith("sab")) return "sab";
      if (d.startsWith("dom")) return "dom";
      return null;
    })
    .filter(Boolean);
}

const hoy = hoyAbrev();

const cursosEnCurso = cursos.filter((c) => {
  const estadoOk = norm(c?.estado) === "en curso";
  if (!estadoOk) return false;

  const diasCurso = parseDias(c?.dias);
  if (!diasCurso.length) return false;

  return diasCurso.includes(hoy);
});


    if (!cursosEnCurso.length) {
      // Para ayudarte a detectar rápido el valor real del estado (sin romper UI)
      const estadosUnicos = [...new Set(cursos.map((c) => norm(c?.estado)).filter(Boolean))].slice(0, 8);
      wrap.innerHTML = `
        <div class="text-muted">
          No hay cursos "En curso" para mostrar.
          ${estadosUnicos.length ? `<div class="small mt-2">Estados detectados: <b>${esc(estadosUnicos.join(", "))}</b></div>` : ""}
        </div>
      `;
      return;
    }

    // Traemos alumnos por curso (inscripciones activas)
    const items = [];
    for (const c of cursosEnCurso) {
      const resp = await fetchJSON(`/api/inscripciones/por-curso/${encodeURIComponent(c.id)}`).catch(() => null);
      const rows =
        Array.isArray(resp) ? resp :
        Array.isArray(resp?.data) ? resp.data :
        [];

      items.push({
        id: c.id,
        nombre: c.nombre,
        horario: c.horario_por_dia || "—",
        dias: c.dias || "",
        alumnos: rows,
      });
    }

function colorFromId(id){
  // paleta agradable (no toca estilos globales)
  const palette = [
    "rgba(13,110,253,.95)",  // azul
    "rgba(25,135,84,.92)",   // verde
    "rgba(220,53,69,.88)",   // rojo
    "rgba(255,193,7,.92)",   // amarillo
    "rgba(111,66,193,.90)",  // morado
    "rgba(13,202,240,.88)",  // celeste
    "rgba(253,126,20,.88)",  // naranja
  ];
  const n = Number(String(id).replace(/\D/g,"")) || 0;
  return palette[n % palette.length];
}

function initials(name){
  const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  const a = parts[0][0] || "";
  const b = (parts[1]?.[0]) || "";
  return (a + b).toUpperCase();
}

wrap.innerHTML = items.map((c) => {
  const first = c.alumnos.slice(0, 14);
  const more = Math.max(0, c.alumnos.length - first.length);
  const courseColor = colorFromId(c.id);

  return `
    <div class="schedule-col" style="--courseColor:${courseColor}">
      <div class="schedule-card">
        <div class="schedule-top">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <span class="course-dot"></span>
            <div>
              <div class="schedule-title">${esc(c.nombre || "Curso")}</div>
              <div class="schedule-sub">${esc(c.horario)}${c.dias ? " · " + esc(c.dias) : ""}</div>

              <div class="schedule-meta">
                <span class="meta-pill">👥 ${c.alumnos.length} alumno${c.alumnos.length === 1 ? "" : "s"}</span>
                <span class="meta-pill">📅 Hoy</span>
              </div>
            </div>
          </div>

          <span class="badge text-bg-primary">En curso</span>
        </div>

        <div class="schedule-body">
          <div class="text-muted small">Alumnos que cursan hoy</div>
          <div class="students-grid">
            ${first.map((a) => {
              const nm = a.alumno_nombre || a.nombre || "—";
              return `
                <span class="student-chip">
                  <span class="avatar">${esc(initials(nm))}</span>
                  ${esc(nm)}
                </span>
              `;
            }).join("")}
            ${more ? `<span class="student-chip more">+${more} más</span>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}).join("");

  }

  // -------- init --------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!$("kpiIngresosMes")) return;

    try {
      await cargarKpis();
    } catch (e) {
      console.error("Dashboard KPIs:", e);
    }

    if ($("panelCursos")) {
      try {
        await cargarPanelCursos();
        $("btnRefrescarPanel")?.addEventListener("click", cargarPanelCursos);
      } catch (e) {
        console.error("Panel cursos:", e);
        $("panelCursos").innerHTML = `<div class="text-danger small">Error cargando panel.</div>`;
      }
    }
  });
})();

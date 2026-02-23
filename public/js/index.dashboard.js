// public/js/index.dashboard.js  —  Dashboard V2
// Módulo autoejecutable. Sólo para index.html.

(() => {
  "use strict";

  // ── Utilidades ─────────────────────────────────────────────────────────────

  async function fetchJSON(url) {
    const r = await fetch(url, { credentials: "include" });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const b = ct.includes("json") ? await r.json() : await r.text(); msg = b?.error || b?.message || b || msg; } catch (_) {}
      throw new Error(msg);
    }
    return ct.includes("application/json") ? r.json() : null;
  }

  const bs  = (n) => "Bs " + Number(n || 0).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $   = (id) => document.getElementById(id);

  function set(id, v) { const el = $(id); if (el) el.textContent = v; }
  function html(id, h) { const el = $(id); if (el) el.innerHTML = h; }

  function norm(s) { return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "); }

  function mesLabel(d) {
    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return `${meses[d.getMonth()]} ${d.getFullYear()}`;
  }

  function fechaCorta(iso) {
    if (!iso) return "—";
    const d = new Date(iso.replace(" ", "T").slice(0, 10) + "T00:00:00");
    return isNaN(d) ? iso.slice(0, 10) : d.toLocaleDateString("es-BO", { day: "2-digit", month: "short" });
  }

  function stBadge(estado) {
    const e = norm(estado);
    if (e === "pagado")   return `<span class="st-badge st-pagado">Pagado</span>`;
    if (e === "pendiente") return `<span class="st-badge st-pendiente">Pendiente</span>`;
    if (e === "activa" || e === "activo") return `<span class="st-badge st-activa">${esc(estado)}</span>`;
    return `<span class="st-badge st-default">${esc(estado || "—")}</span>`;
  }

  // ── Tabs de actividad ────────────────────────────────────────────────────────

  function initTabs() {
    document.querySelectorAll(".act-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".act-tab").forEach(b => {
          b.classList.remove("btn-primary");
          b.classList.add("btn-outline-primary");
        });
        btn.classList.remove("btn-outline-primary");
        btn.classList.add("btn-primary");
        document.querySelectorAll(".act-panel").forEach(p => p.classList.add("d-none"));
        $(`act${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`)?.classList.remove("d-none");
      });
    });
  }

  // ── Render: actividad reciente ────────────────────────────────────────────

  function renderPagos(pagos) {
    if (!pagos?.length) return `<div class="empty-state">Sin pagos registrados este mes</div>`;
    return pagos.map(p => `
      <div class="activity-item">
        <div class="act-icon" style="background:rgba(13,110,253,.08);border-color:rgba(13,110,253,.15);">💵</div>
        <div class="flex-grow-1 min-w-0">
          <div class="act-title">${esc(p.alumno_nombre || "Alumno desconocido")}</div>
          <div class="act-meta">${esc(p.curso_nombre || "Sin curso")} · ${p.metodo || "—"} · ${fechaCorta(p.fecha)}</div>
        </div>
        <div class="act-right">
          <div style="font-size:13px;font-weight:700;color:#198754;">${bs(p.monto)}</div>
          <div class="mt-1">${stBadge(p.estado)}</div>
        </div>
      </div>`).join("");
  }

  function renderInscripciones(inscs) {
    if (!inscs?.length) return `<div class="empty-state">Sin inscripciones recientes</div>`;
    return inscs.map(i => `
      <div class="activity-item">
        <div class="act-icon" style="background:rgba(25,135,84,.08);border-color:rgba(25,135,84,.15);">📋</div>
        <div class="flex-grow-1 min-w-0">
          <div class="act-title">${esc(i.alumno_nombre || "Alumno desconocido")}</div>
          <div class="act-meta">${esc(i.curso_nombre || "Sin curso")} · ${fechaCorta(i.fecha)}</div>
        </div>
        <div class="act-right">${stBadge(i.estado)}</div>
      </div>`).join("");
  }

  function renderPrestamosAct(prests) {
    if (!prests?.length) return `<div class="empty-state">Sin préstamos recientes</div>`;
    return prests.map(p => `
      <div class="activity-item">
        <div class="act-icon" style="background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.18);">📦</div>
        <div class="flex-grow-1 min-w-0">
          <div class="act-title">${esc(p.item_producto || "Material")}</div>
          <div class="act-meta">${esc(p.instructor_nombre || "Sin instructor")} · ${fechaCorta(p.fecha)}</div>
        </div>
        <div class="act-right">
          <div style="font-size:13px;font-weight:700;">${p.cantidad} uds</div>
          <div class="mt-1">${stBadge(p.estado)}</div>
        </div>
      </div>`).join("");
  }

  // ── Render: top préstamos ───────────────────────────────────────────────

  const RANK_COLORS = [
    { bg: "rgba(245,158,11,.15)", color: "#b45309" },
    { bg: "rgba(156,163,175,.15)", color: "#374151" },
    { bg: "rgba(180,107,60,.12)", color: "#92400e" },
  ];

  function renderTopPrestamos(top3) {
    if (!top3?.length) return `<div class="empty-state">Sin préstamos activos</div>`;
    return top3.map((item, i) => {
      const rc = RANK_COLORS[i] || RANK_COLORS[2];
      return `
        <div class="top-prest-row">
          <div class="rank-badge" style="background:${rc.bg};color:${rc.color};">#${i + 1}</div>
          <div class="flex-grow-1 min-w-0">
            <div style="font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.producto)}</div>
            <div style="font-size:11.5px;color:#6c757d;">${item.prestamos} préstamo${item.prestamos !== 1 ? "s" : ""} activos</div>
          </div>
          <div style="font-size:14px;font-weight:800;color:${rc.color};">${item.cantidad} uds</div>
        </div>`;
    }).join("");
  }

  // ── Render: alertas stock ───────────────────────────────────────────────

  function renderAlertasStock(alertas) {
    if (!alertas?.length) return `<div class="empty-state">✅ Sin alertas de stock bajo</div>`;
    return alertas.map(a => {
      const pct = a.stock_minimo > 0 ? Math.min(100, Math.round(a.stock_actual / a.stock_minimo * 100)) : 0;
      return `
        <div class="stock-row">
          <div class="flex-grow-1 min-w-0">
            <div style="font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.producto)}</div>
            <div class="d-flex align-items-center gap-2 mt-1">
              <div style="flex:1;height:5px;border-radius:999px;background:rgba(16,24,40,.08);">
                <div style="width:${pct}%;height:100%;border-radius:999px;background:#dc3545;"></div>
              </div>
              <span style="font-size:11px;color:#6c757d;flex-shrink:0;">${a.stock_actual}/${a.stock_minimo}</span>
            </div>
          </div>
          <span class="badge text-bg-danger">${a.stock_actual}</span>
        </div>`;
    }).join("");
  }

  // ── Render: Panel cursos (agenda) ────────────────────────────────────────

  function hoyAbrev() {
    return ["dom","lun","mar","mie","jue","vie","sab"][new Date().getDay()];
  }

  function parseDias(diasTexto) {
    if (!diasTexto) return [];
    return diasTexto.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z ]/g, " ").split(/\s+/).map(d => {
        if (d.startsWith("lun")) return "lun";
        if (d.startsWith("mar")) return "mar";
        if (d.startsWith("mie")) return "mie";
        if (d.startsWith("jue")) return "jue";
        if (d.startsWith("vie")) return "vie";
        if (d.startsWith("sab")) return "sab";
        if (d.startsWith("dom")) return "dom";
        return null;
      }).filter(Boolean);
  }

  const PALETTE = [
    "rgba(13,110,253,.90)",
    "rgba(25,135,84,.88)",
    "rgba(220,53,69,.85)",
    "rgba(245,158,11,.90)",
    "rgba(111,66,193,.88)",
    "rgba(13,202,240,.85)",
    "rgba(253,126,20,.88)",
  ];

  function courseColor(id) {
    const n = Number(String(id).replace(/\D/g, "")) || 0;
    return PALETTE[n % PALETTE.length];
  }

  function initials(name) {
    const p = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return ((p[0][0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
  }

  async function cargarPanelCursos() {
    const wrap = $("panelCursos");
    const sub  = $("panelCursosSub");
    if (!wrap) return;

    wrap.innerHTML = `<div class="text-muted small">Cargando cursos…</div>`;

    const hoyISO = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();

    if (sub) sub.textContent = `Cursos en estado "En curso" · ${hoyISO}`;

    const cursosResp = await fetchJSON("/api/cursos").catch(() => null);
    const cursos = Array.isArray(cursosResp) ? cursosResp : (Array.isArray(cursosResp?.data) ? cursosResp.data : []);

    const hoy = hoyAbrev();
    const cursosEnCurso = cursos.filter(c => {
      if (norm(c?.estado) !== "en curso") return false;
      const dias = parseDias(c?.dias);
      return dias.length ? dias.includes(hoy) : true; // si no tiene días, mostrar igual
    });

    if (sub) sub.textContent = `Cursos en curso hoy (${cursosEnCurso.length}) · ${hoyISO}`;

    if (!cursosEnCurso.length) {
      const estados = [...new Set(cursos.map(c => norm(c?.estado)).filter(Boolean))].slice(0, 6);
      wrap.innerHTML = `
        <div class="empty-state" style="min-width:280px;">
          📭 No hay clases "En curso" programadas para hoy.
          ${estados.length ? `<div class="small mt-2 text-muted">Estados detectados: <b>${esc(estados.join(", "))}</b></div>` : ""}
        </div>`;
      return;
    }

    const items = [];
    for (const c of cursosEnCurso) {
      const resp = await fetchJSON(`/api/inscripciones/por-curso/${encodeURIComponent(c.id)}`).catch(() => null);
      const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
      items.push({ id: c.id, nombre: c.nombre, horario: c.horario_por_dia || c.horario || "—", dias: c.dias || "", instructor: c.instructor_nombre || "", alumnos: rows });
    }

    wrap.innerHTML = items.map(c => {
      const first = c.alumnos.slice(0, 12);
      const more  = Math.max(0, c.alumnos.length - first.length);
      const color = courseColor(c.id);
      return `
        <div class="schedule-col" style="--courseColor:${color}">
          <div class="schedule-card">
            <div class="course-stripe"></div>
            <div class="schedule-body-inner">
              <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
                <div class="schedule-title">${esc(c.nombre || "Curso")}</div>
                <span class="badge" style="background:${color};color:#fff;flex-shrink:0;">En curso</span>
              </div>
              ${c.instructor ? `<div style="font-size:12px;color:#6c757d;">🧑‍🏫 ${esc(c.instructor)}</div>` : ""}
              <div class="schedule-meta">
                <span class="meta-chip">⏰ ${esc(c.horario)}</span>
                ${c.dias ? `<span class="meta-chip">📅 ${esc(c.dias)}</span>` : ""}
                <span class="meta-chip">👥 ${c.alumnos.length} alumno${c.alumnos.length !== 1 ? "s" : ""}</span>
              </div>
              <div class="students-grid">
                ${first.map(a => {
                  const nm = a.alumno_nombre || a.nombre || "—";
                  return `<span class="student-chip"><span class="student-avatar">${esc(initials(nm))}</span>${esc(nm)}</span>`;
                }).join("")}
                ${more ? `<span class="student-chip more">+${more} más</span>` : ""}
                ${!c.alumnos.length ? `<span class="text-muted small">Sin alumnos inscritos</span>` : ""}
              </div>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  // ── Init principal ─────────────────────────────────────────────────────────

  async function dashboardInit() {
    // Actualizar label del mes
    const mesEl = $("headerMes");
    if (mesEl) mesEl.innerHTML = `📅 <span>${mesLabel(new Date())}</span>`;

    // Inicializar tabs
    initTabs();

    // Llamada única al nuevo endpoint
    let data = {};
    try {
      const resp = await fetchJSON("/api/reportes/dashboard-v2");
      data = resp?.data || {};
    } catch (e) {
      console.error("[Dashboard V2] Error al cargar datos:", e);
    }

    // ── KPI: Ingresos ──
    const ing = data.ingresos_mes || {};
    set("kpiIngresosMes", bs(ing.total));
    set("kpiIngresosCnt", `${ing.count || 0} pago${ing.count !== 1 ? "s" : ""} cobrado${ing.count !== 1 ? "s" : ""}`);

    const varEl = $("kpiIngresosVar");
    if (varEl) {
      if (ing.variacion_pct === null || ing.variacion_pct === undefined) {
        varEl.textContent = "Sin mes anterior";
        varEl.className = "var-badge var-eq";
      } else {
        const pct = ing.variacion_pct;
        const sign = pct > 0 ? "+" : "";
        varEl.textContent = `${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${sign}${pct.toFixed(1)}% vs mes anterior`;
        varEl.className = `var-badge ${pct > 0 ? "var-up" : pct < 0 ? "var-down" : "var-eq"}`;
      }
    }

    // ── KPI: Alumnos ──
    const alm = data.alumnos || {};
    set("kpiAlumnos",    String(alm.total || 0));
    set("kpiActivos",    String(alm.activos || 0));
    set("kpiInactivos",  String(alm.inactivos || 0));
    set("kpiNuevosMes",  `${alm.nuevos_mes || 0} nuevo${alm.nuevos_mes !== 1 ? "s" : ""} este mes`);

    // ── KPI: Préstamos ──
    const prest = data.prestamos || {};
    set("kpiPrestamosUnidades", String(prest.unidades || 0) + " uds");
    set("kpiPrestamosCount", `${prest.activos || 0} préstamo${prest.activos !== 1 ? "s" : ""} activo${prest.activos !== 1 ? "s" : ""}`);
    if (prest.top3?.length) {
      set("kpiPrestamosTop", "↑ " + prest.top3.map(t => `${t.producto} (${t.cantidad})`).join(", "));
    }

    // ── KPI: Alertas stock ──
    const alertas = data.alertas_stock || [];
    set("kpiAlertasCount", String(alertas.length));

    // ── Actividad reciente ──
    html("actPagos",         renderPagos(data.ultimos_pagos));
    html("actInscripciones", renderInscripciones(data.ultimas_inscripciones));
    html("actPrestamos",     renderPrestamosAct(data.ultimos_prestamos));

    // ── Top préstamos ──
    html("topPrestamos", renderTopPrestamos(prest.top3));

    // ── Alertas stock ──
    html("alertasStock", renderAlertasStock(alertas));

    // ── Panel cursos ──
    try {
      await cargarPanelCursos();
    } catch (e) {
      console.error("[Dashboard] Panel cursos:", e);
      html("panelCursos", `<div class="empty-state text-danger">Error cargando clases. Intente actualizar.</div>`);
    }
  }

  // Exponer para botón de refrescar
  window.dashboardInit = dashboardInit;

  document.addEventListener("DOMContentLoaded", () => {
    dashboardInit();
    $("btnRefrescarPanel")?.addEventListener("click", cargarPanelCursos);
  });

})();

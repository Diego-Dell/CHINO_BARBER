(() => {
  "use strict";

  function currentPage() {
    const p = String(window.location.pathname || "").split("/").pop();
    return p || "index.html";
  }

  function navLink(href, label, icon, activeHref) {
    const active = href === activeHref ? " active" : "";
    return `<a href="${href}" class="nav-link${active}"><i class="bi ${icon}"></i><span>${label}</span></a>`;
  }

  function renderSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    const activeHref = currentPage();
    sidebar.innerHTML = `
      <div class="sidebar-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-2">
          <img
            src="assets/img/FONDO CLARO.png"
            class="brand-logo"
            alt="Logo"
            style="width:120px;height:120px;padding:0;background:transparent;border-radius:0;object-fit:contain;"
          >
          <div class="lh-1">
            <span class="fw-semibold brand-name">Develop by Diego Dell</span>
            <small class="text-muted d-block">Barber School</small>
          </div>
        </div>
        <button class="btn btn-sm btn-outline-secondary d-lg-none" onclick="toggleSidebar()">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <div class="sidebar-section">
        <p class="sidebar-title">General</p>
        <nav class="nav flex-column sidebar-nav">
          ${navLink("index.html", "Dashboard", "bi-speedometer2", activeHref)}
        </nav>
      </div>

      <div class="sidebar-section mt-3">
        <p class="sidebar-title">Gestion academica</p>
        <nav class="nav flex-column sidebar-nav">
          ${navLink("alumnos.html", "Alumnos", "bi-people", activeHref)}
          ${navLink("cursos.html", "Cursos", "bi-journal-bookmark", activeHref)}
          ${navLink("instructores.html", "Instructores", "bi-person-workspace", activeHref)}
          ${navLink("asistencia.html", "Asistencia", "bi-calendar-check", activeHref)}
        </nav>
      </div>

      <div class="sidebar-section mt-3">
        <p class="sidebar-title">Finanzas</p>
        <nav class="nav flex-column sidebar-nav">
          ${navLink("pagos.html", "Pagos", "bi-cash-stack", activeHref)}
          ${navLink("deudores.html", "Deudores", "bi-exclamation-triangle", activeHref)}
        </nav>
      </div>

      <div class="sidebar-section mt-3">
        <p class="sidebar-title">Operacion</p>
        <nav class="nav flex-column sidebar-nav">
          ${navLink("inventario.html", "Inventario", "bi-box-seam", activeHref)}
          ${navLink("reportes.html", "Reportes", "bi-graph-up-arrow", activeHref)}
        </nav>
      </div>
    `;
  }

  window.toggleSidebar = function toggleSidebar() {
    document.getElementById("sidebar")?.classList.toggle("open");
    document.getElementById("overlay")?.classList.toggle("show");
  };

  document.addEventListener("DOMContentLoaded", renderSidebar);
})();

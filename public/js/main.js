// public/js/main.js  — Utilidades globales compartidas entre todas las páginas

// ── fetchJSON ─────────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, { credentials: "include", ...options });
  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  if (!r.ok) {
    const body = isJson ? await r.json().catch(() => null) : await r.text().catch(() => "");
    const msg = body?.error || body?.message || body || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return isJson ? r.json() : null;
}

// ── Formato Bolivianos ────────────────────────────────────────────
const bs = (n) => "Bs " + Number(n || 0).toFixed(2);

// ── Toast notification system ─────────────────────────────────────
(function initToast() {
  if (document.getElementById("toastContainer")) return;
  const c = document.createElement("div");
  c.id = "toastContainer";
  document.body.appendChild(c);
})();

/**
 * showToast({ title, message, type, duration })
 * type: "success" | "error" | "info" | "warning"
 */
function showToast({ title = "", message = "", type = "info", duration = 3500 } = {}) {
  const container = document.getElementById("toastContainer") || (() => {
    const c = document.createElement("div");
    c.id = "toastContainer";
    document.body.appendChild(c);
    return c;
  })();

  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  const t = document.createElement("div");
  t.className = `app-toast ${type}`;
  t.innerHTML = `
    <div class="app-toast-icon">${icons[type] || "ℹ️"}</div>
    <div class="app-toast-body">
      <div class="app-toast-title">${title || type.charAt(0).toUpperCase() + type.slice(1)}</div>
      ${message ? `<div class="app-toast-msg">${message}</div>` : ""}
    </div>`;

  container.appendChild(t);

  const remove = () => {
    t.classList.add("hiding");
    t.addEventListener("animationend", () => t.remove(), { once: true });
  };

  setTimeout(remove, duration);
  t.addEventListener("click", remove);
  return t;
}

// ── Sidebar toggle ────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
  document.getElementById("overlay")?.classList.toggle("show");
}

// ── setText helper ────────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── Empty-state HTML helper ───────────────────────────────────────
function emptyStateHTML(icon = "📭", title = "Sin datos", sub = "No hay registros para mostrar.") {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-sub">${sub}</div>
  </div>`;
}

// public/js/main.js
// Script común (seguro para todas las páginas). Carga el dashboard SOLO si está en index.html.

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

const bs = (n) => "Bs " + Number(n || 0).toFixed(2);

let __dashboardChart = null;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderIngresosChart(canvasId, labels = [], values = []) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (__dashboardChart) {
    __dashboardChart.destroy();
    __dashboardChart = null;
  }

  __dashboardChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Ingresos",
          data: values,
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => bs(ctx.parsed?.y ?? 0),
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => bs(v),
          },
        },
      },
    },
  });
}

async function cargarDashboardIndex() {
  // Solo en index.html (si existe el canvas del dashboard)
  const canvas = document.getElementById("grafIngresosMes");
  if (!canvas) return;

  try {
    const resp = await fetchJSON("/api/reportes/dashboard");
    const d = resp?.data || resp?.ok?.data || resp?.data;

    setText("kpiIngresosMes", bs(d?.ingresos_mes_actual ?? 0));
    setText("kpiAlumnos", d?.total_alumnos ?? 0);
    setText("kpiPagos", d?.total_pagos ?? 0);

    const labels = d?.ingresos_12m?.labels || [];
    const values = d?.ingresos_12m?.values || [];
    renderIngresosChart("grafIngresosMes", labels, values);
  } catch (e) {
    console.error("Dashboard error:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarDashboardIndex();
});

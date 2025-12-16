async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function cargarDashboard() {
  try {
    const d = await fetchJSON("/api/dashboard");

    document.getElementById("kpiAlumnos").textContent = d.alumnos ?? 0;
    document.getElementById("kpiInstructores").textContent = d.instructores ?? 0;
    document.getElementById("kpiCursos").textContent = d.cursos ?? 0;
    document.getElementById("kpiInscripciones").textContent = d.inscripciones_activas ?? 0;

  } catch (e) {
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", cargarDashboard);

// public/js/login.js
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, { credentials: "include", ...options });
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body?.error || body || "Error");
  return body;
}

const form = document.getElementById("loginForm");
const usuario = document.getElementById("usuario");
const password = document.getElementById("password");
const errorBox = document.getElementById("loginError");

function showError(msg) {
  if (!errorBox) return alert(msg);
  errorBox.textContent = msg;
  errorBox.style.display = "";
}

function clearError() {
  if (!errorBox) return;
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const u = (usuario?.value || "").trim();
  const p = (password?.value || "").trim();
  if (!u || !p) return showError("Completa usuario y contraseña.");

  try {
    await fetchJSON("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: u, password: p }),
    });
    window.location.href = "/index.html";
  } catch (err) {
    showError(err.message || "No se pudo iniciar sesión");
  }
});

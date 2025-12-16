
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  const isJson = (r.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new Error(isJson ? (data.error || "Error") : (data || "Error"));
  return data;
}

const form = document.getElementById("formLogin");
const usuario = document.getElementById("usuario");
const password = document.getElementById("password");
const msg = document.getElementById("msgLogin");
const btn = document.getElementById("btnLogin");

function setMsg(text, cls = "text-muted") {
  msg.textContent = text || "";
  msg.className = cls + " small";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const u = usuario.value.trim();
  const p = password.value;

  if (!u || !p) {
    setMsg("Completa usuario y contraseña.", "text-danger");
    return;
  }

  try {
    btn.disabled = true;
    setMsg("Validando...", "text-muted");

    const res = await fetchJSON("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: u, password: p }),
    });

    setMsg("Acceso correcto.", "text-success");

    if (res.rol === "Admin") {
        window.location.href = "/home";

    } else {
      window.location.href = "/pagos.html";
    }
  } catch (err) {
    setMsg(err.message || "Credenciales incorrectas.", "text-danger");
    btn.disabled = false;
    password.value = "";
    password.focus();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  usuario.focus();
});

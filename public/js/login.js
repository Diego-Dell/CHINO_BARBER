// public/js/login.js
// Login UI -> usa AuthAPI (sesión por cookie). No duplica fetch ni lógica del backend.

import { AuthAPI } from "../../api/index.js";

// ===============================
// Constantes
// ===============================
const AFTER_LOGIN = "/index.html";

const SEL = {
  form: "#loginForm",
  usuario: "#usuario",
  password: "#password",
  btnLogin: "#btnLogin",
  error: "#loginError",
  showPassword: "#showPassword",
  spinner: "#loginSpinner",
};

// ===============================
// Helpers UI
// ===============================
function qs(sel) {
  return document.querySelector(sel);
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setHidden(el, hidden) {
  if (!el) return;
  el.style.display = hidden ? "none" : "";
}

function clearError() {
  const err = qs(SEL.error);
  if (err) {
    setText(err, "");
    err.classList.remove("text-danger", "alert", "alert-danger");
    setHidden(err, true);
  }
}

function showError(msg) {
  const text = String(msg || "Error al iniciar sesión").trim();
  const err = qs(SEL.error);
  if (err) {
    setText(err, text);
    // estilos suaves si tu HTML usa bootstrap (si no, no molesta)
    err.classList.add("text-danger");
    setHidden(err, false);
  } else {
    console.error("[login]", text);
  }
}

function setLoading(isLoading) {
  const form = qs(SEL.form);
  const usuario = qs(SEL.usuario);
  const password = qs(SEL.password);
  const btn = qs(SEL.btnLogin);
  const spinner = qs(SEL.spinner);

  if (usuario) usuario.disabled = !!isLoading;
  if (password) password.disabled = !!isLoading;

  if (btn) {
    btn.disabled = !!isLoading;

    // Cambiar texto del botón si existe
    if (btn.dataset && btn.dataset.originalText === undefined) {
      btn.dataset.originalText = btn.textContent || "Entrar";
    }
    btn.textContent = isLoading ? "Ingresando..." : (btn.dataset.originalText || "Entrar");
  }

  // Spinner opcional
  if (spinner) setHidden(spinner, !isLoading);

  // Evitar doble submit por Enter si form existe
  if (form) form.style.pointerEvents = isLoading ? "none" : "";
}

function redirectTo(url) {
  window.location.replace(url);
}

function normalizeStr(v) {
  return String(v ?? "").trim();
}

// ===============================
// Lógica principal
// ===============================
async function checkSession() {
  try {
    const r = await AuthAPI.me({ silent: true });
    // Dependiendo del backend, puede devolver {ok:true,data:{...}} o null
    const user = r?.data?.user ?? r?.data ?? r ?? null;

    if (user && user.usuario) {
      redirectTo(AFTER_LOGIN);
    }
  } catch (_) {
    // silent: true debería evitar throw/redirect, pero si ocurre, ignorar
  }
}

async function onSubmit(e) {
  if (e) e.preventDefault();
  clearError();

  const usuarioEl = qs(SEL.usuario);
  const passEl = qs(SEL.password);

  const usuario = normalizeStr(usuarioEl?.value);
  const password = normalizeStr(passEl?.value);

  if (!usuario) return showError("Ingresa tu usuario.");
  if (!password) return showError("Ingresa tu contraseña.");
  if (password.length < 3) return showError("La contraseña es demasiado corta.");

  setLoading(true);

  try {
    const user = await AuthAPI.login({ usuario, password });

    // Guardar solo info NO sensible
    try {
      localStorage.setItem("last_usuario", usuario);
    } catch (_) {}

    // Si login ok => ir al home
    redirectTo(AFTER_LOGIN);
  } catch (err) {
    // Mensaje amigable
    const msg = (err && err.message) ? err.message : "No se pudo iniciar sesión.";
    showError(msg);
    setLoading(false);
  }
}

function bindShowPassword() {
  const chk = qs(SEL.showPassword);
  const passEl = qs(SEL.password);
  if (!chk || !passEl) return;

  chk.addEventListener("change", () => {
    passEl.type = chk.checked ? "text" : "password";
  });
}

function restoreLastUser() {
  const usuarioEl = qs(SEL.usuario);
  if (!usuarioEl) return;

  try {
    const last = localStorage.getItem("last_usuario");
    if (last && !usuarioEl.value) usuarioEl.value = String(last);
  } catch (_) {}
}

function init() {
  const form = qs(SEL.form);

  // No crashear si no existe el form
  if (form) {
    form.addEventListener("submit", onSubmit);
  } else {
    // Fallback: si no hay form, intentamos bind al botón
    const btn = qs(SEL.btnLogin);
    if (btn) btn.addEventListener("click", onSubmit);
  }

  setHidden(qs(SEL.spinner), true);
  clearError();
  bindShowPassword();
  restoreLastUser();
  checkSession();
}

init();

/*
Incluye en login.html:
  <script type="module" src="js/login.js"></script>

Depende de:
  api/auth.api.js (vía api/index.js) + api/http.js (fetchJSON con cookies)
*/

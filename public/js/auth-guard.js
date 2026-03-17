// ==================================================
// AUTH GUARD FRONTEND
// - Protege páginas HTML privadas
// - Si no hay sesión activa → redirige a login.html
// ==================================================

(async function authGuard() {
  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include", // 🔴 OBLIGATORIO para cookies de sesión
      headers: {
        "Accept": "application/json"
      }
    });

    // No autorizado → login
    if (!res.ok) {
      window.location.replace("/login.html");
      return;
    }

    const data = await res.json();

    // Respuesta inválida o sin usuario → login
    if (!data || (!data.user && !data.data)) {
      window.location.replace("/login.html");
      return;
    }

    // ✅ Usuario válido → seguir cargando la página
    // (no hacemos nada)

  } catch (err) {
    // Error de red, server caído, etc.
    window.location.replace("/login.html");
  }
})();

    // ✅ Crear admin por defecto si no existe ninguno
    const row = await dbGet(db, "SELECT COUNT(*) AS n FROM usuarios");
    if (!row || row.n === 0) {
      const usuario = "admin";
      const pass = "admin123";
      const pass_hash = pbkdf2Hash(pass);
      await dbRun(
        db,
        "INSERT INTO usuarios (usuario, pass_hash, rol, estado, created_at) VALUES (?,?,?,?,?)",
        [usuario, pass_hash, "Admin", "Activo", new Date().toISOString()]
      );
      console.log(`[AUTH] Usuario inicial creado -> ${usuario} / ${pass}`);
    }

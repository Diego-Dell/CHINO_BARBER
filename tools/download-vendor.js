#!/usr/bin/env node
// tools/download-vendor.js
// Descarga todas las librerías de terceros al directorio local:
//   public/assets/vendor/
// Luego actualiza los HTML para apuntar a los archivos locales.
//
// Uso: node tools/download-vendor.js
// Requiere internet solo para descarga inicial.

const https = require("https");
const fs = require("fs");
const path = require("path");

const VENDOR_DIR = path.join(__dirname, "..", "public", "assets", "vendor");

const LIBRARIES = [
  {
    name: "Bootstrap CSS",
    url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    dest: "bootstrap.min.css",
  },
  {
    name: "Bootstrap JS Bundle",
    url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
    dest: "bootstrap.bundle.min.js",
  },
  {
    name: "Chart.js",
    url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
    dest: "chart.umd.min.js",
  },
  {
    name: "jsPDF",
    url: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    dest: "jspdf.umd.min.js",
  },
  {
    name: "jsPDF AutoTable",
    url: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    dest: "jspdf.plugin.autotable.min.js",
  },
];

// Reemplazos en HTML: CDN → local
const CDN_REPLACEMENTS = [
  [
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    "assets/vendor/bootstrap.min.css",
  ],
  [
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
    "assets/vendor/bootstrap.bundle.min.js",
  ],
  [
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
    "assets/vendor/chart.umd.min.js",
  ],
  [
    // también para cursos.html e instructores.html que usan chart.js sin versión
    "https://cdn.jsdelivr.net/npm/chart.js",
    "assets/vendor/chart.umd.min.js",
  ],
  [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    "assets/vendor/jspdf.umd.min.js",
  ],
  [
    "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    "assets/vendor/jspdf.plugin.autotable.min.js",
  ],
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function fetch(url) {
      https.get(url, (res) => {
        // Seguir redirecciones
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(destPath);
          return fetch(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${res.statusCode} para ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve(destPath));
        });
        file.on("error", (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on("error", (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
    }

    fetch(url);
  });
}

async function updateHtmlFiles() {
  const htmlDir = path.join(__dirname, "..", "public");
  const files = fs.readdirSync(htmlDir).filter((f) => f.endsWith(".html"));

  for (const file of files) {
    const filePath = path.join(htmlDir, file);
    let content = fs.readFileSync(filePath, "utf8");
    let changed = false;

    for (const [cdnUrl, localPath] of CDN_REPLACEMENTS) {
      if (content.includes(cdnUrl)) {
        content = content.split(cdnUrl).join(localPath);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, content, "utf8");
      console.log(`  ✅ Actualizado: ${file}`);
    }
  }
}

async function main() {
  console.log("=== CHINO BARBER — Descarga de librerías vendor ===\n");

  // Crear directorio vendor si no existe
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  console.log(`📁 Directorio: ${VENDOR_DIR}\n`);

  // Descargar cada librería
  for (const lib of LIBRARIES) {
    const dest = path.join(VENDOR_DIR, lib.dest);

    // Saltar si ya existe y tiene contenido
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`  ⏭️  Ya existe: ${lib.name} (${Math.round(fs.statSync(dest).size / 1024)}KB)`);
      continue;
    }

    process.stdout.write(`  ⬇️  Descargando: ${lib.name}...`);
    try {
      await downloadFile(lib.url, dest);
      const size = Math.round(fs.statSync(dest).size / 1024);
      console.log(` ✅ (${size}KB)`);
    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
      console.log(`     URL: ${lib.url}`);
    }
  }

  // Verificar que todos se descargaron
  const downloaded = LIBRARIES.filter((lib) => {
    const dest = path.join(VENDOR_DIR, lib.dest);
    return fs.existsSync(dest) && fs.statSync(dest).size > 1000;
  });

  if (downloaded.length < LIBRARIES.length) {
    console.log(`\n⚠️  Solo ${downloaded.length}/${LIBRARIES.length} archivos descargados.`);
    console.log("   Verifica tu conexión a internet e intenta de nuevo.\n");
    process.exit(1);
  }

  console.log(`\n✅ ${downloaded.length}/${LIBRARIES.length} librerías descargadas.\n`);

  // Actualizar HTML files
  console.log("📝 Actualizando archivos HTML...");
  await updateHtmlFiles();

  console.log("\n🎉 Listo. La app ahora usa librerías locales.");
  console.log("   No se necesita internet para ejecutar.\n");
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});

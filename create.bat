@echo off
setlocal enabledelayedexpansion
title CHINO_BARBER - Crear estructura + dependencias

echo ==========================================
echo   CHINO_BARBER - ESTRUCTURA + DEPENDENCIAS
echo ==========================================

cd /d "%~dp0"

:: =========================
:: Verificar Node.js
:: =========================
node -v >nul 2>&1
IF ERRORLEVEL 1 (
  echo ❌ Node.js NO esta instalado.
  echo 👉 Instala Node.js LTS antes de continuar.
  pause
  exit /b 1
)

echo ✅ Node.js detectado

:: =========================
:: Crear carpetas
:: =========================
echo.
echo 📁 Creando carpetas...

mkdir src 2>nul
mkdir tools 2>nul
mkdir public 2>nul

mkdir src\db 2>nul
mkdir src\security 2>nul
mkdir src\services 2>nul
mkdir src\middleware 2>nul
mkdir src\routes 2>nul

mkdir public\css 2>nul
mkdir public\js 2>nul
mkdir public\assets 2>nul
mkdir public\assets\img 2>nul

:: =========================
:: Archivos base
:: =========================
echo.
echo 📄 Creando archivos base...

if not exist README.md (
  > README.md echo # CHINO_BARBER
)

if not exist .gitignore (
  > .gitignore (
    echo node_modules/
    echo dist/
    echo .env
    echo .DS_Store
    echo Thumbs.db
  )
)

if not exist .env.example (
  > .env.example (
    echo PORT=3000
    echo SESSION_SECRET=CAMBIA_ESTE_SECRET_LARGO
    echo APP_NAME=Barber School
    echo BARBER_NAME=Barber Chino
    echo SUPPORT_NAME=Diego Dell
    echo SUPPORT_WHATSAPP=+59173613759
  )
)

if not exist package.json (
  > package.json (
    echo {
    echo   "name": "chino-barber",
    echo   "version": "1.0.0",
    echo   "main": "src/server.js",
    echo   "scripts": {
    echo     "dev": "nodemon src/server.js",
    echo     "start": "node src/server.js",
    echo     "build": "pkg . --targets node18-win-x64 --output dist/BarberSchool.exe"
    echo   }
    echo }
  )
)

call :touch "src\server.js"
call :touch "src\config.js"

call :touch "src\db\schema.sql"
call :touch "src\db\init.js"

call :touch "src\security\license.js"
call :touch "src\services\backup.js"

call :touch "src\middleware\auth.js"
call :touch "src\middleware\licenseGuard.js"

call :touch "src\routes\auth.routes.js"
call :touch "src\routes\settings.routes.js"
call :touch "src\routes\alumnos.routes.js"
call :touch "src\routes\instructores.routes.js"
call :touch "src\routes\cursos.routes.js"
call :touch "src\routes\inscripciones.routes.js"
call :touch "src\routes\asistencia.routes.js"
call :touch "src\routes\pagos.routes.js"
call :touch "src\routes\egresos.routes.js"
call :touch "src\routes\inventario.routes.js"
call :touch "src\routes\agenda.routes.js"
call :touch "src\routes\reportes.routes.js"

call :touch "tools\gen-license.js"
call :touch "tools\reset-db.js"

call :touch "public\login.html"
call :touch "public\activate.html"
call :touch "public\index.html"
call :touch "public\alumnos.html"
call :touch "public\cursos.html"
call :touch "public\instructores.html"
call :touch "public\asistencia.html"
call :touch "public\pagos.html"
call :touch "public\deudores.html"
call :touch "public\inventario.html"
call :touch "public\reportes.html"
call :touch "public\sistema.html"
call :touch "public\acerca.html"

call :touch "public\css\styles.css"

call :touch "public\js\main.js"
call :touch "public\js\login.js"
call :touch "public\js\alumnos.js"
call :touch "public\js\cursos.js"
call :touch "public\js\instructores.js"
call :touch "public\js\asistencia.js"
call :touch "public\js\pagos.js"
call :touch "public\js\inventario.js"
call :touch "public\js\reportes.js"
call :touch "public\js\sistema.js"

:: =========================
:: Instalar dependencias
:: =========================
echo.
echo 📦 Instalando dependencias (puede tardar)...

IF NOT EXIST node_modules (
  npm install express cors sqlite3 bcrypt express-session systeminformation dotenv
  npm install -D nodemon pkg
) ELSE (
  echo ⚠️ node_modules ya existe, no se reinstala.
)

echo.
echo ✅ ESTRUCTURA CREADA E INSTALACION COMPLETA
echo.
echo 📌 SIGUIENTES PASOS:
echo   1) Revisa que todo este creado correctamente
echo   2) Ejecuta el BAT #2 (crear base de datos)
echo.
pause
exit /b 0

:: =========================
:: Función touch
:: =========================
:touch
set "f=%~1"
if not exist "%f%" (
  > "%f%" echo.
  echo   + %f%
) else (
  echo   = %f% (ya existe)
)
exit /b 0

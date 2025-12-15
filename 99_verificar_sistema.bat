@echo off
setlocal
title CHINO_BARBER - Verificacion y Preparacion (OK)

set ERRORS=0

echo ==========================================
echo   CHINO_BARBER - VERIFICACION DEL SISTEMA
echo ==========================================
echo.

cd /d "%~dp0"

echo [1] Verificando Node.js...
node -v >nul 2>&1
if errorlevel 1 (
  echo ❌ Node.js NO instalado
  set /a ERRORS=ERRORS+1
) else (
  echo ✅ Node.js OK
)

echo.
echo [2] Verificando package.json...
if exist package.json (
  echo ✅ package.json OK
) else (
  echo ❌ package.json NO existe
  set /a ERRORS=ERRORS+1
)

echo.
echo [3] Verificando dependencias...
if exist node_modules (
  echo ✅ node_modules OK
) else (
  echo ⚠️ node_modules NO existe - instalando...
  npm install
  if errorlevel 1 (
    echo ❌ Error instalando dependencias
    set /a ERRORS=ERRORS+1
  ) else (
    echo ✅ Dependencias instaladas
  )
)

echo.
echo [4] Verificando archivo .env...
if exist .env (
  echo ✅ .env OK
) else (
  if exist .env.example (
    echo ⚠️ .env no existe, creando desde .env.example
    copy .env.example .env >nul
    echo ✅ .env creado
  ) else (
    echo ❌ .env.example NO existe
    set /a ERRORS=ERRORS+1
  )
)

echo.
echo [5] Verificando Base de Datos...
if exist src\db\database.sqlite (
  echo ✅ Base de datos OK
) else (
  echo ❌ Base de datos NO existe
  echo 👉 Ejecuta: 02_crear_bd.bat
  set /a ERRORS=ERRORS+1
)

echo.
echo [6] Verificando archivos criticos...
if exist src\server.js (echo ✅ src\server.js) else (echo ❌ src\server.js ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist src\db\schema.sql (echo ✅ src\db\schema.sql) else (echo ❌ src\db\schema.sql ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist tools\applySchema.js (echo ✅ tools\applySchema.js) else (echo ❌ tools\applySchema.js ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist tools\seedUsers.js (echo ✅ tools\seedUsers.js) else (echo ❌ tools\seedUsers.js ^(FALTA^) & set /a ERRORS=ERRORS+1)

echo.
echo [7] Verificando carpetas criticas...
if exist src\ (echo ✅ src\) else (echo ❌ src\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist src\db\ (echo ✅ src\db\) else (echo ❌ src\db\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist src\routes\ (echo ✅ src\routes\) else (echo ❌ src\routes\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist src\middleware\ (echo ✅ src\middleware\) else (echo ❌ src\middleware\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist public\ (echo ✅ public\) else (echo ❌ public\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist public\js\ (echo ✅ public\js\) else (echo ❌ public\js\ ^(FALTA^) & set /a ERRORS=ERRORS+1)
if exist public\css\ (echo ✅ public\css\) else (echo ❌ public\css\ ^(FALTA^) & set /a ERRORS=ERRORS+1)

echo.
echo ==========================================
if %ERRORS%==0 (
  echo ✅ SISTEMA LISTO PARA INICIAR
  echo 👉 Ejecuta: 03_iniciar_sistema.bat
) else (
  echo ❌ SISTEMA INCOMPLETO
  echo 👉 Errores detectados: %ERRORS%
)
echo ==========================================
echo.

pause
exit /b 0

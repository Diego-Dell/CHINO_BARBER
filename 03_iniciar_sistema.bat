@echo off
setlocal enabledelayedexpansion
title CHINO_BARBER - Iniciar Sistema

echo ==========================================
echo   CHINO_BARBER - INICIANDO SISTEMA
echo ==========================================

cd /d "%~dp0"

:: =========================
:: Verificar Node.js
:: =========================
node -v >nul 2>&1
IF ERRORLEVEL 1 (
  echo ❌ Node.js NO esta instalado
  pause
  exit /b 1
)

echo ✅ Node.js detectado

:: =========================
:: Verificar dependencias
:: =========================
IF NOT EXIST node_modules (
  echo ❌ No existe node_modules
  echo 👉 Ejecuta primero: 01_crear_estructura_e_instalar.bat
  pause
  exit /b 1
)

:: =========================
:: Crear .env si no existe
:: =========================
IF NOT EXIST .env (
  echo 📄 Creando archivo .env desde .env.example
  copy .env.example .env >nul
)

:: =========================
:: Verificar BD
:: =========================
IF NOT EXIST src\db\database.sqlite (
  echo ❌ Base de datos no encontrada
  echo 👉 Ejecuta primero: 02_crear_bd.bat
  pause
  exit /b 1
)

:: =========================
:: Iniciar servidor
:: =========================
echo 🚀 Iniciando servidor...
start "CHINO_BARBER_SERVER" cmd /k node src\server.js

:: =========================
:: Esperar un poco
:: =========================
timeout /t 2 >nul

:: =========================
:: Abrir sistema
:: =========================
echo 🌐 Abriendo sistema en el navegador...
start http://localhost:3000

echo.
echo ✅ SISTEMA INICIADO CORRECTAMENTE
echo.
echo 🔐 Login:
echo    Admin: admin / 123456
echo    Caja : caja  / 123456
echo.
pause
exit /b 0


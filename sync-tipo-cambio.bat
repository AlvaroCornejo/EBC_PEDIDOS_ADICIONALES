@echo off
echo ============================================================
echo   Sincronizacion Tipo de Cambio (SUNAT) - %date% %time%
echo ============================================================

set APP=C:\pedidos-app

cd /d "%APP%"

echo Sincronizando tipo de cambio...
node scripts\syncTipoCambio.js
if %errorlevel%==0 (
  echo OK: Sincronizacion completada
) else (
  echo ERROR: Fallo la sincronizacion
  exit /b 1
)

echo.
echo Listo.

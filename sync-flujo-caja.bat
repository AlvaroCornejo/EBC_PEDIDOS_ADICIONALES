@echo off
echo ============================================================
echo   Importacion Flujo de Caja - %date% %time%
echo ============================================================

set APP=C:\pedidos-app

cd /d "%APP%"

echo Actualizando codigo (git pull)...
git checkout -- . 2>nul
git pull

echo Importando a MongoDB...
node scripts\importFlujoCaja.js
if %errorlevel%==0 (
  echo OK: Importacion completada
) else (
  echo ERROR: Fallo la importacion
  exit /b 1
)

echo.
echo Listo.

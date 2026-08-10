@echo off
echo ============================================================
echo   Importacion Costeo de Recetas - %date% %time%
echo ============================================================

set EXCEL=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC RECETAS\EBC RECETAS.xlsx
set APP=C:\pedidos-app

cd /d "%APP%"

echo Importando a MongoDB...
node scripts\importRecetasCosteo.js "%EXCEL%"
if %errorlevel%==0 (
  echo OK: Importacion completada
) else (
  echo ERROR: Fallo la importacion
  exit /b 1
)

echo.
echo Listo.

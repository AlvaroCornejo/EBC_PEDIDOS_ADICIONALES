@echo off
echo ============================================================
echo   Importacion Seguimiento de Compras - %date% %time%
echo ============================================================

set EXCEL=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC SEGUIMIENTO DE COMPRAS\EBC BASE SEGUIMIENTO DE COMPRAS.xlsx
set APP=C:\pedidos-app

cd /d "%APP%"

echo Importando a MongoDB...
node scripts\importSeguimientoCompras.js "%EXCEL%"
if %errorlevel%==0 (
  echo OK: Importacion completada
) else (
  echo ERROR: Fallo la importacion
  exit /b 1
)

echo.
echo Listo.

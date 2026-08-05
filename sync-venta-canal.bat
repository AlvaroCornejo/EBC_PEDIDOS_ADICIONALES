@echo off
echo ============================================================
echo   Importacion Venta por Canal (Pronostico de Venta) - %date% %time%
echo ============================================================

set EXCEL=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC VENTAS\EBC VENTAS CABECERA.xlsx
set APP=C:\pedidos-app

cd /d "%APP%"

echo Importando a MongoDB...
node scripts\importVentaCanalDiaria.js "%EXCEL%"
if %errorlevel%==0 (
  echo OK: Importacion completada
) else (
  echo ERROR: Fallo la importacion
  exit /b 1
)

echo.
echo Listo.

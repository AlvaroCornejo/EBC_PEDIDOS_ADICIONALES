@echo off
echo ============================================================
echo   Importacion Comparativo OC - %date% %time%
echo ============================================================

set EXCEL=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC COMPARATIVO OC INGRESOS AL ALMACEN\COMPARATIVO OC INGRESOS.xlsx
set APP=C:\pedidos-app

cd /d "%APP%"

echo Importando a MongoDB...
node scripts\importComparativoOC.js "%EXCEL%"
if %errorlevel%==0 (
  echo OK: Importacion completada
) else (
  echo ERROR: Fallo la importacion
  exit /b 1
)

echo.
echo Listo.

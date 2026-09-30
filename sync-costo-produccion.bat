@echo off
echo Importando Costo de Produccion a MongoDB...
cd /d C:\pedidos-app
node scripts\importCostoProduccion.js
if %errorlevel%==0 (echo OK: Costo de Produccion importado) else (echo ERROR: importCostoProduccion.js)

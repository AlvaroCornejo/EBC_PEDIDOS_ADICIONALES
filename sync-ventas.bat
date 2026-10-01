@echo off
echo Importando Ventas a MongoDB...
cd /d C:\pedidos-app
node scripts\importVentas.js
if %errorlevel%==0 (echo OK: Ventas importadas) else (echo ERROR: importVentas.js)

@echo off
echo Importando Inventarios Diarios a MongoDB...
cd /d C:\pedidos-app
node scripts\importInventarioDiario.js
if %errorlevel%==0 (echo OK: Inventarios Diarios importados) else (echo ERROR: importInventarioDiario.js)

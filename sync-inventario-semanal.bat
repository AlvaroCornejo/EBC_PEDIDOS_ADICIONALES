@echo off
echo Importando Inventario Semanal a MongoDB...
cd /d C:\pedidos-app
node scripts\importInventarioSemanal.js
if %errorlevel%==0 (echo OK: Inventario Semanal importado) else (echo ERROR: importInventarioSemanal.js)

@echo off
echo Importando recetas de planta a MongoDB...
cd /d C:\pedidos-app
node scripts\importRecetas.js
if %errorlevel%==0 (echo OK: Recetas importadas) else (echo ERROR: importRecetas.js)

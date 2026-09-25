@echo off
echo Importando EBC ITEMS (Maestro + Por Operacion) a MongoDB...
cd /d C:\pedidos-app
node scripts\importEbcItems.js
if %errorlevel%==0 (echo OK: EBC ITEMS importado) else (echo ERROR: importEbcItems.js)

@echo off
echo Kardex desde Odoo (solo lectura) a MongoDB...
cd /d C:\pedidos-app
node scripts\syncKardexOdoo.js
if %errorlevel%==0 (echo OK: Kardex Odoo sincronizado) else (echo ERROR: syncKardexOdoo.js)
exit /b %errorlevel%

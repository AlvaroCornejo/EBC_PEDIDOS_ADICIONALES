@echo off
set APP=C:\pedidos-app
cd /d %APP%
node scripts/importCostoVenta.js
exit /b %ERRORLEVEL%

@echo off
set APP=C:\pedidos-app
cd /d %APP%
node scripts/importConciliacion.js
exit /b %ERRORLEVEL%

@echo off
set APP=C:\pedidos-app
cd /d %APP%
node scripts/importEerr.js
exit /b %ERRORLEVEL%

@echo off
:: Items — sincroniza la coleccion Item desde data\*ADICIONALES.xlsx a MongoDB
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncItems.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

@echo off
:: Bajas — importa KardexBajaVenta desde data\*ADICIONALES.xlsx a MongoDB
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\importBajas.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

@echo off
:: EBC OBLIGACIONES.csv -> MongoDB (coleccion ObligacionEBC)
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncObligaciones.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

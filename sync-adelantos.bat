@echo off
:: EBC ADELANTOS.csv -> MongoDB (coleccion PagoAdelanto, boton "POR RENDIR")
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncAdelantos.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

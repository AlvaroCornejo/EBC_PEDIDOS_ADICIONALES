@echo off
:: EBC PAGOS.csv -> MongoDB (promediosPagos en PagoProgramacion, boton "PAGOS")
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncPagosPromedios.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

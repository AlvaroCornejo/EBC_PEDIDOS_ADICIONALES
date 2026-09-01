@echo off
:: Archivos por sociedad (ERSAC/FRQ1/MUVON/GOLDEN_BEAN/QUIASMO/FK.csv) -> MongoDB
:: (coleccion PagoProgramacion, boton "PROGRAMACION"). Solo genera algo los martes,
:: y solo si no existe ya una programacion para la semana actual de esa sociedad.
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncProgramacion.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

@echo off
:: Igual que sync-programacion.bat (archivos por sociedad ERSAC/FRQ1/MUVON/
:: GOLDEN_BEAN/QUIASMO/FK.csv -> MongoDB, coleccion PagoProgramacion) pero SIN
:: el filtro de "solo martes" - para correr a mano, cualquier dia, desde CMD.
:: NO esta incluido en sync-master.bat (no corre en la tarea diaria de las 6 AM).
:: Sigue sin duplicar: por sociedad, si ya existe programacion para la semana
:: actual no genera nada.
setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%

cd /d "%APP%"
node scripts\syncProgramacionManual.js
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

@echo off
:: ============================================================
::  Importacion diaria de Bajas (Kardex BAJA vs VENTA) a MongoDB
::  Lee los archivos data\*ADICIONALES.xlsx del repositorio local.
::  Requiere que sync-excel.bat (CORPSERV-PRUEBA) ya haya corrido
::  y que el repositorio este actualizado (git pull).
:: ============================================================

setlocal
set APP=%~dp0
if "%APP:~-1%"=="\" set APP=%APP:~0,-1%
set LOG=%APP%\scripts\bajas-sync.log

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo  Bajas - Inicio: %DATE% %TIME% >> "%LOG%"
echo ============================================================ >> "%LOG%"

cd /d "%APP%"
node scripts\importBajas.js >> "%LOG%" 2>&1

if %ERRORLEVEL% EQU 0 (
    echo  Resultado: EXITOSO >> "%LOG%"
) else (
    echo  Resultado: ERROR codigo %ERRORLEVEL% >> "%LOG%"
)
echo  Fin: %DATE% %TIME% >> "%LOG%"
endlocal

@echo off
:: ============================================================
::  Importación semanal de Compras Históricas a MongoDB
::  Se ejecuta automáticamente cada lunes a las 6:00 AM
:: ============================================================

set APP_DIR=C:\pedidos-app
set LOG_FILE=%APP_DIR%\scripts\importacion.log
set EXCEL_FILE=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC COMPRAS\EBC COMPRAS HISTORICAS.xlsx

echo. >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"
echo Inicio: %DATE% %TIME% >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"

:: Verificar que el archivo Excel existe
if not exist "%EXCEL_FILE%" (
    echo ERROR: No se encontro el archivo Excel: >> "%LOG_FILE%"
    echo %EXCEL_FILE% >> "%LOG_FILE%"
    exit /b 1
)

:: Ejecutar importacion
cd /d "%APP_DIR%"
node scripts\importCompras.js "%EXCEL_FILE%" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQU 0 (
    echo Resultado: EXITOSO >> "%LOG_FILE%"
) else (
    echo Resultado: ERROR (codigo %ERRORLEVEL%^) >> "%LOG_FILE%"
)

echo Fin: %DATE% %TIME% >> "%LOG_FILE%"

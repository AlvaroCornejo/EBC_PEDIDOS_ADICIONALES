@echo off
:: ============================================================
::  Import MANUAL del Maestro de Items (tablas + catalogo + plan contable)
::  NO se agrega a sync-master.bat -- se ejecuta a mano solo cuando
::  se actualiza alguno de los 2 Excel de origen. Automatizarlo a diario
::  borraria (deleteMany + insertMany) los items creados via el flujo
::  de solicitudes de la app, que no existen en el Excel original.
:: ============================================================

set APP_DIR=C:\pedidos-app
set LOG_FILE=%APP_DIR%\scripts\importar-maestro-items.log
set TABLAS_FILE=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ITEMS\EBC TABLAS PARA ITEMS.xlsx
set CONTABLE_FILE=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC CONTABILIDAD\EBC PLAN CONTABLE.xlsx

echo. >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"
echo Inicio: %DATE% %TIME% >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"

if not exist "%TABLAS_FILE%" (
    echo ERROR: No se encontro el archivo Excel: >> "%LOG_FILE%"
    echo %TABLAS_FILE% >> "%LOG_FILE%"
    exit /b 1
)
if not exist "%CONTABLE_FILE%" (
    echo ERROR: No se encontro el archivo Excel: >> "%LOG_FILE%"
    echo %CONTABLE_FILE% >> "%LOG_FILE%"
    exit /b 1
)

cd /d "%APP_DIR%"

echo [1/2] Importando tablas + catalogo de items... >> "%LOG_FILE%"
node scripts\importMaestroTablas.js "%TABLAS_FILE%" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Resultado: ERROR en importMaestroTablas.js (codigo %ERRORLEVEL%^) >> "%LOG_FILE%"
    exit /b %ERRORLEVEL%
)

echo [2/2] Importando plan contable... >> "%LOG_FILE%"
node scripts\importPlanContable.js "%CONTABLE_FILE%" >> "%LOG_FILE%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Resultado: ERROR en importPlanContable.js (codigo %ERRORLEVEL%^) >> "%LOG_FILE%"
    exit /b %ERRORLEVEL%
)

echo Resultado: EXITOSO >> "%LOG_FILE%"
echo Fin: %DATE% %TIME% >> "%LOG_FILE%"

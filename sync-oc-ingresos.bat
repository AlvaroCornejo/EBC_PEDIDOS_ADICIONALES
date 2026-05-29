@echo off
:: ============================================================
::  OC Ingresos Actualizacion
::  Ejecuta el script Python que actualiza los datos de OC Ingresos
:: ============================================================

setlocal
set LOG=C:\pedidos-app\scripts\sync-master.log
set SCRIPT=D:\Comparativo_OC\actualizar_oc_ingresos.py

echo  Script: %SCRIPT% >> "%LOG%"

if not exist "%SCRIPT%" (
    echo  ERROR: No se encontro %SCRIPT% >> "%LOG%"
    exit /b 1
)

python "%SCRIPT%"
if %ERRORLEVEL% EQU 0 (
    echo  OK >> "%LOG%"
) else (
    echo  ERROR codigo %ERRORLEVEL% >> "%LOG%"
    exit /b 1
)

endlocal

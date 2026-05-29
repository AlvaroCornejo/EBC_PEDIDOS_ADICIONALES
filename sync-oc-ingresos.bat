@echo off
:: OC Ingresos Actualizacion — python D:\Comparativo_OC\actualizar_oc_ingresos.py
setlocal
set SCRIPT=D:\Comparativo_OC\actualizar_oc_ingresos.py

if not exist "%SCRIPT%" (
    echo  ERROR: No se encontro %SCRIPT%
    exit /b 1
)

python "%SCRIPT%"
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

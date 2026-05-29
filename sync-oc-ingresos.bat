@echo off
:: OC Ingresos Actualizacion — actualizar_oc_ingresos.py
setlocal
set PYTHON=C:\Users\CORP.PROCESOS\AppData\Local\Programs\Python\Python312\python.exe
set SCRIPT=D:\Comparativo_OC\actualizar_oc_ingresos.py

if not exist "%PYTHON%" (
    echo ERROR: Python no encontrado en %PYTHON%
    exit /b 1
)
if not exist "%SCRIPT%" (
    echo ERROR: No se encontro %SCRIPT%
    exit /b 1
)

"%PYTHON%" "%SCRIPT%"
if %ERRORLEVEL% NEQ 0 (exit /b 1)

endlocal

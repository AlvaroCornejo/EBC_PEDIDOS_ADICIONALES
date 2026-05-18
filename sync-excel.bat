@echo off
echo Sincronizando archivos Excel desde Box...

copy /Y "C:\Users\CORP.PROCESOS\Box\OPERACIONES\ERSAC\RQ ERSAC\RQ AASI\Seguimiento OC\AASI - ADICIONALES.xlsx" "C:\pedidos-app\data\AASI - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: AASI - ADICIONALES.xlsx) else (echo ERROR: AASI - ADICIONALES.xlsx)

copy /Y "C:\Users\CORP.PROCESOS\Box\OPERACIONES\ERSAC\RQ ERSAC\RQ CDLAO\Seguimiento OC\CDLAO - ADICIONALES.xlsx" "C:\pedidos-app\data\CDLAO - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDLAO - ADICIONALES.xlsx) else (echo ERROR: CDLAO - ADICIONALES.xlsx)

copy /Y "C:\Users\CORP.PROCESOS\Box\OPERACIONES\FRQ1\RQ FRQ1\RQ CDL28\Seguimiento OC\CDL28 - ADICIONALES.xlsx" "C:\pedidos-app\data\CDL28 - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDL28 - ADICIONALES.xlsx) else (echo ERROR: CDL28 - ADICIONALES.xlsx)

echo Sincronizacion completada.

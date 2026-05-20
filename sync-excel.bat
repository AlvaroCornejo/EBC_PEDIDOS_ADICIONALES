@echo off
echo Sincronizando archivos Excel desde Box...

copy /Y "C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES\AASI - ADICIONALES.xlsx" "C:\pedidos-app\data\AASI - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: AASI - ADICIONALES.xlsx) else (echo ERROR: AASI - ADICIONALES.xlsx)

copy /Y "C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES\CDLAO - ADICIONALES.xlsx" "C:\pedidos-app\data\CDLAO - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDLAO - ADICIONALES.xlsx) else (echo ERROR: CDLAO - ADICIONALES.xlsx)

copy /Y "C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES\CDL28 - ADICIONALES.xlsx" "C:\pedidos-app\data\CDL28 - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDL28 - ADICIONALES.xlsx) else (echo ERROR: CDL28 - ADICIONALES.xlsx)

echo Sincronizacion completada.

echo Subiendo a GitHub...
cd C:\pedidos-app
git pull
git add data\
git commit -m "Sync Excel %date%"
git push
echo GitHub actualizado. DigitalOcean actualizara en 1-2 minutos.

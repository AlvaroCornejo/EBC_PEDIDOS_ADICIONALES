@echo off
echo Sincronizando archivos Excel desde Box...

set SRC=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ADICIONALES
set DST=C:\pedidos-app\data

copy /Y "%SRC%\AASI - ADICIONALES.xlsx"      "%DST%\AASI - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: AASI) else (echo ERROR: AASI)

copy /Y "%SRC%\CDLAO - ADICIONALES.xlsx"     "%DST%\CDLAO - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDLAO) else (echo ERROR: CDLAO)

copy /Y "%SRC%\CDL28 - ADICIONALES.xlsx"     "%DST%\CDL28 - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CDL28) else (echo ERROR: CDL28)

copy /Y "%SRC%\CORP - ADICIONALES.xlsx"      "%DST%\CORP - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: CORP) else (echo ERROR: CORP)

copy /Y "%SRC%\DOSIMETRIA - ADICIONALES.xlsx" "%DST%\DOSIMETRIA - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: DOSIMETRIA) else (echo ERROR: DOSIMETRIA)

copy /Y "%SRC%\GBADC - ADICIONALES.xlsx"     "%DST%\GBADC - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBADC) else (echo ERROR: GBADC)

copy /Y "%SRC%\GBCFR - ADICIONALES.xlsx"     "%DST%\GBCFR - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBCFR) else (echo ERROR: GBCFR)

copy /Y "%SRC%\GBCFR2 - ADICIONALES.xlsx"    "%DST%\GBCFR2 - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBCFR2) else (echo ERROR: GBCFR2)

copy /Y "%SRC%\GBCRP - ADICIONALES.xlsx"     "%DST%\GBCRP - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBCRP) else (echo ERROR: GBCRP)

copy /Y "%SRC%\GBGOL - ADICIONALES.xlsx"     "%DST%\GBGOL - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBGOL) else (echo ERROR: GBGOL)

copy /Y "%SRC%\GBSRQ - ADICIONALES.xlsx"     "%DST%\GBSRQ - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBSRQ) else (echo ERROR: GBSRQ)

copy /Y "%SRC%\PREP - ADICIONALES.xlsx"      "%DST%\PREP - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: PREP) else (echo ERROR: PREP)

copy /Y "%SRC%\GBPLANTA - ADICIONALES.xlsx"  "%DST%\GBPLANTA - ADICIONALES.xlsx"
if %errorlevel%==0 (echo OK: GBPLANTA) else (echo ERROR: GBPLANTA)

set SRC2=C:\Users\CORP.PROCESOS\Box\EBC\EBC AI\EBC AI BASES\EBC ITEMS
copy /Y "%SRC2%\EBC ITEMS_VENTA.xlsx" "%DST%\EBC ITEMS_VENTA.xlsx"
if %errorlevel%==0 (echo OK: ITEMS_VENTA) else (echo ERROR: ITEMS_VENTA)

set SRC3=C:\Users\CORP.PROCESOS\Box\EBC\EBC LOGISTICA\EBC RECETAS
copy /Y "%SRC3%\EBC JERARQUIA.xlsx" "%DST%\EBC JERARQUIA.xlsx"
if %errorlevel%==0 (echo OK: JERARQUIA) else (echo ERROR: JERARQUIA)

echo.
echo Sincronizacion completada.

echo Subiendo a GitHub...
cd C:\pedidos-app
git pull
git add data\
git commit -m "Sync Excel %date%"
git push
echo GitHub actualizado. DigitalOcean actualizara en 1-2 minutos.

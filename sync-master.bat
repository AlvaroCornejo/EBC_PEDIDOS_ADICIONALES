@echo off
:: ============================================================
::  EBC - Actualizacion Diaria Completa
::  CORPSERV-PRUEBA  C:\pedidos-app\
::
::  Orden de ejecucion:
::    1. Sync Excel ADICIONALES  (copia xlsx de Box + git push)
::    2. OC Ingresos Actualizacion  (copia Excel OC de Box)
::    3. Comparativo OC  → MongoDB
::    4. Ventas / TIP    → MongoDB
::    5. Bajas           → MongoDB
::    6. Compras Hist.   → MongoDB
:: ============================================================

setlocal
set APP=C:\pedidos-app
set LOG=%APP%\scripts\sync-master.log
set ERRORES=0

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo  Inicio: %DATE% %TIME% >> "%LOG%"
echo ============================================================ >> "%LOG%"

:: ── 1. Sync Excel ADICIONALES ───────────────────────────────────
echo. >> "%LOG%"
echo [1/6] Sync Excel Pedidos (ADICIONALES + git push) >> "%LOG%"
call "%APP%\sync-excel.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-excel >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── 2. OC Ingresos Actualizacion ────────────────────────────────
echo. >> "%LOG%"
echo [2/6] OC Ingresos Actualizacion >> "%LOG%"
call "%APP%\sync-oc-ingresos.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-oc-ingresos >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── 3. Comparativo OC → MongoDB ─────────────────────────────────
echo. >> "%LOG%"
echo [3/6] Comparativo OC >> "%LOG%"
call "%APP%\sync-comparativo.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-comparativo >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── 4. Ventas / TIP → MongoDB ───────────────────────────────────
echo. >> "%LOG%"
echo [4/6] Ventas / TIP >> "%LOG%"
call "%APP%\sync-ventas.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ventas >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── 5. Bajas → MongoDB ──────────────────────────────────────────
echo. >> "%LOG%"
echo [5/6] Bajas >> "%LOG%"
call "%APP%\sync-bajas.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-bajas >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── 6. Compras Historicas → MongoDB ─────────────────────────────
echo. >> "%LOG%"
echo [6/6] Compras Historicas >> "%LOG%"
call "%APP%\scripts\ejecutar-importacion.bat" >> "%LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (echo  ERROR en importacion compras >> "%LOG%" & set ERRORES=1) else (echo  OK >> "%LOG%")

:: ── Resumen ─────────────────────────────────────────────────────
echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
if %ERRORES% EQU 0 (
    echo  RESULTADO: TODO OK >> "%LOG%"
) else (
    echo  RESULTADO: CON ERRORES - revisar log >> "%LOG%"
)
echo  Fin: %DATE% %TIME% >> "%LOG%"
echo ============================================================ >> "%LOG%"

endlocal
exit /b %ERRORES%

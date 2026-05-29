@echo off
:: ============================================================
::  EBC - Actualizacion Diaria Completa
::  CORPSERV-PRUEBA  C:\pedidos-app\
::  Tarea: "EBC Actualizacion Diaria" — 06:00 AM SYSTEM
::
::  Orden:
::    1. Sync Excel ADICIONALES  (copia xlsx de Box + git push)
::    2. OC Ingresos Actualizacion
::    3. Comparativo OC  -> MongoDB
::    4. Ventas / TIP    -> MongoDB
::    5. Bajas           -> MongoDB
::    6. Compras Hist.   -> MongoDB
:: ============================================================

setlocal
set APP=C:\pedidos-app
set LOG=%APP%\scripts\sync-master.log
set ERRORES=0

:: Redirigir toda la salida de este proceso al log (una sola apertura)
if not exist "%APP%\scripts" mkdir "%APP%\scripts"
call :run >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%

:run
echo.
echo ============================================================
echo  Inicio: %DATE% %TIME%
echo ============================================================

:: ── 1. Sync Excel ADICIONALES ───────────────────────────────────
echo.
echo [1/6] Sync Excel Pedidos (ADICIONALES + git push)
call "%APP%\sync-excel.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-excel & set ERRORES=1) else echo  OK

:: ── 2. OC Ingresos Actualizacion ────────────────────────────────
echo.
echo [2/6] OC Ingresos Actualizacion
call "%APP%\sync-oc-ingresos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-oc-ingresos & set ERRORES=1) else echo  OK

:: ── 3. Comparativo OC -> MongoDB ────────────────────────────────
echo.
echo [3/6] Comparativo OC
call "%APP%\sync-comparativo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-comparativo & set ERRORES=1) else echo  OK

:: ── 4. Ventas / TIP -> MongoDB ──────────────────────────────────
echo.
echo [4/6] Ventas / TIP
call "%APP%\sync-ventas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ventas & set ERRORES=1) else echo  OK

:: ── 5. Bajas -> MongoDB ─────────────────────────────────────────
echo.
echo [5/6] Bajas
call "%APP%\sync-bajas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-bajas & set ERRORES=1) else echo  OK

:: ── 6. Compras Historicas -> MongoDB ────────────────────────────
echo.
echo [6/6] Compras Historicas
call "%APP%\scripts\ejecutar-importacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en importacion compras & set ERRORES=1) else echo  OK

:: ── Resumen ─────────────────────────────────────────────────────
echo.
echo ============================================================
if %ERRORES% EQU 0 (echo  RESULTADO: TODO OK) else echo  RESULTADO: CON ERRORES (ver arriba)
echo  Fin: %DATE% %TIME%
echo ============================================================

exit /b %ERRORES%

@echo off
:: ============================================================
::  EBC - Actualizacion Diaria Completa
::  CORPSERV-PRUEBA  C:\pedidos-app\
::  Tarea: "EBC Actualizacion Diaria" - 06:00 AM SYSTEM
::
::  Orden:
::    1.  Sync Excel ADICIONALES     (copia xlsx de Box + git push)
::    2.  OC Ingresos Actualizacion
::    3.  Comparativo OC             -> MongoDB
::    4.  Ventas / TIP               -> MongoDB
::    5.  Bajas                      -> MongoDB
::    6.  Compras Hist.              -> MongoDB
::    7.  Items                      -> MongoDB
::    8.  Recetas Planta             -> MongoDB
::    9.  EBC EERR (Estado de Resultados) -> MongoDB
::    10. EBC EERR Costo de Venta (Detalle) -> MongoDB
::    11. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB
::    12. Costeo de Recetas                 -> MongoDB
::    13. Flujo de Caja                     -> MongoDB
::    14. Tipo de Cambio (SUNAT)            -> MongoDB
::    15. EBC Pagos (promedios)             -> MongoDB
::    16. EBC Adelantos (Por Rendir)        -> MongoDB
::    17. EBC Programacion (por sociedad, solo martes) -> MongoDB
::    18. Saldos Bancarios (carpeta Descargas, "movimiento*" de hoy) -> MongoDB
:: ============================================================

setlocal
set APP=C:\pedidos-app
set LOG=%APP%\scripts\sync-master.log
set ERRORES=0

:: Redirigir toda la salida al log (eliminar primero para evitar bloqueos)
if not exist "%APP%\scripts" mkdir "%APP%\scripts"
if exist "%LOG%" del /f /q "%LOG%"
call :run > "%LOG%" 2>&1
exit /b %ERRORLEVEL%

:run
echo.
echo ============================================================
echo  Inicio: %DATE% %TIME%
echo ============================================================

:: -- 1. Sync Excel ADICIONALES --
echo.
echo [1/18] Sync Excel Pedidos (ADICIONALES + git push)
call "%APP%\sync-excel.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-excel & set ERRORES=1) else echo  OK

:: -- 2. OC Ingresos Actualizacion --
echo.
echo [2/18] OC Ingresos Actualizacion
call "%APP%\sync-oc-ingresos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-oc-ingresos & set ERRORES=1) else echo  OK

:: -- 3. Comparativo OC -> MongoDB --
echo.
echo [3/18] Comparativo OC
call "%APP%\sync-comparativo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-comparativo & set ERRORES=1) else echo  OK

:: -- 4. Ventas / TIP -> MongoDB --
echo.
echo [4/18] Ventas / TIP
call "%APP%\sync-ventas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ventas & set ERRORES=1) else echo  OK

:: -- 5. Bajas -> MongoDB --
echo.
echo [5/18] Bajas
call "%APP%\sync-bajas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-bajas & set ERRORES=1) else echo  OK

:: -- 6. Compras Historicas -> MongoDB --
echo.
echo [6/18] Compras Historicas
call "%APP%\scripts\ejecutar-importacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en importacion compras & set ERRORES=1) else echo  OK

:: -- 7. Items -> MongoDB --
echo.
echo [7/18] Items
call "%APP%\sync-items.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-items & set ERRORES=1) else echo  OK

:: -- 8. Recetas Planta -> MongoDB --
echo.
echo [8/18] Recetas Planta
call "%APP%\sync-recetas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas & set ERRORES=1) else echo  OK

:: -- 9. EBC EERR (Estado de Resultados) -> MongoDB --
echo.
echo [9/18] EBC EERR - Estado de Resultados
call "%APP%\sync-eerr.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-eerr ^& set ERRORES=1) else echo  OK

:: -- 10. EBC EERR Costo de Venta (Detalle) -> MongoDB --
echo.
echo [10/18] EBC EERR Costo de Venta - Detalle
call "%APP%\sync-costoventa.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-costoventa & set ERRORES=1) else echo  OK

:: -- 11. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB --
echo.
echo [11/18] Conciliacion de Cobranzas
call "%APP%\sync-conciliacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-conciliacion ^& set ERRORES=1) else echo  OK

:: -- 12. Costeo de Recetas -> MongoDB --
echo.
echo [12/18] Costeo de Recetas
call "%APP%\sync-recetas-costeo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas-costeo & set ERRORES=1) else echo  OK

:: -- 13. Flujo de Caja -> MongoDB --
echo.
echo [13/18] Flujo de Caja
call "%APP%\sync-flujo-caja.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-flujo-caja & set ERRORES=1) else echo  OK

:: -- 14. Tipo de Cambio (SUNAT) -> MongoDB --
echo.
echo [14/18] Tipo de Cambio
call "%APP%\sync-tipo-cambio.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-tipo-cambio & set ERRORES=1) else echo  OK

:: -- 15. EBC Pagos (promedios) -> MongoDB --
echo.
echo [15/18] EBC Pagos - Promedios
call "%APP%\sync-pagos-promedios.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-pagos-promedios & set ERRORES=1) else echo  OK

:: -- 16. EBC Adelantos (Por Rendir) -> MongoDB --
echo.
echo [16/18] EBC Adelantos - Por Rendir
call "%APP%\sync-adelantos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-adelantos & set ERRORES=1) else echo  OK

:: -- 17. EBC Programacion (por sociedad, solo martes) -> MongoDB --
echo.
echo [17/18] EBC Programacion - por sociedad (solo martes)
call "%APP%\sync-programacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-programacion & set ERRORES=1) else echo  OK

:: -- 18. Saldos Bancarios (carpeta Descargas, archivos "movimiento*" de hoy) -> MongoDB --
echo.
echo [18/18] Saldos Bancarios
call "%APP%\sync-saldo-banco.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-saldo-banco & set ERRORES=1) else echo  OK

:: -- Resumen --
echo.
echo ============================================================
if %ERRORES% EQU 0 (echo  RESULTADO: TODO OK) else echo  RESULTADO: CON ERRORES (ver arriba)
echo  Fin: %DATE% %TIME%
echo ============================================================

exit /b %ERRORES%

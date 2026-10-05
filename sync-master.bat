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
::    4.  Bajas                      -> MongoDB
::    5.  Compras Hist.              -> MongoDB
::    6.  Items                      -> MongoDB
::    7.  Recetas Planta             -> MongoDB
::    8.  EBC EERR (Estado de Resultados) -> MongoDB
::    9.  EBC EERR Costo de Venta (Detalle) -> MongoDB
::    10. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB
::    11. Costeo de Recetas                 -> MongoDB
::    12. Flujo de Caja                     -> MongoDB
::    13. Tipo de Cambio (SUNAT)            -> MongoDB
::    14. EBC Pagos (promedios)             -> MongoDB
::    15. EBC Adelantos (Por Rendir)        -> MongoDB
::    16. EBC Programacion (por sociedad, solo martes) -> MongoDB
::    17. Saldos Bancarios (carpeta Descargas, "movimiento*" de hoy) -> MongoDB
::    18. Inventarios Diarios (EBC SALDO AL DIA.xlsx, reemplaza todo) -> MongoDB
::    19. EBC Items (Maestro + Por Operacion, reemplaza todo)     -> MongoDB
::    20. Inventario Semanal (EBC CONTEOS.xlsx, reemplaza todo)   -> MongoDB
::    21. Costo de Produccion planta (EBC COSTO DE PRODUCCION.xlsx, reemplaza el anio) -> MongoDB
::    22. Ventas (EBC VENTAS.xlsx, reemplaza todo)                 -> MongoDB
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
echo [1/22] Sync Excel Pedidos (ADICIONALES + git push)
call "%APP%\sync-excel.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-excel & set ERRORES=1) else echo  OK

:: -- 2. OC Ingresos Actualizacion --
echo.
echo [2/22] OC Ingresos Actualizacion
call "%APP%\sync-oc-ingresos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-oc-ingresos & set ERRORES=1) else echo  OK

:: -- 3. Comparativo OC -> MongoDB --
echo.
echo [3/22] Comparativo OC
call "%APP%\sync-comparativo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-comparativo & set ERRORES=1) else echo  OK

:: -- 4. Bajas -> MongoDB --
echo.
echo [4/22] Bajas
call "%APP%\sync-bajas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-bajas & set ERRORES=1) else echo  OK

:: -- 5. Compras Historicas -> MongoDB --
echo.
echo [5/22] Compras Historicas
call "%APP%\scripts\ejecutar-importacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en importacion compras & set ERRORES=1) else echo  OK

:: -- 6. Items -> MongoDB --
echo.
echo [6/22] Items
call "%APP%\sync-items.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-items & set ERRORES=1) else echo  OK

:: -- 7. Recetas Planta -> MongoDB --
echo.
echo [7/22] Recetas Planta
call "%APP%\sync-recetas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas & set ERRORES=1) else echo  OK

:: -- 8. EBC EERR (Estado de Resultados) -> MongoDB --
echo.
echo [8/22] EBC EERR - Estado de Resultados
call "%APP%\sync-eerr.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-eerr ^& set ERRORES=1) else echo  OK

:: -- 9. EBC EERR Costo de Venta (Detalle) -> MongoDB --
echo.
echo [9/22] EBC EERR Costo de Venta - Detalle
call "%APP%\sync-costoventa.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-costoventa & set ERRORES=1) else echo  OK

:: -- 10. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB --
echo.
echo [10/22] Conciliacion de Cobranzas
call "%APP%\sync-conciliacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-conciliacion ^& set ERRORES=1) else echo  OK

:: -- 11. Costeo de Recetas -> MongoDB --
echo.
echo [11/22] Costeo de Recetas
call "%APP%\sync-recetas-costeo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas-costeo & set ERRORES=1) else echo  OK

:: -- 12. Flujo de Caja -> MongoDB --
echo.
echo [12/22] Flujo de Caja
call "%APP%\sync-flujo-caja.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-flujo-caja & set ERRORES=1) else echo  OK

:: -- 13. Tipo de Cambio (SUNAT) -> MongoDB --
echo.
echo [13/22] Tipo de Cambio
call "%APP%\sync-tipo-cambio.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-tipo-cambio & set ERRORES=1) else echo  OK

:: -- 14. EBC Pagos (promedios) -> MongoDB --
echo.
echo [14/22] EBC Pagos - Promedios
call "%APP%\sync-pagos-promedios.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-pagos-promedios & set ERRORES=1) else echo  OK

:: -- 15. EBC Adelantos (Por Rendir) -> MongoDB --
echo.
echo [15/22] EBC Adelantos - Por Rendir
call "%APP%\sync-adelantos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-adelantos & set ERRORES=1) else echo  OK

:: -- 16. EBC Programacion (por sociedad, solo martes) -> MongoDB --
echo.
echo [16/22] EBC Programacion - por sociedad (solo martes)
call "%APP%\sync-programacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-programacion & set ERRORES=1) else echo  OK

:: -- 17. Saldos Bancarios (carpeta Descargas, archivos "movimiento*" de hoy) -> MongoDB --
echo.
echo [17/22] Saldos Bancarios
call "%APP%\sync-saldo-banco.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-saldo-banco & set ERRORES=1) else echo  OK

:: -- 18. Inventarios Diarios (reemplaza todo) -> MongoDB --
echo.
echo [18/22] Inventarios Diarios
call "%APP%\sync-inventario-diario.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-inventario-diario & set ERRORES=1) else echo  OK

:: -- 19. EBC Items (Maestro + Por Operacion, reemplaza todo) -> MongoDB --
echo.
echo [19/22] EBC Items
call "%APP%\sync-ebc-items.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ebc-items & set ERRORES=1) else echo  OK

:: -- 20. Inventario Semanal (reemplaza todo) -> MongoDB --
echo.
echo [20/22] Inventario Semanal
call "%APP%\sync-inventario-semanal.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-inventario-semanal & set ERRORES=1) else echo  OK

:: -- 21. Costo de Produccion planta (reemplaza el anio) -> MongoDB --
echo.
echo [21/22] Costo de Produccion
call "%APP%\sync-costo-produccion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-costo-produccion & set ERRORES=1) else echo  OK

:: -- 22. Ventas (reemplaza todo) -> MongoDB --
echo.
echo [22/22] Ventas
call "%APP%\sync-ventas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ventas & set ERRORES=1) else echo  OK

:: -- Resumen --
echo.
echo ============================================================
if %ERRORES% EQU 0 (echo  RESULTADO: TODO OK) else echo  RESULTADO: CON ERRORES (ver arriba)
echo  Fin: %DATE% %TIME%
echo ============================================================

exit /b %ERRORES%

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
::    5.  Venta por Canal (Pronostico de Venta) -> MongoDB
::    6.  Bajas                      -> MongoDB
::    7.  Compras Hist.              -> MongoDB
::    8.  Items                      -> MongoDB
::    9.  Recetas Planta             -> MongoDB
::    10. EBC Obligaciones           -> MongoDB
::    11. EBC EERR (Estado de Resultados) -> MongoDB
::    12. EBC EERR Costo de Venta (Detalle) -> MongoDB
::    13. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB
::    14. Costeo de Recetas                 -> MongoDB
::    15. Seguimiento de Compras            -> MongoDB
::    16. Flujo de Caja                     -> MongoDB
::    17. Tipo de Cambio (SUNAT)            -> MongoDB
::    18. EBC Pagos (promedios)             -> MongoDB
::    19. EBC Adelantos (Por Rendir)        -> MongoDB
::    20. EBC Programacion (por sociedad, solo martes) -> MongoDB
::    21. Saldos Bancarios (carpeta Descargas, "movimiento*" de hoy) -> MongoDB
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
echo [1/21] Sync Excel Pedidos (ADICIONALES + git push)
call "%APP%\sync-excel.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-excel & set ERRORES=1) else echo  OK

:: -- 2. OC Ingresos Actualizacion --
echo.
echo [2/21] OC Ingresos Actualizacion
call "%APP%\sync-oc-ingresos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-oc-ingresos & set ERRORES=1) else echo  OK

:: -- 3. Comparativo OC -> MongoDB --
echo.
echo [3/21] Comparativo OC
call "%APP%\sync-comparativo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-comparativo & set ERRORES=1) else echo  OK

:: -- 4. Ventas / TIP -> MongoDB --
echo.
echo [4/21] Ventas / TIP
call "%APP%\sync-ventas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-ventas & set ERRORES=1) else echo  OK

:: -- 5. Venta por Canal (Pronostico de Venta) -> MongoDB --
echo.
echo [5/21] Venta por Canal - Pronostico de Venta
call "%APP%\sync-venta-canal.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-venta-canal & set ERRORES=1) else echo  OK

:: -- 6. Bajas -> MongoDB --
echo.
echo [6/21] Bajas
call "%APP%\sync-bajas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-bajas & set ERRORES=1) else echo  OK

:: -- 7. Compras Historicas -> MongoDB --
echo.
echo [7/21] Compras Historicas
call "%APP%\scripts\ejecutar-importacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en importacion compras & set ERRORES=1) else echo  OK

:: -- 8. Items -> MongoDB --
echo.
echo [8/21] Items
call "%APP%\sync-items.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-items & set ERRORES=1) else echo  OK

:: -- 9. Recetas Planta -> MongoDB --
echo.
echo [9/21] Recetas Planta
call "%APP%\sync-recetas.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas & set ERRORES=1) else echo  OK

:: -- 10. EBC Obligaciones -> MongoDB --
echo.
echo [10/21] EBC Obligaciones
call "%APP%\sync-obligaciones.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-obligaciones & set ERRORES=1) else echo  OK

:: -- 11. EBC EERR (Estado de Resultados) -> MongoDB --
echo.
echo [11/21] EBC EERR - Estado de Resultados
call "%APP%\sync-eerr.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-eerr ^& set ERRORES=1) else echo  OK

:: -- 12. EBC EERR Costo de Venta (Detalle) -> MongoDB --
echo.
echo [12/21] EBC EERR Costo de Venta - Detalle
call "%APP%\sync-costoventa.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-costoventa & set ERRORES=1) else echo  OK

:: -- 13. Conciliacion de Cobranzas (EECC + Cobranza + TC) -> MongoDB --
echo.
echo [13/21] Conciliacion de Cobranzas
call "%APP%\sync-conciliacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-conciliacion ^& set ERRORES=1) else echo  OK

:: -- 14. Costeo de Recetas -> MongoDB --
echo.
echo [14/21] Costeo de Recetas
call "%APP%\sync-recetas-costeo.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-recetas-costeo & set ERRORES=1) else echo  OK

:: -- 15. Seguimiento de Compras -> MongoDB --
echo.
echo [15/21] Seguimiento de Compras
call "%APP%\sync-seguimiento-compras.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-seguimiento-compras & set ERRORES=1) else echo  OK

:: -- 16. Flujo de Caja -> MongoDB --
echo.
echo [16/21] Flujo de Caja
call "%APP%\sync-flujo-caja.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-flujo-caja & set ERRORES=1) else echo  OK

:: -- 17. Tipo de Cambio (SUNAT) -> MongoDB --
echo.
echo [17/21] Tipo de Cambio
call "%APP%\sync-tipo-cambio.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-tipo-cambio & set ERRORES=1) else echo  OK

:: -- 18. EBC Pagos (promedios) -> MongoDB --
echo.
echo [18/21] EBC Pagos - Promedios
call "%APP%\sync-pagos-promedios.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-pagos-promedios & set ERRORES=1) else echo  OK

:: -- 19. EBC Adelantos (Por Rendir) -> MongoDB --
echo.
echo [19/21] EBC Adelantos - Por Rendir
call "%APP%\sync-adelantos.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-adelantos & set ERRORES=1) else echo  OK

:: -- 20. EBC Programacion (por sociedad, solo martes) -> MongoDB --
echo.
echo [20/21] EBC Programacion - por sociedad (solo martes)
call "%APP%\sync-programacion.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-programacion & set ERRORES=1) else echo  OK

:: -- 21. Saldos Bancarios (carpeta Descargas, archivos "movimiento*" de hoy) -> MongoDB --
echo.
echo [21/21] Saldos Bancarios
call "%APP%\sync-saldo-banco.bat"
if %ERRORLEVEL% NEQ 0 (echo  ERROR en sync-saldo-banco & set ERRORES=1) else echo  OK

:: -- Resumen --
echo.
echo ============================================================
if %ERRORES% EQU 0 (echo  RESULTADO: TODO OK) else echo  RESULTADO: CON ERRORES (ver arriba)
echo  Fin: %DATE% %TIME%
echo ============================================================

exit /b %ERRORES%

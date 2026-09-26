@echo off
echo ============================================================
echo   Indicadores GAF - Recordatorios y vencidos - %date% %time%
echo ============================================================

set APP=C:\pedidos-app

cd /d "%APP%"

node scripts\kpiNotificaciones.js
if %errorlevel%==0 (
  echo OK: Notificaciones de Indicadores GAF enviadas
) else (
  echo ERROR: Fallo el envio de notificaciones de Indicadores GAF
  exit /b 1
)

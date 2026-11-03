@echo off
echo Importando Cobranza Efectivo (ERP) a MongoDB...
cd /d C:\pedidos-app
node scripts\importCobranzaEfectivo.js
if %errorlevel%==0 (echo OK: Cobranza Efectivo importada) else (echo ERROR: importCobranzaEfectivo.js)

// Tarea diaria de Indicadores GAF: recordatorios de captura por vencer (al responsable) y
// resumen de capturas vencidas sin dato (a los destinatarios de alertas). Idempotente: lo
// ya avisado queda en KpiNotificacion y no se repite.
// Corre en sync-master.bat (paso 22) vía sync-kpi-notificaciones.bat.
//   node scripts/kpiNotificaciones.js
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // mismo workaround de DNS que el resto de scripts
const mongoose = require('mongoose');
const connectDB = require('../db');
const { ejecutarDiario } = require('../utils/kpiNotificaciones');

(async () => {
  await connectDB();
  const r = await ejecutarDiario();
  console.log(`Indicadores GAF ${r.hoy}: ${r.recordatorios} recordatorio(s), ${r.vencidos} vencido(s) avisado(s), ${r.correos} correo(s).`);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

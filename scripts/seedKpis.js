// Carga inicial del catálogo de Indicadores GAF (áreas + 40 KPIs con sus metas).
// Correr UNA vez tras el primer deploy del módulo; es idempotente (no duplica ni pisa
// KPIs ya existentes, se puede volver a correr sin riesgo).
//   node scripts/seedKpis.js
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // mismo workaround de DNS que el resto de scripts
const mongoose = require('mongoose');
const connectDB = require('../db');
const { sembrarKpis } = require('../utils/kpiSeed');

(async () => {
  await connectDB();
  const creados = await sembrarKpis('SEED');
  console.log(`Indicadores GAF: ${creados} KPI(s) creados.`);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

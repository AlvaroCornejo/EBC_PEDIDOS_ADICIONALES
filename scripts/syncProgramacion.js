require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { syncProgramacion } = require('../utils/programacionSync');

(async () => {
  const hoy = new Date();
  if (hoy.getDay() !== 2) { // 0=domingo ... 2=martes
    console.log(`Hoy no es martes (${hoy.toLocaleDateString('es-PE')}) - no se genera programacion.`);
    process.exit(0);
  }
  await syncProgramacion('AUTOMATICO (sync-programacion)');
})().catch(err => { console.error(err); process.exit(1); });

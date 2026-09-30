require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { syncProgramacion } = require('../utils/programacionSync');

// Igual que scripts/syncProgramacion.js pero sin el filtro de "solo martes" -
// pensado para correrse a mano, cualquier dia, desde CMD (sync-programacion-manual.bat).
// Sigue sin duplicar: por sociedad, si ya existe programacion para la semana
// actual no genera nada (ver utils/programacionSync.js).
(async () => {
  await syncProgramacion('MANUAL (sync-programacion-manual)');
})().catch(err => { console.error(err); process.exit(1); });

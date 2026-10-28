/**
 * Borra de MongoDB los datos del módulo Cierre de Caja (Sesión 28), que ya no existe en el código:
 *   - se hace DROP de sus 5 colecciones (así se devuelve el espacio en disco; un deleteMany no lo hace)
 *   - se quita el campo `rolesCajaEfectivo` de los usuarios
 *
 * Por seguridad corre en modo simulación (solo cuenta, no borra). Para borrar de verdad:
 *   node scripts/dropCierreCajaEfectivo.js --confirmar
 *
 * No toca ninguna otra colección.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const COLECCIONES = ['turnocajas', 'movimientoefectivocajas', 'envioefectivos', 'cierreoficinadiarios', 'cajaefectivoconfigs'];
const CONFIRMAR = process.argv.includes('--confirmar');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(CONFIRMAR ? '*** MODO BORRADO ***' : 'Modo simulación (no se borra nada). Usa --confirmar para borrar.');
  console.log(`Base: ${db.databaseName}\n`);

  const existentes = new Set((await db.listCollections().toArray()).map(c => c.name));
  for (const nombre of COLECCIONES) {
    if (!existentes.has(nombre)) { console.log(`  ${nombre.padEnd(26)} no existe`); continue; }
    const n = await db.collection(nombre).countDocuments();
    if (CONFIRMAR) { await db.collection(nombre).drop(); console.log(`  ${nombre.padEnd(26)} ${String(n).padStart(7)} docs → colección eliminada`); }
    else console.log(`  ${nombre.padEnd(26)} ${String(n).padStart(7)} docs → se eliminaría`);
  }

  const conCampo = await db.collection('users').countDocuments({ rolesCajaEfectivo: { $exists: true } });
  if (CONFIRMAR) {
    const r = await db.collection('users').updateMany({ rolesCajaEfectivo: { $exists: true } }, { $unset: { rolesCajaEfectivo: '' } });
    console.log(`\n  users.rolesCajaEfectivo: campo quitado en ${r.modifiedCount} usuario(s)`);
  } else console.log(`\n  users.rolesCajaEfectivo: se quitaría en ${conCampo} usuario(s)`);

  await mongoose.disconnect();
  console.log(CONFIRMAR ? '\nListo.' : '\nSimulación terminada. Si todo está bien: node scripts/dropCierreCajaEfectivo.js --confirmar');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });

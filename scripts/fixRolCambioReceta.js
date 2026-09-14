/**
 * Fix puntual: algunos usuarios quedaron con rolCambioReceta guardado como
 * array ([]) en Mongo, de antes de que el campo se migrara a string simple
 * (ver CLAUDE.md, Sesión 14). Cualquier user.save() sobre esos documentos
 * (ej. cambiar contraseña) dispara un error de validación de Mongoose
 * ("Cast to string failed for value \"[]\" (type Array)"). Este script
 * normaliza esos documentos directamente en Mongo (update crudo, sin pasar
 * por el schema, para no repetir el mismo error de casteo al leer).
 *
 * Uso:
 *   node scripts/fixRolCambioReceta.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const col = mongoose.connection.collection('users');

  const afectados = await col.find({ rolCambioReceta: { $type: 'array' } }).toArray();
  console.log(`Usuarios con rolCambioReceta como array: ${afectados.length}`);
  afectados.forEach(u => console.log(` - ${u.username}: ${JSON.stringify(u.rolCambioReceta)}`));

  for (const u of afectados) {
    const arr = u.rolCambioReceta || [];
    let nuevo = '';
    if (arr.length === 1) nuevo = arr[0];
    else if (arr.length > 1) nuevo = 'admin'; // admin = los 3 pasos a la vez (ver Sesión 14)
    await col.updateOne({ _id: u._id }, { $set: { rolCambioReceta: nuevo } });
    console.log(`   -> ${u.username}: array => "${nuevo}"`);
  }

  const restantes = await col.countDocuments({ rolCambioReceta: { $type: 'array' } });
  console.log(`\nRestantes con tipo array (debería ser 0): ${restantes}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

/**
 * Borrado de datos de la colección VentasTip, módulo eliminado en la
 * Sesión 25 (ver CLAUDE.md). Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_cleanup_ventastip.js
 * Borrar este archivo después de correrlo una vez.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const schemaVacio = new mongoose.Schema({}, { strict: false });
  const VentasTip = mongoose.model('VentasTip', schemaVacio);
  const res = await VentasTip.deleteMany({});
  console.log(`✓ ${VentasTip.collection.collectionName}: ${res.deletedCount} documentos borrados`);

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

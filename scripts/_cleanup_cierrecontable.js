/**
 * Borrado de datos del módulo Cierre Contable, eliminado en la Sesión 17
 * (ver CLAUDE.md). Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_cleanup_cierrecontable.js
 * Borrar este archivo después de correrlo una vez.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');

const NOMBRES_MODELO = [
  'Proceso', 'Actividad', 'CierreMensual', 'ActividadCierre',
  'AsignacionResponsable', 'AsignacionConsulta', 'Adjunto', 'DiaNoLaborable',
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const schemaVacio = new mongoose.Schema({}, { strict: false });
  for (const nombre of NOMBRES_MODELO) {
    const Modelo = mongoose.model(nombre, schemaVacio);
    const res = await Modelo.deleteMany({});
    console.log(`✓ ${Modelo.collection.collectionName}: ${res.deletedCount} documentos borrados`);
  }

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

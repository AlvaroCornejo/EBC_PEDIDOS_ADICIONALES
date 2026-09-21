/**
 * Borrado de datos de los 6 módulos eliminados en la Sesión 16 (ver CLAUDE.md).
 * Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_cleanup_6modulos.js
 * Borrar este archivo después de correrlo una vez.
 *
 * Usa mongoose.model(nombre, ...) sin especificar colección explícita, igual
 * que los modelos originales (ya borrados) — así el nombre de colección se
 * deriva exactamente igual (pluralización automática de Mongoose) sin tener
 * que adivinarlo a mano.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');

const NOMBRES_MODELO = [
  'CajaConfig', 'CierreCaja', 'EnvioOficina', 'DepositoBancario',
  'ObligacionEBC',
  'MaestroLinea', 'MaestroFamilia', 'MaestroSubFamilia', 'MaestroTipoItem',
  'MaestroUM', 'MaestroItem', 'MaestroItemSociedad', 'MaestroItemSolicitud', 'MaestroCuenta',
  'VentaForecast',
  'SeguimientoCompraMovimiento', 'SeguimientoCompraOC', 'GrupoCompraEspecial',
  'VentaCanalDiaria',
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

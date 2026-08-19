/**
 * Import diario de Flujo de Caja: lee las 2 carpetas configuradas en
 * Admin → Flujo de Caja → Rutas (Estado de Cuenta y Pagos ERP), importa
 * TODOS los archivos encontrados en ambas, y corre la reconciliación
 * automática (métodos 1 y 2) al final para cada sociedad afectada.
 *
 * Uso: node scripts/importFlujoCaja.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const {
  listarDisponibles, obtenerMapaCias,
  importarArchivoEstadoCuenta, importarArchivoPagosERP, reconciliar,
} = require('../utils/flujoCajaSync');

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const { rutaEstadoCuenta, rutaPagosERP, estadoCuenta, pagosERP } = await listarDisponibles();
  if (!rutaEstadoCuenta && !rutaPagosERP) {
    console.log('No hay rutas configuradas (Admin → Flujo de Caja → Rutas) — nada que importar.');
    await mongoose.disconnect();
    return;
  }

  const sociedadesTocadas = new Set();

  console.log(`=== Estado de Cuenta (${rutaEstadoCuenta || 'sin configurar'}) ===`);
  for (const a of estadoCuenta) {
    if (a.error) { console.log(`  ⚠ ${a.nombreArchivo}: ${a.error}`); continue; }
    try {
      const n = await importarArchivoEstadoCuenta(a);
      sociedadesTocadas.add(a.sociedad);
      console.log(`  ${a.sociedad} ${a.banco} ${a.moneda}: ${n} movimientos`);
    } catch (e) {
      console.log(`  ${a.sociedad} ${a.banco} ${a.moneda}: ERROR — ${e.message}`);
    }
  }

  console.log(`\n=== Pagos ERP (${rutaPagosERP || 'sin configurar'}) ===`);
  if (pagosERP.length) {
    const mapaCias = await obtenerMapaCias();
    for (const a of pagosERP) {
      try {
        const resumen = await importarArchivoPagosERP(a.archivo, mapaCias);
        Object.entries(resumen).forEach(([sociedad, n]) => {
          sociedadesTocadas.add(sociedad);
          console.log(`  ${sociedad}: ${n} filas`);
        });
      } catch (e) {
        console.log(`  ${a.nombreArchivo}: ERROR — ${e.message}`);
      }
    }
  }

  console.log('\n=== Reconciliación ===');
  for (const sociedad of sociedadesTocadas) {
    try {
      const r = await reconciliar(sociedad);
      console.log(`  ${sociedad}: ${r.porGlosa} por glosa, ${r.porERP} por ERP, ${r.sinAsignar} sin asignar`);
    } catch (e) {
      console.log(`  ${sociedad}: ERROR — ${e.message}`);
    }
  }

  await mongoose.disconnect();
  console.log('\n✅ Import de Flujo de Caja completado.');
}

main().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1); });

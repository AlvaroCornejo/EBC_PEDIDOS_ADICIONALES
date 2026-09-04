/**
 * Importación diaria de Saldos Bancarios — lee los archivos "movimientos*"
 * de la carpeta Descargas del servidor (configurable en Admin, key
 * "saldoBancoRutaDescargas" en la colección Config) que se hayan modificado
 * HOY, detecta el banco por estructura (no por nombre) y reemplaza el
 * snapshot de movimientos de cada cuenta reconocida en el catálogo
 * SaldoCuentaBanco. Cuentas que aparecen en un archivo pero no están en el
 * catálogo se reportan y se saltan (hay que darlas de alta en Admin primero).
 *
 * Uso:
 *   node scripts/importSaldoBanco.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const Config               = require('../models/Config');
const SaldoCuentaBanco     = require('../models/SaldoCuentaBanco');
const SaldoBancoMovimiento = require('../models/SaldoBancoMovimiento');
const { leerArchivoMovimientos, listarArchivosDeHoy } = require('../utils/saldoBancoImport');

const CONFIG_KEY = 'saldoBancoRutaDescargas';
const RUTA_DEFAULT = 'C:\\Users\\CORP.PROCESOS\\Downloads';

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const cfg = await Config.findOne({ key: CONFIG_KEY }).lean();
  const ruta = cfg?.value || RUTA_DEFAULT;
  console.log(`Carpeta Descargas: ${ruta}`);

  const archivos = listarArchivosDeHoy(ruta);
  console.log(`Archivos "movimiento*" de hoy encontrados: ${archivos.length}\n`);
  if (!archivos.length) { await mongoose.disconnect(); return; }

  const catalogo = await SaldoCuentaBanco.find({}).lean();
  const catalogoPorCuenta = Object.fromEntries(catalogo.map(c => [c.cuenta, c]));

  let ok = 0, sinMapear = 0, errores = 0;
  for (const a of archivos) {
    try {
      const r = await leerArchivoMovimientos(a.archivo);
      const cat = catalogoPorCuenta[r.cuenta];
      if (!cat) {
        console.log(`⚠️  ${a.nombreArchivo}: cuenta "${r.cuenta}" (${r.banco}) no está en el catálogo SaldoCuentaBanco — se omite. Dar de alta en Admin → Saldos Bancarios.`);
        sinMapear++;
        continue;
      }
      const docs = r.movimientos.map(m => ({
        cuenta: r.cuenta, sociedad: cat.sociedad, banco: cat.banco, moneda: cat.moneda,
        fecha: m.fecha, glosa: m.glosa, importe: m.importe, saldo: m.saldo,
      }));
      await SaldoBancoMovimiento.deleteMany({ cuenta: r.cuenta });
      if (docs.length) await SaldoBancoMovimiento.insertMany(docs, { ordered: false });
      console.log(`✓ ${a.nombreArchivo}: ${r.banco} · ${cat.sociedad} · ${r.cuenta} · ${r.moneda} — ${docs.length} movimientos`);
      ok++;
    } catch (err) {
      console.log(`❌ ${a.nombreArchivo}: ${err.message}`);
      errores++;
    }
  }

  console.log(`\nResumen: ${ok} cuenta(s) importadas, ${sinMapear} sin mapear, ${errores} con error.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

/**
 * Import diario de Flujo de Caja: recorre FlujoConfig de todas las
 * sociedades, importa Pagos ERP (PagosSpring.xls) + cada archivo de banco
 * configurado, y corre la reconciliación automática (métodos 1 y 2) al
 * final de cada sociedad.
 *
 * Uso: node scripts/importFlujoCaja.js
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const FlujoConfig             = require('../models/FlujoConfig');
const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoPagoERP            = require('../models/FlujoPagoERP');
const CompaniaCodigo          = require('../models/CompaniaCodigo');

const { leerMovimientoBanco, leerPagosERP } = require('../utils/flujoCajaImport');
const { reconciliar } = require('../utils/flujoCajaReconciliar');

const BATCH = 2000;

async function importarBanco(sociedad, banco, moneda, ruta) {
  const movs = await leerMovimientoBanco(banco, ruta);
  await FlujoMovimientoBancario.deleteMany({ sociedad, banco, moneda });
  const docs = movs.map(m => ({ sociedad, banco, moneda, ...m }));
  for (let i = 0; i < docs.length; i += BATCH) {
    await FlujoMovimientoBancario.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  return docs.length;
}

async function importarPagosERP(sociedad, ruta, mapaCias) {
  const filas = leerPagosERP(ruta);
  const propias = filas.filter(f => {
    const cod = f.companiaCodigo.padStart(6, '0');
    return mapaCias[cod] === sociedad;
  });
  await FlujoPagoERP.deleteMany({ sociedad });
  const docs = propias.map(f => ({
    sociedad,
    cuentaBancaria: f.cuentaBancaria,
    numeroPago: f.numeroPago,
    pagarA: f.pagarA,
    moneda: f.moneda,
    fechaPago: f.fechaPago,
    montoLocal: f.montoLocal,
    montoExtranjero: f.montoExtranjero,
    tipoPago: f.tipoPago,
    voucherPago: f.voucherPago,
  }));
  for (let i = 0; i < docs.length; i += BATCH) {
    await FlujoPagoERP.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  return docs.length;
}

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const companias = await CompaniaCodigo.find({}).lean();
  const mapaCias = Object.fromEntries(companias.map(c => [c.codigo, c.compania]));

  const configs = await FlujoConfig.find({}).lean();
  if (!configs.length) {
    console.log('No hay sociedades configuradas en FlujoConfig — nada que importar.');
    await mongoose.disconnect();
    return;
  }

  for (const cfg of configs) {
    console.log(`=== ${cfg.sociedad} ===`);

    if (cfg.rutaPagosERP) {
      try {
        const n = await importarPagosERP(cfg.sociedad, cfg.rutaPagosERP, mapaCias);
        console.log(`  Pagos ERP: ${n} filas`);
      } catch (e) {
        console.log(`  Pagos ERP: ERROR — ${e.message}`);
      }
    }

    for (const { banco, moneda, ruta } of cfg.archivosBanco || []) {
      try {
        const n = await importarBanco(cfg.sociedad, banco, moneda, ruta);
        console.log(`  ${banco} ${moneda}: ${n} movimientos`);
      } catch (e) {
        console.log(`  ${banco} ${moneda}: ERROR — ${e.message}`);
      }
    }

    try {
      const r = await reconciliar(cfg.sociedad);
      console.log(`  Reconciliación: ${r.porGlosa} por glosa, ${r.porERP} por ERP, ${r.sinAsignar} sin asignar`);
    } catch (e) {
      console.log(`  Reconciliación: ERROR — ${e.message}`);
    }

    console.log('');
  }

  await mongoose.disconnect();
  console.log('✅ Import de Flujo de Caja completado.');
}

main().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1); });

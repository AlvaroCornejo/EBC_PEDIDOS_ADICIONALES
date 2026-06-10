/**
 * Script de importación de datos de compras históricas a MongoDB.
 * Ejecutar UNA VEZ (o cuando se actualice el archivo Excel):
 *
 *   node scripts/importCompras.js "C:\ruta\al\archivo.xlsx"
 *
 * Requiere que MONGODB_URI esté en .env o como variable de entorno.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Google DNS — evita bloqueo SRV del router
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const path     = require('path');

const CompraItem   = require('../models/CompraItem');
const CompraPareto = require('../models/CompraPareto');
const CompraRoc    = require('../models/CompraRoc');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC COMPRAS\\EBC COMPRAS HISTORICAS.xlsx';

const BATCH = 5000; // filas por lote al insertar ROC

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel (puede tardar unos segundos)...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  // ── ITEMS ────────────────────────────────────────────────────────
  console.log('Importando hoja ITEMS...');
  const wsItems = wb.getWorksheet('ITEMS');
  const items = [];
  wsItems.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const itemVal = row.getCell(1).value;
    if (!itemVal) return;
    items.push({
      item:         typeof itemVal === 'object' ? itemVal?.result ?? itemVal : Number(itemVal),
      nombre:       String(row.getCell(2).value || '').trim(),
      grupoCompra:  String(row.getCell(3).value || '').trim(),
      grupo:        String(row.getCell(4).value || '').trim(),
      grupoFamilia: String(row.getCell(5).value || '').trim(),
    });
  });
  await CompraItem.deleteMany({});
  await CompraItem.insertMany(items, { ordered: false });
  console.log(`  ✓ ${items.length} items importados.\n`);

  // ── BASE_PARETO ──────────────────────────────────────────────────
  console.log('Importando hoja BASE_PARETO...');
  const wsPareto = wb.getWorksheet('BASE_PARETO');
  const pareto = [];
  if (wsPareto) {
    wsPareto.eachRow((row, i) => {
      if (i === 1) return;
      const oper = row.getCell(1).value;   // col 1 = OPERACION
      const item = row.getCell(2).value;
      const bp   = row.getCell(3).value;
      if (!oper || !item) return;
      pareto.push({
        operacion:  String(typeof oper === 'object' ? oper?.result ?? oper : oper).trim(),
        item:       Number(typeof item === 'object' ? item?.result ?? item : item),
        basePareto: Number(typeof bp   === 'object' ? bp?.result   ?? bp   : bp) || 0,
      });
    });
  }
  // Solo reemplazar si el Excel trae datos — evita borrar datos existentes con un Excel incompleto
  const paretoExistente = await CompraPareto.countDocuments();
  if (pareto.length > 0) {
    await CompraPareto.deleteMany({});
    await CompraPareto.insertMany(pareto, { ordered: false });
    console.log(`  ✓ ${pareto.length} registros Pareto importados.\n`);
  } else {
    console.log(`  ⚠ Hoja BASE_PARETO vacía — se conservan ${paretoExistente} registros existentes.\n`);
  }

  // ── ROC (tabla grande) ───────────────────────────────────────────
  console.log('Importando hoja ROC (316K filas, paciencia)...');
  const wsRoc = wb.getWorksheet('ROC');
  const rows  = [];
  if (wsRoc) {
    wsRoc.eachRow((row, i) => {
      if (i === 1) return;
      const soc  = row.getCell(1).value;
      const item = row.getCell(4).value;
      const fRaw = row.getCell(5).value;
      if (!soc || !item) return;
      const fecha = fRaw instanceof Date ? fRaw : (fRaw ? new Date(fRaw) : null);
      if (!fecha || isNaN(fecha)) return;
      rows.push({
        sociedad:  String(typeof soc  === 'object' ? soc?.result  ?? soc  : soc).trim(),
        operacion: String(row.getCell(2).value || '').trim(),
        almacen:   String(row.getCell(3).value || '').trim(),
        item:      Number(typeof item === 'object' ? item?.result ?? item : item),
        fecha,
        importe:   Number(row.getCell(6).value) || 0,
        cantidad:  Number(row.getCell(7).value) || 0,
      });
    });
  }
  // Solo reemplazar si el Excel trae datos — evita borrar datos existentes con un Excel incompleto
  const rocExistente = await CompraRoc.countDocuments();
  if (rows.length > 0) {
    await CompraRoc.deleteMany({});
    let imported = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      await CompraRoc.insertMany(rows.slice(i, i + BATCH), { ordered: false });
      imported += Math.min(BATCH, rows.length - i);
      process.stdout.write(`\r  ${imported.toLocaleString()} / ${rows.length.toLocaleString()} filas`);
    }
    console.log(`\n  ✓ ${imported.toLocaleString()} transacciones ROC importadas.\n`);
  } else {
    console.log(`  ⚠ Hoja ROC vacía — se conservan ${rocExistente} registros existentes.\n`);
  }

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

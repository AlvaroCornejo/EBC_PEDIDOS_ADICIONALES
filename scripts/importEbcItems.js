/**
 * Importación diaria de EBC ITEMS.xlsx (hojas "MAESTRO_ITEMS" e
 * "ITEMS_POR_OPERACION") a MongoDB. Ambas tablas se reemplazan por completo
 * en cada corrida.
 *
 * Uso:
 *   node scripts/importEbcItems.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const ItemMaestro      = require('../models/ItemMaestro');
const ItemPorOperacion = require('../models/ItemPorOperacion');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC ITEMS\\EBC ITEMS.xlsx';

const BATCH = 2000;
const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const norm = s => String(s ?? '').trim().toUpperCase();

function leerEncabezado(ws) {
  const header = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { header[norm(cellVal(cell.value))] = col; });
  return header;
}
function colFn(header) {
  return (...nombres) => { for (const n of nombres) if (header[n] !== undefined) return header[n]; return undefined; };
}

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel (puede tardar unos segundos)...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  // ── Hoja MAESTRO_ITEMS (global, sin operación) ──────────────────────────
  const wsMaestro = wb.getWorksheet('MAESTRO_ITEMS');
  if (!wsMaestro) throw new Error('No se encontró la hoja "MAESTRO_ITEMS"');
  const hM = leerEncabezado(wsMaestro);
  const colM = colFn(hM);
  const COLM = { item: colM('ITEM'), nombre: colM('NOMBRE'), grupoCompra: colM('GRUPOCOMPRA'), grupo: colM('GRUPO') };
  const faltantesM = Object.entries(COLM).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesM.length) throw new Error(`"MAESTRO_ITEMS": no se encontraron las columnas: ${faltantesM.join(', ')}`);

  const maestroDocs = [];
  const vistosM = new Set();
  let rechazadasM = 0, duplicadosM = 0;
  wsMaestro.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const item = str(v[COLM.item]);
    if (!item) { rechazadasM++; return; }
    if (vistosM.has(item)) { duplicadosM++; return; }
    vistosM.add(item);
    maestroDocs.push({
      item, nombre: str(v[COLM.nombre]), grupoCompra: str(v[COLM.grupoCompra]), grupo: str(v[COLM.grupo]),
    });
  });
  console.log(`"MAESTRO_ITEMS": ${maestroDocs.length} filas válidas, ${rechazadasM} rechazadas, ${duplicadosM} duplicadas (se conservó la primera).`);

  await ItemMaestro.deleteMany({});
  for (let i = 0; i < maestroDocs.length; i += BATCH) {
    await ItemMaestro.insertMany(maestroDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${maestroDocs.length.toLocaleString()} filas en ItemMaestro.\n`);

  // ── Hoja ITEMS_POR_OPERACION ─────────────────────────────────────────────
  const wsOp = wb.getWorksheet('ITEMS_POR_OPERACION');
  if (!wsOp) throw new Error('No se encontró la hoja "ITEMS_POR_OPERACION"');
  const hO = leerEncabezado(wsOp);
  const colO = colFn(hO);
  const COLO = { operacion: colO('OPERACION', 'OPERACIÓN'), item: colO('ITEM'), nombre: colO('NOMBRE'), grupoCompra: colO('GRUPOCOMPRA'), grupo: colO('GRUPO') };
  const faltantesO = Object.entries(COLO).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesO.length) throw new Error(`"ITEMS_POR_OPERACION": no se encontraron las columnas: ${faltantesO.join(', ')}`);

  const opDocs = [];
  const vistosO = new Set();
  let rechazadasO = 0, duplicadosO = 0;
  wsOp.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COLO.operacion]);
    const item = str(v[COLO.item]);
    if (!operacion || !item) { rechazadasO++; return; }
    const clave = `${operacion}|${item}`;
    if (vistosO.has(clave)) { duplicadosO++; return; }
    vistosO.add(clave);
    opDocs.push({
      operacion, item, nombre: str(v[COLO.nombre]), grupoCompra: str(v[COLO.grupoCompra]), grupo: str(v[COLO.grupo]),
    });
  });
  console.log(`"ITEMS_POR_OPERACION": ${opDocs.length} filas válidas, ${rechazadasO} rechazadas, ${duplicadosO} duplicadas (se conservó la primera).`);

  await ItemPorOperacion.deleteMany({});
  for (let i = 0; i < opDocs.length; i += BATCH) {
    await ItemPorOperacion.insertMany(opDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${opDocs.length.toLocaleString()} filas en ItemPorOperacion.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

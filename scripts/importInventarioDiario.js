/**
 * Importación diaria de EBC SALDO AL DIA.xlsx (hoja "CONTEO") a MongoDB —
 * conteo físico vs. saldo de sistema por operación y almacén/área. Se
 * reemplaza por completo en cada corrida (no guarda historia).
 *
 * Uso:
 *   node scripts/importInventarioDiario.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const InventarioDiario = require('../models/InventarioDiario');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC SALDOS\\EBC SALDO AL DIA.xlsx';

const BATCH = 2000;
const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : 0; };
const norm = s => String(s ?? '').trim().toUpperCase();

// Las columnas se resuelven por nombre, no por posición fija — mismo criterio
// que el resto de los import de esta app (ver importRecetasCosteo.js).
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
  console.log('Leyendo Excel...');
  await wb.xlsx.readFile(FILE_PATH);

  const ws = wb.getWorksheet('CONTEO');
  if (!ws) throw new Error('No se encontró la hoja "CONTEO"');
  const hdr = leerEncabezado(ws);
  const col = colFn(hdr);
  const COL = {
    almacen: col('ALMACEN'), area: col('AREA'), item: col('ITEM'),
    conteo: col('CONTEO'), saldo: col('SALDO'),
  };
  const faltantes = Object.entries(COL).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantes.length) throw new Error(`"CONTEO": no se encontraron las columnas: ${faltantes.join(', ')}`);

  const docs = [];
  let rechazadas = 0;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COL.almacen]);
    const almacen = str(v[COL.area]);
    const item = str(v[COL.item]);
    if (!operacion || !almacen || !item) { rechazadas++; return; }
    docs.push({ operacion, almacen, item, conteo: num(v[COL.conteo]), saldo: num(v[COL.saldo]) });
  });
  console.log(`"CONTEO": ${docs.length} filas válidas, ${rechazadas} rechazadas (sin operación/almacén/ítem).`);

  console.log('\nReemplazando InventarioDiario...');
  await InventarioDiario.deleteMany({});
  for (let i = 0; i < docs.length; i += BATCH) {
    await InventarioDiario.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${docs.length.toLocaleString()} filas cargadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

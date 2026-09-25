/**
 * Importación diaria de EBC CONTEOS.xlsx (hoja "CONTEO") a MongoDB —
 * histórico semanal de conteo/importe por operación, almacén e ítem. Se
 * reemplaza por completo en cada corrida (no guarda historia propia en
 * Mongo, ya viene con varias semanas en el mismo Excel).
 *
 * Uso:
 *   node scripts/importInventarioSemanal.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const InventarioSemanal = require('../models/InventarioSemanal');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC SALDOS\\EBC CONTEOS.xlsx';

const BATCH = 2000;
const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : 0; };
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

  const ws = wb.getWorksheet('CONTEO');
  if (!ws) throw new Error('No se encontró la hoja "CONTEO"');
  const hdr = leerEncabezado(ws);
  const col = colFn(hdr);
  const COL = {
    operacion: col('OPERACION', 'OPERACIÓN'), almacen: col('ALMACEN', 'ALMACÉN'), item: col('ITEM'),
    anio: col('AÑO', 'ANIO', 'ANO'), semana: col('SEMANA'), conteo: col('CONTEO'), importe: col('IMPORTE'),
  };
  const faltantes = Object.entries(COL).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantes.length) throw new Error(`"CONTEO": no se encontraron las columnas: ${faltantes.join(', ')}`);

  const docs = [];
  let rechazadas = 0;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COL.operacion]);
    const almacen = str(v[COL.almacen]);
    const item = str(v[COL.item]);
    const anio = num(v[COL.anio]);
    const semana = num(v[COL.semana]);
    if (!operacion || !almacen || !item || !anio || !semana) { rechazadas++; return; }
    docs.push({ operacion, almacen, item, anio, semana, conteo: num(v[COL.conteo]), importe: num(v[COL.importe]) });
  });
  console.log(`"CONTEO": ${docs.length} filas válidas, ${rechazadas} rechazadas (sin operación/almacén/ítem/año/semana).`);

  console.log('\nReemplazando InventarioSemanal...');
  await InventarioSemanal.deleteMany({});
  for (let i = 0; i < docs.length; i += BATCH) {
    await InventarioSemanal.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${docs.length.toLocaleString()} filas cargadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

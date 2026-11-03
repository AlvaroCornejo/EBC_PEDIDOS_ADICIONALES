/**
 * Importación diaria de EBC COBRANZA EFECTIVO.xlsx (hoja "EFECTIVO_VENTA") a
 * MongoDB — cobranza en efectivo registrada en el ERP (sin TIP), usada en
 * Cierre de Caja (Contabilidad/Gerencia) para comparar contra la venta en
 * efectivo registrada en el módulo. Se reemplaza por completo en cada
 * corrida (el Excel ya trae el histórico completo, no se acumula historia propia).
 * Solo se carga desde FECHA_MINIMA (el módulo Cierre de Caja recién arrancó ese
 * mes; el histórico del Excel desde 2020 no es comparable, no hay nada que cruzar).
 *
 * Uso:
 *   node scripts/importCobranzaEfectivo.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const CobranzaEfectivoErp = require('../models/CobranzaEfectivoErp');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC CIERRE CAJA\\EBC COBRANZA EFECTIVO.xlsx';

const FECHA_MINIMA = new Date('2026-11-01');
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
  await wb.xlsx.readFile(FILE_PATH);

  const ws = wb.getWorksheet('EFECTIVO_VENTA');
  if (!ws) throw new Error('No se encontró la hoja "EFECTIVO_VENTA"');
  const c = colFn(leerEncabezado(ws));
  const COL = { fecha: c('FECHACOBRANZA'), efectivo: c('EFECTIVO'), operacion: c('OPERACION', 'OPERACIÓN') };
  const faltantes = Object.entries(COL).filter(([, v]) => v === undefined).map(([k]) => k);
  if (faltantes.length) throw new Error(`"EFECTIVO_VENTA": no se encontraron las columnas: ${faltantes.join(', ')}`);

  const docs = [];
  let rechazadas = 0, fueraDeRango = 0;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COL.operacion]);
    const fechaRaw = v[COL.fecha];
    if (!operacion || !fechaRaw) { rechazadas++; return; }
    const fecha = fechaRaw instanceof Date ? fechaRaw : new Date(fechaRaw);
    if (fecha < FECHA_MINIMA) { fueraDeRango++; return; }
    docs.push({ operacion, fecha, efectivo: num(v[COL.efectivo]) });
  });
  console.log(`"EFECTIVO_VENTA": ${docs.length} filas válidas desde ${FECHA_MINIMA.toISOString().slice(0, 10)}, ${fueraDeRango} anteriores omitidas, ${rechazadas} rechazadas.`);

  console.log('Reemplazando CobranzaEfectivoErp...');
  await CobranzaEfectivoErp.deleteMany({});
  for (let i = 0; i < docs.length; i += BATCH) {
    await CobranzaEfectivoErp.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${docs.length.toLocaleString()} filas cargadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

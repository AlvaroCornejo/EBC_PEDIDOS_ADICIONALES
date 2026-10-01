/**
 * Importación diaria de EBC VENTAS.xlsx (hojas "VENTA" y "TIP") a MongoDB.
 * Ambas colecciones se reemplazan por completo en cada corrida (el Excel ya
 * trae el histórico completo desde 2020, no se acumula historia propia).
 *
 * Uso:
 *   node scripts/importVentas.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const VentaDiaria = require('../models/VentaDiaria');
const TipDiario    = require('../models/TipDiario');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC VENTAS\\EBC VENTAS.xlsx';

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
  console.log('Leyendo Excel (puede tardar, es un archivo grande)...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  // ── Hoja VENTA ───────────────────────────────────────────────────────────
  const wsV = wb.getWorksheet('VENTA');
  if (!wsV) throw new Error('No se encontró la hoja "VENTA"');
  const hV = leerEncabezado(wsV);
  const colV = colFn(hV);
  const COLV = {
    operacion: colV('OPERACION', 'OPERACIÓN'), canal: colV('CANAL'), fecha: colV('FECHA'),
    tipoDoc: colV('TIPODOCUMENTO'), turno: colV('TURNO'), pax: colV('PAX'),
    tickets: colV('TICKETS'), venta: colV('VENTA'), permanencia: colV('PERMANENCIA'),
  };
  const faltantesV = Object.entries(COLV).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesV.length) throw new Error(`"VENTA": no se encontraron las columnas: ${faltantesV.join(', ')}`);

  const ventaDocs = [];
  let rechazadasV = 0;
  wsV.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COLV.operacion]);
    const canal = str(v[COLV.canal]);
    const fechaRaw = v[COLV.fecha];
    const tipoDoc = norm(str(v[COLV.tipoDoc]));
    if (!operacion || !canal || !fechaRaw || (tipoDoc !== 'VENTA' && tipoDoc !== 'CORTESIA')) { rechazadasV++; return; }
    ventaDocs.push({
      operacion, canal,
      fecha: fechaRaw instanceof Date ? fechaRaw : new Date(fechaRaw),
      tipoDocumento: tipoDoc, turno: str(v[COLV.turno]),
      pax: num(v[COLV.pax]), tickets: num(v[COLV.tickets]),
      venta: num(v[COLV.venta]), permanencia: num(v[COLV.permanencia]),
    });
  });
  console.log(`"VENTA": ${ventaDocs.length} filas válidas, ${rechazadasV} rechazadas.`);

  console.log('Reemplazando VentaDiaria...');
  await VentaDiaria.deleteMany({});
  for (let i = 0; i < ventaDocs.length; i += BATCH) {
    await VentaDiaria.insertMany(ventaDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${ventaDocs.length.toLocaleString()} filas cargadas.\n`);

  // ── Hoja TIP ─────────────────────────────────────────────────────────────
  const wsT = wb.getWorksheet('TIP');
  if (!wsT) throw new Error('No se encontró la hoja "TIP"');
  const hT = leerEncabezado(wsT);
  const colT = colFn(hT);
  const COLT = {
    operacion: colT('OPERACION', 'OPERACIÓN'), fecha: colT('FECHA'),
    tipEfeSol: colT('TIP_EFE_SOL'), tipTcSol: colT('TIP_TC_SOL'), tipEfeDol: colT('TIP_EFE_DOL'),
  };
  const faltantesT = Object.entries(COLT).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesT.length) throw new Error(`"TIP": no se encontraron las columnas: ${faltantesT.join(', ')}`);

  const tipDocs = [];
  let rechazadasT = 0;
  wsT.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const operacion = str(v[COLT.operacion]);
    const fechaRaw = v[COLT.fecha];
    if (!operacion || !fechaRaw) { rechazadasT++; return; }
    tipDocs.push({
      operacion, fecha: fechaRaw instanceof Date ? fechaRaw : new Date(fechaRaw),
      tipEfeSol: num(v[COLT.tipEfeSol]), tipTcSol: num(v[COLT.tipTcSol]), tipEfeDol: num(v[COLT.tipEfeDol]),
    });
  });
  console.log(`"TIP": ${tipDocs.length} filas válidas, ${rechazadasT} rechazadas.`);

  console.log('Reemplazando TipDiario...');
  await TipDiario.deleteMany({});
  for (let i = 0; i < tipDocs.length; i += BATCH) {
    await TipDiario.insertMany(tipDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${tipDocs.length.toLocaleString()} filas cargadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

/**
 * Importación de EBC BASE SEGUIMIENTO DE COMPRAS.xlsx a MongoDB (hojas MOVIMIENTOS y OC,
 * fuente del módulo Aprobación y Seguimiento de Compras).
 *
 * Solo se importan filas con GRUPO === 'FC' (se descartan las 'SD').
 *
 * Uso:
 *   node scripts/importSeguimientoCompras.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const SeguimientoCompraMovimiento = require('../models/SeguimientoCompraMovimiento');
const SeguimientoCompraOC         = require('../models/SeguimientoCompraOC');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC SEGUIMIENTO DE COMPRAS\\EBC BASE SEGUIMIENTO DE COMPRAS.xlsx';

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
  console.log('Excel cargado.\n');
  console.log('Hojas encontradas:', wb.worksheets.map(s => `"${s.name}"`).join(', '));

  // ── Hoja MOVIMIENTOS ────────────────────────────────────────────────────────
  const wsMov = wb.getWorksheet('MOVIMIENTOS');
  if (!wsMov) throw new Error('No se encontró la hoja "MOVIMIENTOS"');
  const hMov = leerEncabezado(wsMov);
  const colM = colFn(hMov);
  const COLM = {
    grupo:        colM('GRUPO'),
    grupoGeneral: colM('GRUPO GENERAL'),
    grupoCompra:  colM('GRUPO COMPRA'),
    operacion:    colM('OPERACION', 'OPERACIÓN'),
    movimiento:   colM('MOVIMIENTO'),
    año:          colM('AÑO', 'ANO'),
    semana:       colM('SEMANA'),
    cantidad:     colM('CANTIDAD'),
    importe:      colM('IMPORTE'),
  };
  const faltantesM = Object.entries(COLM).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesM.length) throw new Error(`"MOVIMIENTOS": no se encontraron las columnas: ${faltantesM.join(', ')}`);

  const movDocs = [];
  let movRechazadas = 0, movSD = 0;
  wsMov.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const grupo = str(v[COLM.grupo]);
    if (grupo !== 'FC') { movSD++; return; }
    const operacion = str(v[COLM.operacion]);
    const movimiento = str(v[COLM.movimiento]);
    const año = num(v[COLM.año]);
    const semana = num(v[COLM.semana]);
    if (!operacion || !movimiento || !año || !semana) { movRechazadas++; return; }
    movDocs.push({
      grupo, grupoGeneral: str(v[COLM.grupoGeneral]), grupoCompra: str(v[COLM.grupoCompra]),
      operacion, movimiento, año, semana,
      cantidad: num(v[COLM.cantidad]), importe: num(v[COLM.importe]),
    });
  });
  console.log(`"MOVIMIENTOS": ${movDocs.length} filas FC válidas, ${movSD} filas SD descartadas, ${movRechazadas} rechazadas (datos incompletos).`);

  // ── Hoja OC ──────────────────────────────────────────────────────────────────
  const wsOC = wb.getWorksheet('OC');
  if (!wsOC) throw new Error('No se encontró la hoja "OC"');
  const hOC = leerEncabezado(wsOC);
  const colO = colFn(hOC);
  const COLO = {
    grupo:        colO('GRUPO'),
    grupoGeneral: colO('GRUPO GENERAL'),
    grupoCompra:  colO('GRUPO COMPRA'),
    operacion:    colO('OPERACION', 'OPERACIÓN'),
    año:          colO('AÑO', 'ANO'),
    semana:       colO('SEMANA'),
    claseOC:      colO('CLASE OC'),
    cantidadOC:   colO('CANTIDAD OC'),
    importeOC:    colO('IMPORTE OC'),
  };
  const faltantesO = Object.entries(COLO).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesO.length) throw new Error(`"OC": no se encontraron las columnas: ${faltantesO.join(', ')}`);

  const ocDocs = [];
  let ocRechazadas = 0, ocSD = 0;
  wsOC.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const grupo = str(v[COLO.grupo]);
    if (grupo !== 'FC') { ocSD++; return; }
    const operacion = str(v[COLO.operacion]);
    const claseOC = str(v[COLO.claseOC]);
    const año = num(v[COLO.año]);
    const semana = num(v[COLO.semana]);
    if (!operacion || !claseOC || !año || !semana) { ocRechazadas++; return; }
    ocDocs.push({
      grupo, grupoGeneral: str(v[COLO.grupoGeneral]), grupoCompra: str(v[COLO.grupoCompra]),
      operacion, año, semana, claseOC,
      cantidadOC: num(v[COLO.cantidadOC]), importeOC: num(v[COLO.importeOC]),
    });
  });
  console.log(`"OC": ${ocDocs.length} filas FC válidas, ${ocSD} filas SD descartadas, ${ocRechazadas} rechazadas (datos incompletos).`);

  // ── Reemplazo completo (snapshot del estado actual, no serie histórica) ────
  console.log('\nImportando a MongoDB...');
  await SeguimientoCompraMovimiento.deleteMany({});
  for (let i = 0; i < movDocs.length; i += BATCH) {
    await SeguimientoCompraMovimiento.insertMany(movDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${movDocs.length.toLocaleString()} filas en SeguimientoCompraMovimiento.`);

  await SeguimientoCompraOC.deleteMany({});
  for (let i = 0; i < ocDocs.length; i += BATCH) {
    await SeguimientoCompraOC.insertMany(ocDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${ocDocs.length.toLocaleString()} filas en SeguimientoCompraOC.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

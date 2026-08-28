/**
 * Importación de EBC BASE SEGUIMIENTO DE COMPRAS.xlsx a MongoDB (hojas MOVIMIENTOS y OC,
 * fuente del módulo Aprobación y Seguimiento de Compras — Eficiencia de Consumo y Compra
 * + consulta de OC por Grupo de Compra).
 *
 * Se importan filas con GRUPO 'FC' y 'SD' (antes solo se guardaba FC; ambas
 * quedan en las mismas colecciones, distinguidas por el campo "grupo").
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
const GrupoCompraEspecial         = require('../models/GrupoCompraEspecial');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC SEGUIMIENTO DE COMPRAS\\EBC BASE SEGUIMIENTO DE COMPRAS.xlsx';

const BATCH = 2000;

const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : 0; };
const norm = s => String(s ?? '').trim().toUpperCase();
const sinTilde = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

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
  let movRechazadas = 0, movFC = 0, movSD = 0;
  wsMov.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const grupo = str(v[COLM.grupo]);
    if (grupo !== 'FC' && grupo !== 'SD') { movRechazadas++; return; }
    const operacion = str(v[COLM.operacion]);
    const movimiento = str(v[COLM.movimiento]);
    const año = num(v[COLM.año]);
    const semana = num(v[COLM.semana]);
    if (!operacion || !movimiento || !año || !semana) { movRechazadas++; return; }
    if (grupo === 'FC') movFC++; else movSD++;
    movDocs.push({
      grupo, grupoGeneral: str(v[COLM.grupoGeneral]), grupoCompra: str(v[COLM.grupoCompra]),
      operacion, movimiento, año, semana,
      cantidad: num(v[COLM.cantidad]), importe: num(v[COLM.importe]),
    });
  });
  console.log(`"MOVIMIENTOS": ${movFC} filas FC, ${movSD} filas SD, ${movRechazadas} rechazadas (datos incompletos o GRUPO desconocido).`);

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
  let ocRechazadas = 0, ocFC = 0, ocSD = 0;
  wsOC.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const grupo = str(v[COLO.grupo]);
    if (grupo !== 'FC' && grupo !== 'SD') { ocRechazadas++; return; }
    const operacion = str(v[COLO.operacion]);
    const claseOC = str(v[COLO.claseOC]);
    const año = num(v[COLO.año]);
    const semana = num(v[COLO.semana]);
    if (!operacion || !claseOC || !año || !semana) { ocRechazadas++; return; }
    if (grupo === 'FC') ocFC++; else ocSD++;
    ocDocs.push({
      grupo, grupoGeneral: str(v[COLO.grupoGeneral]), grupoCompra: str(v[COLO.grupoCompra]),
      operacion, año, semana, claseOC,
      cantidadOC: num(v[COLO.cantidadOC]), importeOC: num(v[COLO.importeOC]),
    });
  });
  console.log(`"OC": ${ocFC} filas FC, ${ocSD} filas SD, ${ocRechazadas} rechazadas (datos incompletos o GRUPO desconocido).`);

  // ── Tabla GRUPO_COMPRA_ESPECIAL (dentro de la hoja "TABLAS", NO es una hoja
  // propia — hay varias tablas de Excel en esa misma hoja en distintas
  // columnas). Se ubica buscando la celda "GRUPO COMPRA" seguida a la derecha
  // por "OPERACION"/"OPERACIÓN", en vez de asumir una columna fija, porque su
  // posición puede variar si se agregan/quitan las otras tablas de la hoja. ──
  const wsTablas = wb.getWorksheet('TABLAS');
  if (!wsTablas) throw new Error('No se encontró la hoja "TABLAS"');

  let colGrupoEsp, colOpEsp, filaHeaderEsp;
  wsTablas.eachRow((row) => {
    if (filaHeaderEsp) return;
    row.eachCell((cell, col) => {
      if (norm(cellVal(cell.value)) !== 'GRUPO COMPRA') return;
      const vecino = sinTilde(cellVal(row.getCell(col + 1).value));
      if (vecino === 'OPERACION') { colGrupoEsp = col; colOpEsp = col + 1; filaHeaderEsp = row.number; }
    });
  });
  if (!filaHeaderEsp) throw new Error('No se encontró la tabla "GRUPO COMPRA ESPECIAL" en la hoja "TABLAS"');

  const especialSet = new Set(); // "OPERACION|GRUPO COMPRA", para descartar duplicados exactos
  const especialDocs = [];
  for (let r = filaHeaderEsp + 1; ; r++) {
    const row = wsTablas.getRow(r);
    const grupoCompra = str(row.getCell(colGrupoEsp).value);
    const operacion = str(row.getCell(colOpEsp).value);
    if (!grupoCompra && !operacion) break; // fin de la tabla
    if (!grupoCompra || !operacion) continue;
    const k = `${operacion}|${grupoCompra}`;
    if (especialSet.has(k)) continue;
    especialSet.add(k);
    especialDocs.push({ operacion, grupoCompra });
  }
  console.log(`"GRUPO COMPRA ESPECIAL": ${especialDocs.length} combinaciones operación+grupo (fila de encabezado ${filaHeaderEsp}, columnas ${colGrupoEsp}/${colOpEsp}).`);

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
  console.log(`  ✓ ${ocDocs.length.toLocaleString()} filas en SeguimientoCompraOC.`);

  await GrupoCompraEspecial.deleteMany({});
  if (especialDocs.length) await GrupoCompraEspecial.insertMany(especialDocs, { ordered: false });
  console.log(`  ✓ ${especialDocs.length.toLocaleString()} filas en GrupoCompraEspecial.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

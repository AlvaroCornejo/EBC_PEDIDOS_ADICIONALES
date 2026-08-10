/**
 * Importación diaria de EBC RECETAS.xlsx a MongoDB (costo de receta vs. costo real de
 * producción, fuente del módulo Costeo de Recetas).
 *
 * Uso:
 *   node scripts/importRecetasCosteo.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const RecetaCosteo        = require('../models/RecetaCosteo');
const RecetaCosteoDetalle = require('../models/RecetaCosteoDetalle');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC RECETAS\\EBC RECETAS.xlsx';

const BATCH = 2000;

const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : 0; };
const bool = v => str(v).toUpperCase() === 'S';
const norm = s => String(s ?? '').trim().toUpperCase();

// Las columnas se resuelven por NOMBRE de encabezado, no por posición fija — el orden de
// columnas de estos Excel de Box ha cambiado sin aviso entre sincronizaciones en sesiones
// anteriores (ver EBC VENTAS CABECERA.xlsx), así que nunca se asume un orden fijo.
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

  // ── Hoja resumen: EBC RECETAS ───────────────────────────────────────────────
  const wsResumen = wb.getWorksheet('EBC RECETAS');
  if (!wsResumen) throw new Error('No se encontró la hoja "EBC RECETAS"');
  const hResumen = leerEncabezado(wsResumen);
  const colR = colFn(hResumen);
  const COLR = {
    grupo:     colR('GRUPO'),
    item:      colR('ITEM'),
    nombre:    colR('NOMBRE'),
    costo:     colR('COSTO'),
    batch:     colR('BATCH'),
    costoReal: colR('COSTO REAL'),
    sociedad:  colR('SOCIEDAD'),
    operacion: colR('OPERACION', 'OPERACIÓN'),
  };
  const faltantesR = Object.entries(COLR).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesR.length) throw new Error(`"EBC RECETAS": no se encontraron las columnas: ${faltantesR.join(', ')}`);

  // El control de duplicados usa SOCIEDAD + OPERACION + ITEM como llave: se descarta una
  // repetición idéntica (mismo valor en todos los campos), pero si la misma llave trae
  // valores DISTINTOS no es un duplicado real sino un problema de datos — se avisa en
  // consola para revisarlo a mano en vez de sumar o descartar en silencio.
  const porClaveR = new Map();
  let duplicadosIdenticosR = 0;
  const conflictosR = [];
  let rechazadasR = 0;
  wsResumen.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const item = num(v[COLR.item]);
    const operacion = str(v[COLR.operacion]);
    const sociedad = str(v[COLR.sociedad]);
    if (!item || !operacion) { rechazadasR++; return; }
    const doc = {
      grupo: str(v[COLR.grupo]), item, nombre: str(v[COLR.nombre]),
      costo: num(v[COLR.costo]), batch: num(v[COLR.batch]), costoReal: num(v[COLR.costoReal]),
      sociedad, operacion,
    };
    const clave = `${sociedad}|${operacion}|${item}`;
    const previa = porClaveR.get(clave);
    if (!previa) { porClaveR.set(clave, doc); return; }
    const mismosValores = previa.grupo === doc.grupo && previa.nombre === doc.nombre
      && previa.costo === doc.costo && previa.batch === doc.batch && previa.costoReal === doc.costoReal;
    if (mismosValores) duplicadosIdenticosR++;
    else conflictosR.push({ clave, fila: i, previa, nueva: doc });
  });
  const resumenDocs = [...porClaveR.values()];
  console.log(`"EBC RECETAS": ${resumenDocs.length} filas válidas, ${rechazadasR} rechazadas (sin item/operación).`);
  if (duplicadosIdenticosR) console.log(`  ⚠ ${duplicadosIdenticosR} filas duplicadas idénticas (misma SOCIEDAD+OPERACION+ITEM) — se descartó la repetida.`);
  if (conflictosR.length) {
    console.log(`  ⚠ ${conflictosR.length} filas con la misma llave pero VALORES DISTINTOS — se conservó la primera, revisar a mano:`);
    conflictosR.forEach(c => console.log(`     ${c.clave} (fila ${c.fila}): previa=${JSON.stringify(c.previa)} nueva=${JSON.stringify(c.nueva)}`));
  }

  // ── Hoja detalle: EBC RECETAS DETALLE ───────────────────────────────────────
  const wsDetalle = wb.getWorksheet('EBC RECETAS DETALLE');
  if (!wsDetalle) throw new Error('No se encontró la hoja "EBC RECETAS DETALLE"');
  const hDetalle = leerEncabezado(wsDetalle);
  const colD = colFn(hDetalle);
  const COLD = {
    item:         colD('ITEM'),
    nombre:       colD('NOMBRE'),
    insumo:       colD('INSUMO'),
    nombreInsumo: colD('NOMBRE INSUMO'),
    cantidad:     colD('CANTIDAD'),
    mesa:         colD('MESA'),
    llevar:       colD('LLEVAR'),
    delivery:     colD('DELIVERY'),
    unitario:     colD('UNITARIO'),
    batch:        colD('BATCH'),
    costo:        colD('COSTO'),
    grupo:        colD('GRUPO'),
    sociedad:     colD('SOCIEDAD'),
    operacion:    colD('OPERACION', 'OPERACIÓN'),
  };
  const faltantesD = Object.entries(COLD).filter(([, c]) => c === undefined).map(([k]) => k);
  if (faltantesD.length) throw new Error(`"EBC RECETAS DETALLE": no se encontraron las columnas: ${faltantesD.join(', ')}`);

  // A diferencia del resumen, acá NO se deduplica por clave — un mismo INSUMO puede
  // aparecer más de una vez dentro del mismo SOCIEDAD+OPERACION+ITEM (ej. usado en dos
  // preparaciones distintas de la receta) y ambas filas deben conservarse tal cual vienen
  // del Excel, sumándose en los totales por canal.
  const detalleDocs = [];
  let rechazadasD = 0;
  wsDetalle.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const item = num(v[COLD.item]);
    const insumo = num(v[COLD.insumo]);
    const operacion = str(v[COLD.operacion]);
    if (!item || !insumo || !operacion) { rechazadasD++; return; }
    detalleDocs.push({
      item, nombre: str(v[COLD.nombre]), insumo, nombreInsumo: str(v[COLD.nombreInsumo]),
      cantidad: num(v[COLD.cantidad]), mesa: bool(v[COLD.mesa]), llevar: bool(v[COLD.llevar]), delivery: bool(v[COLD.delivery]),
      unitario: num(v[COLD.unitario]), batch: num(v[COLD.batch]), costo: num(v[COLD.costo]),
      grupo: str(v[COLD.grupo]), sociedad: str(v[COLD.sociedad]), operacion,
    });
  });
  console.log(`"EBC RECETAS DETALLE": ${detalleDocs.length} filas válidas, ${rechazadasD} rechazadas (sin item/insumo/operación).`);

  // ── Reemplazo completo (snapshot del estado actual, no serie histórica) ────
  console.log('\nImportando a MongoDB...');
  await RecetaCosteo.deleteMany({});
  for (let i = 0; i < resumenDocs.length; i += BATCH) {
    await RecetaCosteo.insertMany(resumenDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${resumenDocs.length.toLocaleString()} filas en RecetaCosteo.`);

  await RecetaCosteoDetalle.deleteMany({});
  for (let i = 0; i < detalleDocs.length; i += BATCH) {
    await RecetaCosteoDetalle.insertMany(detalleDocs.slice(i, i + BATCH), { ordered: false });
  }
  console.log(`  ✓ ${detalleDocs.length.toLocaleString()} filas en RecetaCosteoDetalle.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

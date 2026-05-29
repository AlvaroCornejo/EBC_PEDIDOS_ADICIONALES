/**
 * Importación diaria de COMPARATIVO OC INGRESOS.xlsx a MongoDB.
 *
 * Uso:
 *   node scripts/importComparativoOC.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose  = require('mongoose');
const ExcelJS   = require('exceljs');
const ComparativoOC = require('../models/ComparativoOC');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC COMPARATIVO OC INGRESOS AL ALMACEN\\COMPARATIVO OC INGRESOS.xlsx';

const BATCH = 2000;

const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);
const str = v => v == null ? '' : String(v).trim();

/** Normaliza clave: mayúsculas, sin tildes, espacios→guión bajo */
function norm(s) {
  return str(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes
    .replace(/\s+/g, '_');
}

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  const sh = wb.getWorksheet('COMPARATIVO_OC_ROC');
  if (!sh) throw new Error('No se encontró hoja COMPARATIVO_OC_ROC');

  // Leer cabecera fila 1 — normalizar claves para tolerar tildes, espacios y Rich Text
  const header = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    let val = cell.value;
    // ExcelJS puede devolver RichText ({richText:[...]}) en celdas con formato
    if (val && typeof val === 'object') {
      if (Array.isArray(val.richText)) val = val.richText.map(r => r.text || '').join('');
      else if (val.result !== undefined) val = val.result;
      else val = String(val);
    }
    const key = norm(val);
    if (key) header[key] = col;
  });
  console.log('Cabeceras detectadas:', header);

  // Mapear columnas — buscar por variantes posibles
  function col(...keys) {
    for (const k of keys) {
      if (header[norm(k)] !== undefined) return header[norm(k)];
    }
    return undefined;
  }

  const C = {
    item:      col('ITEM'),
    añosem:    col('AÑO SEMANA', 'ANO SEMANA', 'AÑOSEM', 'AÑO_SEMANA', 'ANO_SEMANA'),
    año:       col('AÑO', 'ANO'),
    semana:    col('SEMANA'),
    nombre:    col('NOMBRE'),
    grpCompra: col('GRUPO COMPRA', 'GRUPO_COMPRA'),
    grupo:     col('GRUPO'),
    operacion: col('OPERACION', 'OPERACIÓN'),
    cantReal:  col('CANTIDAD REAL', 'CANTIDAD_REAL'),
    impReal:   col('IMPORTE REAL', 'IMPORTE_REAL'),
    cantOC:    col('CANTIDAD OC', 'CANTIDAD_OC'),
    impOC:     col('IMPORTE OC', 'IMPORTE_OC'),
    cantOCOT:  col('CANTIDAD OC OT', 'CANTIDAD_OC_OT'),
    impOCOT:   col('IMPORTE OC OT', 'IMPORTE_OC_OT')
  };
  console.log('Columnas mapeadas:', C);

  // Validar columnas críticas
  if (!C.item)     throw new Error('No se encontró columna ITEM');
  if (!C.operacion) throw new Error('No se encontró columna OPERACION');
  if (!C.añosem && !C.año) throw new Error('No se encontró columna AÑO/AÑOSEM');

  // Leer filas
  const docs = [];
  sh.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const item      = str(row.getCell(C.item).value);
    const operacion = str(row.getCell(C.operacion).value);
    if (!item || !operacion) return;

    // Determinar año y semana
    let año, semana, añosem;
    if (C.añosem) {
      añosem = num(row.getCell(C.añosem).value);
      año    = Math.floor(añosem / 100);
      semana = añosem % 100;
    } else {
      año    = num(row.getCell(C.año).value);
      semana = C.semana ? num(row.getCell(C.semana).value) : 0;
      añosem = año * 100 + semana;
    }
    if (!año || !semana) return;

    docs.push({
      item,
      año,
      semana,
      añosem,
      nombre:       C.nombre    ? str(row.getCell(C.nombre).value)    : '',
      grupoCompra:  C.grpCompra ? str(row.getCell(C.grpCompra).value) : '',
      grupo:        C.grupo     ? str(row.getCell(C.grupo).value)     : '',
      operacion,
      cantidadReal: C.cantReal  ? num(row.getCell(C.cantReal).value)  : 0,
      importeReal:  C.impReal   ? num(row.getCell(C.impReal).value)   : 0,
      cantidadOC:   C.cantOC    ? num(row.getCell(C.cantOC).value)    : 0,
      importeOC:    C.impOC     ? num(row.getCell(C.impOC).value)     : 0,
      cantidadOCOT: C.cantOCOT  ? num(row.getCell(C.cantOCOT).value)  : 0,
      importeOCOT:  C.impOCOT   ? num(row.getCell(C.impOCOT).value)   : 0
    });
  });

  console.log(`Filas leídas: ${docs.length}`);
  if (!docs.length) throw new Error('No se leyeron filas — verificar estructura del Excel');

  // Upsert por lotes
  console.log('Importando a MongoDB...');
  let upserted = 0, modified = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const lote = docs.slice(i, i + BATCH);
    const ops = lote.map(d => ({
      updateOne: {
        filter: { operacion: d.operacion, item: d.item, añosem: d.añosem },
        update: { $set: d },
        upsert: true
      }
    }));
    const res = await ComparativoOC.bulkWrite(ops, { ordered: false });
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
    process.stdout.write(`  ${Math.min(i + BATCH, docs.length)}/${docs.length}\r`);
  }

  console.log(`\nImportación completa:`);
  console.log(`  Nuevos:       ${upserted}`);
  console.log(`  Actualizados: ${modified}`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

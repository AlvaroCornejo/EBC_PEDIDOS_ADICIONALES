/**
 * Importación diaria de COMPARATIVO OC INGRESOS.xlsx a MongoDB.
 *
 * Uso:
 *   node scripts/importComparativoOC.js [ruta_excel]
 *
 * Por defecto lee desde Box. Programar en Tarea Windows a las 6AM.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose  = require('mongoose');
const ExcelJS   = require('exceljs');
const path      = require('path');
const ComparativoOC = require('../models/ComparativoOC');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC COMPARATIVO OC INGRESOS AL ALMACEN\\COMPARATIVO OC INGRESOS.xlsx';

const BATCH = 2000;

const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);
const str = v => v == null ? '' : String(v).trim();

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

  // Leer cabecera (fila 1) para mapear columnas
  const header = {};
  sh.getRow(1).eachCell((cell, col) => {
    header[str(cell.value).toUpperCase().replace(/\s+/g,'_')] = col;
  });

  const COL = {
    item:         header['ITEM'],
    año:          header['AÑO'] || header['A�O'],
    semana:       header['SEMANA'],
    nombre:       header['NOMBRE'],
    grupoCompra:  header['GRUPO_COMPRA'],
    grupo:        header['GRUPO'],
    operacion:    header['OPERACION'],
    cantReal:     header['CANTIDAD_REAL'],
    impReal:      header['IMPORTE_REAL'],
    cantOC:       header['CANTIDAD_OC'],
    impOC:        header['IMPORTE_OC'],
    cantOCOT:     header['CANTIDAD_OC_OT'],
    impOCOT:      header['IMPORTE_OC_OT']
  };

  // Validar columnas críticas
  const missing = Object.entries(COL).filter(([k,v]) => !v && ['item','año','semana','operacion'].includes(k));
  if (missing.length) {
    // Intentar sin tilde
    COL.año = COL.año || header['ANO'] || header['A_O'];
  }

  console.log('Mapeando columnas:', COL);

  // Leer filas
  const docs = [];
  sh.eachRow((row, rn) => {
    if (rn === 1) return;
    const item      = str(row.getCell(COL.item).value);
    const añoRaw    = row.getCell(COL.año).value;
    const semRaw    = row.getCell(COL.semana).value;
    const operacion = str(row.getCell(COL.operacion).value);
    if (!item || !operacion) return;

    const año    = num(añoRaw);
    const semana = num(semRaw);
    if (!año || !semana) return;

    docs.push({
      item,
      año,
      semana,
      añosem:       año * 100 + semana,
      nombre:       str(row.getCell(COL.nombre).value),
      grupoCompra:  str(row.getCell(COL.grupoCompra).value),
      grupo:        str(row.getCell(COL.grupo).value),
      operacion,
      cantidadReal: num(row.getCell(COL.cantReal).value),
      importeReal:  num(row.getCell(COL.impReal).value),
      cantidadOC:   num(row.getCell(COL.cantOC).value),
      importeOC:    num(row.getCell(COL.impOC).value),
      cantidadOCOT: num(row.getCell(COL.cantOCOT).value),
      importeOCOT:  num(row.getCell(COL.impOCOT).value)
    });
  });

  console.log(`Filas leídas: ${docs.length}`);

  // Upsert por lotes (operacion + item + añosem es único)
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

main().catch(err => { console.error(err); process.exit(1); });

/**
 * Importación diaria de EBC VENTAS TIP RESUMEN.xlsx a MongoDB.
 *
 * Uso:
 *   node scripts/importVentasTip.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS).
 * En máquina local pasar como argumento.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose  = require('mongoose');
const ExcelJS   = require('exceljs');
const VentasTip = require('../models/VentasTip');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC VENTAS\\EBC VENTAS TIP RESUMEN.xlsx';

const BATCH = 2000;

const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);
const str = v => v == null ? '' : String(v).trim();

/** Normaliza clave: mayúsculas, sin tildes, espacios→guión bajo */
function norm(s) {
  return str(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

/** Lee una hoja y devuelve array de {operacion, año, semana, añosem, añoN, mesN, añomes, ...campos} */
async function leerHoja(wb, nombreHoja, camposExtra) {
  const sh = wb.getWorksheet(nombreHoja);
  if (!sh) throw new Error(`No se encontró hoja ${nombreHoja}`);

  // Leer cabecera fila 1
  const header = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = norm(cell.value);
    if (key) header[key] = col;
  });

  // Resolver columnas base
  function col(...keys) {
    for (const k of keys) {
      if (header[norm(k)] !== undefined) return header[norm(k)];
    }
    return undefined;
  }

  const cOp   = col('OPERACION');
  const cAno  = col('AÑO', 'ANO', 'YEAR');
  const cSem  = col('SEM', 'SEMANA', 'WEEK');
  const cAnoN = col('AÑO_N', 'ANO_N', 'YEAR_N');
  const cMesN = col('MES_N', 'MES', 'MONTH_N');
  if (!cOp || !cAno || !cSem) throw new Error(`Columnas base no encontradas en ${nombreHoja}`);

  // Resolver columnas extra
  const cExtra = {};
  for (const [campo, variantes] of Object.entries(camposExtra)) {
    cExtra[campo] = col(...variantes);
  }

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const operacion = str(row.getCell(cOp).value);
    const año       = num(row.getCell(cAno).value);
    const semana    = num(row.getCell(cSem).value);
    if (!operacion || !año || !semana) return;
    const añoN   = cAnoN ? num(row.getCell(cAnoN).value) : año;
    const mesN   = cMesN ? num(row.getCell(cMesN).value) : 0;
    const añomes = añoN && mesN ? añoN * 100 + mesN : 0;
    const rec = { operacion, año, semana, añosem: año * 100 + semana, añoN, mesN, añomes };
    for (const [campo, c] of Object.entries(cExtra)) {
      rec[campo] = c ? num(row.getCell(c).value) : 0;
    }
    rows.push(rec);
  });
  return rows;
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

  // Leer las 3 hojas
  const ventas  = await leerHoja(wb, 'VENTAS',  { ventaBruta: ['VENTA_BRUTA'], ventaNeta: ['VENTA_NETA'] });
  const tipEfe  = await leerHoja(wb, 'TIP_EFE', { tipEfectivo: ['TIP_EFE'] });
  const tipTC   = await leerHoja(wb, 'TIP_TC',  { tipTC: ['TIP_TC'] });

  console.log(`VENTAS: ${ventas.length} filas`);
  console.log(`TIP_EFE: ${tipEfe.length} filas`);
  console.log(`TIP_TC: ${tipTC.length} filas`);

  // Combinar por clave operacion+añosem
  const mapa = new Map();
  const key = r => `${r.operacion}|${r.añosem}`;

  for (const r of ventas) {
    mapa.set(key(r), {
      operacion: r.operacion, año: r.año, semana: r.semana, añosem: r.añosem,
      añoN: r.añoN, mesN: r.mesN, añomes: r.añomes,
      ventaBruta: r.ventaBruta, ventaNeta: r.ventaNeta, tipEfectivo: 0, tipTC: 0
    });
  }
  for (const r of tipEfe) {
    const k = key(r);
    if (mapa.has(k)) mapa.get(k).tipEfectivo = r.tipEfectivo;
    else mapa.set(k, {
      operacion: r.operacion, año: r.año, semana: r.semana, añosem: r.añosem,
      añoN: r.añoN, mesN: r.mesN, añomes: r.añomes,
      ventaBruta: 0, ventaNeta: 0, tipEfectivo: r.tipEfectivo, tipTC: 0
    });
  }
  for (const r of tipTC) {
    const k = key(r);
    if (mapa.has(k)) mapa.get(k).tipTC = r.tipTC;
    else mapa.set(k, {
      operacion: r.operacion, año: r.año, semana: r.semana, añosem: r.añosem,
      añoN: r.añoN, mesN: r.mesN, añomes: r.añomes,
      ventaBruta: 0, ventaNeta: 0, tipEfectivo: 0, tipTC: r.tipTC
    });
  }

  const docs = [...mapa.values()];
  console.log(`\nTotal combinado: ${docs.length} registros`);

  // Upsert por lotes
  console.log('Importando a MongoDB...');
  let upserted = 0, modified = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const lote = docs.slice(i, i + BATCH);
    const ops = lote.map(d => ({
      updateOne: {
        filter: { operacion: d.operacion, añosem: d.añosem },
        update: { $set: d },
        upsert: true
      }
    }));
    const res = await VentasTip.bulkWrite(ops, { ordered: false });
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

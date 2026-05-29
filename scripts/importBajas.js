/**
 * Importa movimientos BAJA y VENTA del Kardex de todos los archivos ADICIONALES.
 *
 * Uso:
 *   node scripts/importBajas.js
 *
 * Lee los archivos data/*ADICIONALES.xlsx (ya sincronizados por sync-excel.bat).
 * Upserta en la colección KardexBajaVenta.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const path     = require('path');
const fs       = require('fs');

const KardexBajaVenta = require('../models/KardexBajaVenta');

const DATA_DIR = path.join(__dirname, '../data');
const BATCH    = 2000;

function norm(s) {
  return (s == null ? '' : String(s)).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().replace(/\s+/g, '_');
}

async function leerKardex(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sh = wb.getWorksheet('Kardex');
  if (!sh) return [];

  // Mapear cabecera
  const hdr = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    hdr[norm(cell.value)] = col;
  });
  const cItem = hdr['ITEM'];
  const cTrx  = hdr['TRX'];
  const cSem  = hdr['AOSEM'] || hdr['ANOSEM'] || hdr['AOSEM'] || Object.entries(hdr).find(([k]) => k.includes('SEM'))?.[1];
  const cCant = hdr['CANTIDAD'];
  const cImp  = hdr['IMPORTE'];
  const cOp   = hdr['OPERACION'];
  if (!cItem || !cTrx || !cSem) return [];

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const trx = norm(row.getCell(cTrx).value);
    if (trx !== 'BAJA' && trx !== 'VENTA') return;
    const itemVal = row.getCell(cItem).value;
    const item    = typeof itemVal === 'object' ? (itemVal?.result ?? itemVal) : itemVal;
    const añosem  = Number(row.getCell(cSem).value) || 0;
    if (!item || !añosem) return;
    const año    = Math.floor(añosem / 100);
    const semana = añosem % 100;
    const operacion = cOp ? String(row.getCell(cOp).value || '').trim() : '';
    const cant   = Number(row.getCell(cCant)?.value) || 0;
    const imp    = Number(row.getCell(cImp)?.value)  || 0;
    rows.push({ operacion, item: Number(item), añosem, año, semana, trx, cant, imp });
  });
  return rows;
}

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  // Listar archivos ADICIONALES
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.xlsx') && f.includes('ADICIONALES'))
    .map(f => path.join(DATA_DIR, f));

  console.log(`Leyendo ${files.length} archivos ADICIONALES...`);

  // Leer todos los archivos y combinar por (operacion, item, añosem)
  const mapa = new Map(); // clave → {bajaCant, bajaImp, ventaCant, ventaImp, ...}
  const key  = (op, item, sem) => `${op}|${item}|${sem}`;

  for (const f of files) {
    const op = path.basename(f).split(' - ')[0];
    process.stdout.write(`  ${op}...`);
    const rows = await leerKardex(f);
    for (const r of rows) {
      const operacion = r.operacion || op; // usar columna OPERACION si existe
      const k = key(operacion, r.item, r.añosem);
      if (!mapa.has(k)) {
        mapa.set(k, {
          operacion, item: r.item, añosem: r.añosem,
          año: r.año, semana: r.semana,
          bajaCant: 0, bajaImp: 0, ventaCant: 0, ventaImp: 0
        });
      }
      const d = mapa.get(k);
      if (r.trx === 'BAJA')  { d.bajaCant  += r.cant; d.bajaImp  += r.imp; }
      if (r.trx === 'VENTA') { d.ventaCant += r.cant; d.ventaImp += r.imp; }
    }
    console.log(` ${rows.length} filas`);
  }

  const docs = [...mapa.values()];
  console.log(`\nTotal combinado: ${docs.length} registros`);

  // Upsert por lotes
  console.log('Importando a MongoDB...');
  let upserted = 0, modified = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const lote = docs.slice(i, i + BATCH);
    const ops  = lote.map(d => ({
      updateOne: {
        filter: { operacion: d.operacion, item: d.item, añosem: d.añosem },
        update: { $set: d },
        upsert: true
      }
    }));
    const res = await KardexBajaVenta.bulkWrite(ops, { ordered: false });
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

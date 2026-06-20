/**
 * Importa recetas de planta desde EBC JERARQUIA.xlsx (hoja NT + Batch).
 * Uso: node scripts/importRecetas.js
 *
 * NT: receta directa de cada producto (Item1 → ingredientes Item3).
 *     Cantidad3 = cantidad por batch del producto.
 * Batch: tamaño de batch por producto (Item1 → Batch).
 * esSub: true si el Item3 también aparece como Item1 en NT (= sub-producido).
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const path     = require('path');

const Receta = require('../models/Receta');

const FILE = path.join(__dirname, '../data/EBC JERARQUIA.xlsx');
const BATCH_SIZE = 500;

async function leerSheet(wb, sheetName, colMap) {
  const sh = wb.getWorksheet(sheetName);
  if (!sh) throw new Error(`Hoja "${sheetName}" no encontrada`);

  // Leer cabecera fila 1
  const hdr = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    hdr[String(cell.value || '').trim()] = col;
  });

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const obj = {};
    for (const [field, colName] of Object.entries(colMap)) {
      const col = hdr[colName];
      const v   = col ? row.getCell(col).value : null;
      obj[field] = (v != null && typeof v === 'object') ? (v.result ?? v.text ?? null) : v;
    }
    rows.push(obj);
  });
  return rows;
}

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  console.log(`Leyendo ${FILE} ...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  // ── Leer hoja Batch ──────────────────────────────────────────────
  const batchRows = await leerSheet(wb, 'Batch', {
    item:  'Item1',
    batch: 'Batch',
  });
  const batchMap = {};
  batchRows.forEach(r => {
    const item = Number(r.item);
    if (item) batchMap[item] = Number(r.batch) || 1;
  });
  console.log(`Batch: ${Object.keys(batchMap).length} productos`);

  // ── Leer hoja NT ─────────────────────────────────────────────────
  const ntRows = await leerSheet(wb, 'NT', {
    item1:        'Item1',
    desc1:        'Descripcion1',
    item3:        'Item3',
    desc3:        'Descripcion3',
    cantidad:     'Cantidad3',
    unidad:       'Unidad3',
    areaDescarga: 'AreaDescarga3',
  });
  console.log(`NT: ${ntRows.length} filas`);

  // Conjunto de todos los Item1 en NT (= productos que pueden ser sub-producidos)
  const productosSet = new Set();
  ntRows.forEach(r => {
    const item1 = Number(r.item1);
    if (item1) productosSet.add(item1);
  });

  // Agrupar NT por Item1
  const recetaMap = {};
  ntRows.forEach(r => {
    const item1 = Number(r.item1);
    const item3 = Number(r.item3);
    if (!item1 || !item3) return;

    if (!recetaMap[item1]) {
      recetaMap[item1] = {
        item:        item1,
        descripcion: String(r.desc1 || '').trim(),
        batch:       batchMap[item1] || 1,
        ingredientes:[],
      };
    }
    recetaMap[item1].ingredientes.push({
      item:        item3,
      descripcion: String(r.desc3 || '').trim(),
      cantidad:    parseFloat(r.cantidad) || 0,
      unidad:      String(r.unidad || '').trim(),
      areaDescarga:String(r.areaDescarga || '').trim(),
      esSub:       productosSet.has(item3),
    });
  });

  const docs = Object.values(recetaMap);
  console.log(`Recetas a importar: ${docs.length}`);

  // ── Upsert por lotes ─────────────────────────────────────────────
  let upserted = 0, modified = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const lote = docs.slice(i, i + BATCH_SIZE);
    const ops  = lote.map(d => ({
      updateOne: {
        filter: { item: d.item },
        update: { $set: { ...d, updatedAt: new Date() } },
        upsert: true,
      },
    }));
    const res = await Receta.bulkWrite(ops, { ordered: false });
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}\r`);
  }

  console.log(`\nImportación completa:`);
  console.log(`  Nuevos:       ${upserted}`);
  console.log(`  Actualizados: ${modified}`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

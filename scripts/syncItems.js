/**
 * Sincroniza la colección Item desde los Excel ADICIONALES de cada operación.
 *
 * Uso:
 *   node scripts/syncItems.js
 *
 * Lee data/{OPERACION} - ADICIONALES.xlsx (ya sincronizados por sync-excel.bat)
 * y hace upsert en la colección Item (misma lógica que POST /api/items/sync).
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Item = require('../models/Item');
const ItemVenta = require('../models/ItemVenta');
const Operacion = require('../models/Operacion');
const { readItems, findFile, loadWB } = require('../routes/datos');

const ITEMS_VENTA_FILE = path.join(__dirname, '../data/EBC ITEMS_VENTA.xlsx');

async function main() {
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  // Antes una lista fija (quedó desactualizada: incluía "GBCFR2" ya eliminado, le faltaban
  // CORPQ/CORPFK/MUVON/GBCORP) — ahora se consulta el catálogo real (models/Operacion.js).
  const ALL_OPS = await Operacion.distinct('codigo');

  for (const operacion of ALL_OPS) {
    process.stdout.write(`${operacion}...`);
    const fp = findFile(operacion);
    if (!fp) { console.log(' sin archivo, omitido'); continue; }

    const wb = await loadWB(fp);
    const excelItems = readItems(wb).map(i => ({ ...i, operacion, loteCompra: 1 }));
    if (!excelItems.length) { console.log(' sin items en hoja "Items"'); continue; }

    const ops = excelItems.map(it => ({
      updateOne: {
        filter: { operacion: it.operacion, item: it.item },
        update: {
          $set:         { nombre: it.nombre, grupoCompra: it.grupoCompra, gestion: it.gestion, activo: true },
          $setOnInsert: { loteCompra: 1 }
        },
        upsert: true
      }
    }));
    const result = await Item.bulkWrite(ops, { ordered: false });
    const insertados = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;
    console.log(` total ${excelItems.length}, nuevos ${insertados}, actualizados ${actualizados}`);
  }

  // ── ItemVenta (EBC ITEMS_VENTA.xlsx, catálogo para flujo 86) ──
  process.stdout.write('ITEMS_VENTA...');
  if (!fs.existsSync(ITEMS_VENTA_FILE)) {
    console.log(' sin archivo, omitido');
  } else {
    const wb = await loadWB(ITEMS_VENTA_FILE);
    const sh = wb.getWorksheet('ITEMS_VENTA');
    if (!sh) {
      console.log(' sin hoja "ITEMS_VENTA"');
    } else {
      const porClave = new Map();
      sh.eachRow((row, rn) => {
        if (rn === 1) return;
        const operacion = String(row.getCell(1).value || '').trim();
        const item = Number(row.getCell(2).value);
        const nombre = String(row.getCell(3).value || '').trim();
        if (!operacion || !item) return;
        porClave.set(`${operacion}|${item}`, { operacion, item, nombre });
      });
      const ventaItems = [...porClave.values()];
      const ops = ventaItems.map(it => ({
        updateOne: {
          filter: { operacion: it.operacion, item: it.item },
          update: { $set: { nombre: it.nombre } },
          upsert: true
        }
      }));
      const result = await ItemVenta.bulkWrite(ops, { ordered: false });
      const insertados = result.upsertedCount || 0;
      const actualizados = result.modifiedCount || 0;
      console.log(` total ${ventaItems.length}, nuevos ${insertados}, actualizados ${actualizados}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

/**
 * Carga el catálogo de ítems y tablas de referencia desde EBC ITEMS.xlsx a MongoDB.
 * Ejecutar una vez (o al actualizar el Excel):
 *   node scripts/importItemsMaestro.js ["ruta\al\archivo.xlsx"]
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const ItemsMaestro = require('../models/ItemsMaestro');
const ItemsRef     = require('../models/ItemsRef');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC ITEMS\\EBC ITEMS.xlsx';

const BATCH = 2000;
const str = v => (v == null ? '' : String(v).trim());
const num = v => { const n = Number(v); return isNaN(n) ? null : n; };

async function leerHoja(wb, nombre) {
  const sh = wb.getWorksheet(nombre);
  if (!sh) throw new Error(`Hoja ${nombre} no encontrada`);
  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    rows.push(row.values.slice(1)); // quitar el índice 0
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

  // ── Tablas de referencia ──────────────────────────────────────────
  const refs = [];

  // LINEAS
  const lineasRows = await leerHoja(wb, 'LINEAS');
  for (const r of lineasRows) {
    const codigo = str(r[0]); const nombre = str(r[1]);
    if (codigo && nombre) refs.push({ tipo: 'linea', codigo, nombre });
  }
  console.log(`  Líneas: ${lineasRows.length}`);

  // FAMILIAS (codigo = "linea_familia" para garantizar unicidad)
  const famRows = await leerHoja(wb, 'FAMILIAS');
  for (const r of famRows) {
    const linea = num(r[0]); const familia = num(r[1]); const nombre = str(r[2]);
    if (linea != null && familia != null)
      refs.push({ tipo: 'familia', codigo: `${linea}_${familia}`, nombre, linea, familia });
  }
  console.log(`  Familias: ${famRows.length}`);

  // SUB_FAMILIAS (codigo = "linea_familia_sub" para garantizar unicidad)
  const sfRows = await leerHoja(wb, 'SUB_FAMILIAS');
  for (const r of sfRows) {
    const linea = num(r[0]); const familia = num(r[1]); const sf = num(r[2]); const nombre = str(r[3]);
    if (sf != null)
      refs.push({ tipo: 'sub_familia', codigo: `${linea}_${familia}_${sf}`, nombre, linea, familia });
  }
  console.log(`  Sub-familias: ${sfRows.length}`);

  // TIPO_ITEMS
  const tiRows = await leerHoja(wb, 'TIPO_ITEMS');
  for (const r of tiRows) {
    const codigo = str(r[0]); const nombre = str(r[1]);
    if (codigo) refs.push({ tipo: 'tipo_item', codigo, nombre });
  }
  console.log(`  Tipos: ${tiRows.length}`);

  // GRUPO_COMPRA
  const gcRows = await leerHoja(wb, 'GRUPO_COMPRA');
  for (const r of gcRows) {
    const codigo = str(r[0]); const nombre = str(r[1]);
    if (codigo) refs.push({ tipo: 'grupo_compra', codigo, nombre });
  }
  console.log(`  Grupos compra: ${gcRows.length}`);

  await ItemsRef.deleteMany({});
  await ItemsRef.insertMany(refs, { ordered: false });
  console.log(`  ✓ ${refs.length} refs importadas.\n`);

  // ── Ítems maestro ─────────────────────────────────────────────────
  console.log('Importando ítems maestro...');
  const itemRows = await leerHoja(wb, 'ITEMS');
  const items = [];
  for (const r of itemRows) {
    const item = num(r[0]);
    if (!item) continue;
    items.push({
      item,
      nombre:        str(r[1]),
      tipoItem:      str(r[2]),
      linea:         num(r[3]),
      familia:       num(r[4]),
      subFamilia:    num(r[5]),
      unidad:        str(r[6]),
      codigoInterno: num(r[7]),
    });
  }

  await ItemsMaestro.deleteMany({});
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    await ItemsMaestro.insertMany(items.slice(i, i + BATCH), { ordered: false });
    done += Math.min(BATCH, items.length - i);
    process.stdout.write(`\r  ${done.toLocaleString()} / ${items.length.toLocaleString()} ítems`);
  }
  console.log(`\n  ✓ ${done.toLocaleString()} ítems importados.\n`);

  await mongoose.disconnect();
  console.log('Importación completada.');
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1); });

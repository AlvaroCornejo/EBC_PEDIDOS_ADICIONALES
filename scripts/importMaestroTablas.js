/**
 * Script de importación del Maestro de Ítems (tablas de referencia + catálogo inicial).
 * Ejecutar UNA VEZ (o cuando se actualice el archivo Excel):
 *
 *   node scripts/importMaestroTablas.js "C:\ruta\al\archivo.xlsx"
 *
 * Lee 3 hojas del Excel:
 *   TABLAS        → MaestroLinea / MaestroFamilia / MaestroSubFamilia / MaestroTipoItem / MaestroUM
 *   ITEMS         → MaestroItem (catálogo inicial, 14,213 ítems)
 *   ITEM_SOCIEDAD → MaestroItemSociedad (asignación ítem↔sociedad)
 *
 * Requiere que MONGODB_URI esté en .env o como variable de entorno.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const MaestroLinea      = require('../models/MaestroLinea');
const MaestroFamilia    = require('../models/MaestroFamilia');
const MaestroSubFamilia = require('../models/MaestroSubFamilia');
const MaestroTipoItem   = require('../models/MaestroTipoItem');
const MaestroUM         = require('../models/MaestroUM');
const MaestroItem         = require('../models/MaestroItem');
const MaestroItemSociedad = require('../models/MaestroItemSociedad');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC ITEMS\\EBC TABLAS PARA ITEMS.xlsx';

// Los códigos de sociedad en ITEM_SOCIEDAD no coinciden 1:1 con los de la colección Sociedad
const SOCIEDAD_MAP = { FACTORIALK: 'FACTORIAL K' };
const mapSociedad = s => SOCIEDAD_MAP[s] || s;

const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : null; };

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel (puede tardar unos segundos)...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  // ── TABLAS: Lineas / Familias / SubFamilias / TipoItem / UM ────────
  console.log('Importando hoja TABLAS...');
  const wsTablas = wb.getWorksheet('TABLAS');
  const lineas = [], familias = [], subFamilias = [], tiposItem = [], ums = [];
  const seenFam = new Set(), seenSub = new Set(), seenTipo = new Set(), seenUM = new Set();

  wsTablas.eachRow((row, i) => {
    if (i < 6) return; // filas 1-5 son título/encabezados
    const v = row.values; // 1-based

    const lineaCod = str(v[2]);
    if (lineaCod) lineas.push({ codigo: lineaCod, nombre: str(v[3]), ver: str(v[4]) === 'S' ? 'S' : 'G' });

    const famLinea = str(v[6]), famCod = str(v[7]);
    if (famLinea && famCod) {
      const key = `${famLinea}|${famCod}`;
      if (!seenFam.has(key)) { seenFam.add(key); familias.push({ linea: famLinea, familia: famCod, nombre: str(v[8]) }); }
    }

    const subLinea = str(v[10]), subFam = str(v[11]), subCod = str(v[12]);
    if (subLinea && subFam && subCod) {
      const key = `${subLinea}|${subFam}|${subCod}`;
      if (!seenSub.has(key)) { seenSub.add(key); subFamilias.push({ linea: subLinea, familia: subFam, subFamilia: subCod, nombre: str(v[13]) }); }
    }

    const tipoCod = str(v[15]);
    if (tipoCod && !seenTipo.has(tipoCod)) { seenTipo.add(tipoCod); tiposItem.push({ codigo: tipoCod, nombre: str(v[16]) }); }

    const umCod = str(v[18]);
    if (umCod && !seenUM.has(umCod)) { seenUM.add(umCod); ums.push({ codigo: umCod, nombre: str(v[19]) }); }
  });

  await MaestroLinea.deleteMany({});      await MaestroLinea.insertMany(lineas, { ordered: false });
  await MaestroFamilia.deleteMany({});    await MaestroFamilia.insertMany(familias, { ordered: false });
  await MaestroSubFamilia.deleteMany({}); await MaestroSubFamilia.insertMany(subFamilias, { ordered: false });
  await MaestroTipoItem.deleteMany({});   await MaestroTipoItem.insertMany(tiposItem, { ordered: false });
  await MaestroUM.deleteMany({});         await MaestroUM.insertMany(ums, { ordered: false });
  console.log(`  ✓ ${lineas.length} líneas, ${familias.length} familias, ${subFamilias.length} sub-familias, ${tiposItem.length} tipos de ítem, ${ums.length} UM.\n`);

  // ── ITEMS: catálogo inicial ─────────────────────────────────────────
  console.log('Importando hoja ITEMS...');
  const wsItems = wb.getWorksheet('ITEMS');
  const items = [];
  wsItems.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const v = row.values;
    const item = num(v[1]);
    if (!item) return;
    items.push({
      item,
      nombre:           str(v[2]),
      tipoItem:         str(v[3]),
      linea:            str(v[4]),
      familia:          str(v[5]),
      subFamilia:       str(v[6]),
      um:               str(v[7]),
      cuentaInventario: num(v[9]),
      cuentaGasto:      num(v[10]),
      cuentaCostoVenta: null,
      cuentaVenta:      null,
      activo:           true,
    });
  });
  await MaestroItem.deleteMany({});
  await MaestroItem.insertMany(items, { ordered: false });
  console.log(`  ✓ ${items.length} ítems importados.\n`);

  // ── ITEM_SOCIEDAD: asignación ítem ↔ sociedad ───────────────────────
  console.log('Importando hoja ITEM_SOCIEDAD...');
  const wsIS = wb.getWorksheet('ITEM_SOCIEDAD');
  const asignaciones = [];
  wsIS.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const sociedad = mapSociedad(str(v[1]));
    const item = num(v[2]);
    if (!sociedad || !item) return;
    asignaciones.push({ item, sociedadCodigo: sociedad });
  });
  await MaestroItemSociedad.deleteMany({});
  await MaestroItemSociedad.insertMany(asignaciones, { ordered: false });
  console.log(`  ✓ ${asignaciones.length} asignaciones ítem↔sociedad importadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

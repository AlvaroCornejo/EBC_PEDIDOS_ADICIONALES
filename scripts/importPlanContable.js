/**
 * Script de importación del Plan Contable (maestro de cuentas para validar Ítems).
 * Ejecutar UNA VEZ (o cuando se actualice el archivo Excel):
 *
 *   node scripts/importPlanContable.js "C:\ruta\al\archivo.xlsx"
 *
 * Lee la hoja PLAN_CONTABLE (columnas: account, localname) y hace upsert en MaestroCuenta.
 * Requiere que MONGODB_URI esté en .env o como variable de entorno.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const MaestroCuenta = require('../models/MaestroCuenta');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC CONTABILIDAD\\EBC PLAN CONTABLE.xlsx';

const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  const ws = wb.getWorksheet('PLAN_CONTABLE');
  const cuentas = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const v = row.values;
    const cuenta = Number(cellVal(v[1]));
    const nombre = String(cellVal(v[2]) || '').trim();
    if (!cuenta || !nombre) return;
    cuentas.push({ cuenta, nombre });
  });

  console.log(`Importando ${cuentas.length} cuentas...`);
  await MaestroCuenta.deleteMany({});
  await MaestroCuenta.insertMany(cuentas, { ordered: false });
  console.log(`  ✓ ${cuentas.length} cuentas importadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

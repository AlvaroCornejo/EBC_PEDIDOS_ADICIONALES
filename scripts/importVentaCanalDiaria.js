/**
 * Importación diaria de EBC VENTAS CABECERA.xlsx a MongoDB (venta diaria por canal,
 * fuente del módulo Pronóstico de Venta).
 *
 * Uso:
 *   node scripts/importVentaCanalDiaria.js [ruta_excel]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). En máquina local pasar como argumento.
 */

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const VentaCanalDiaria = require('../models/VentaCanalDiaria');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC VENTAS\\EBC VENTAS CABECERA.xlsx';

const BATCH = 2000;

const cellVal = c => (c && typeof c === 'object' ? c.result ?? c.text ?? '' : c);
const str = v => String(cellVal(v) ?? '').trim();
const num = v => { const n = Number(cellVal(v)); return Number.isFinite(n) ? n : 0; };

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel (puede tardar unos segundos)...');
  await wb.xlsx.readFile(FILE_PATH);
  console.log('Excel cargado.\n');

  const ws = wb.getWorksheet('VENTAS');
  if (!ws) throw new Error('No se encontró la hoja "VENTAS"');

  console.log('Importando filas...');
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const v = row.values; // 1-based: 1=CANAL,2=FECHA,3=PAX,4=TRANSACCIONES,5=VENTA BRUTA,6=VENTA BRUTA MAS REDENCION,7=OPERACION
    const canal = str(v[1]);
    const fRaw  = v[2];
    const fecha = fRaw instanceof Date ? fRaw : (fRaw ? new Date(cellVal(fRaw)) : null);
    const operacion = str(v[7]);
    if (!canal || !operacion || !fecha || isNaN(fecha)) return;
    rows.push({
      operacion, canal, fecha,
      pax:                    num(v[3]),
      transacciones:          num(v[4]),
      ventaBruta:             num(v[5]),
      ventaBrutaMasRedencion: num(v[6]),
    });
  });

  await VentaCanalDiaria.deleteMany({});
  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await VentaCanalDiaria.insertMany(rows.slice(i, i + BATCH), { ordered: false });
    imported += Math.min(BATCH, rows.length - i);
    process.stdout.write(`\r  ${imported.toLocaleString()} / ${rows.length.toLocaleString()} filas`);
  }
  console.log(`\n  ✓ ${imported.toLocaleString()} filas de venta diaria por canal importadas.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

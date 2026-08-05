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

  console.log('Hojas encontradas en el archivo:', wb.worksheets.map(s => `"${s.name}"`).join(', '));
  const ws = wb.getWorksheet('VENTAS');
  if (!ws) throw new Error('No se encontró la hoja "VENTAS"');
  console.log(`Hoja "VENTAS": ${ws.rowCount} filas (incluye encabezado).`);

  const headerRow = ws.getRow(1).values;
  console.log('Fila 1 (encabezado) tal como se lee:', JSON.stringify(headerRow));
  const filaEjemplo = ws.getRow(2).values;
  console.log('Fila 2 (primer dato) tal como se lee:', JSON.stringify(filaEjemplo));
  console.log();

  console.log('Importando filas...');
  const motivos = { canal: 0, operacion: 0, fecha: 0 };
  // El Excel a veces trae bloques de filas duplicados (mismo operacion+canal+fecha
  // repetido tal cual, ej. un rango de fechas de una operación pegado dos veces) — se
  // dedupe quedándose con la primera fila de cada clave. Si dos filas con la misma clave
  // tienen valores DISTINTOS, no es un duplicado real sino un problema de datos: se avisa
  // en consola para revisarlo a mano en vez de sumarlas o descartarlas en silencio.
  const porClave = new Map();
  let duplicadosIdenticos = 0;
  const conflictos = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const v = row.values; // 1-based: 1=CANAL,2=FECHA,3=PAX,4=TRANSACCIONES,5=VENTA BRUTA,6=VENTA BRUTA MAS REDENCION,7=OPERACION
    const canal = str(v[1]);
    const fRaw  = v[2];
    const fecha = fRaw instanceof Date ? fRaw : (fRaw ? new Date(cellVal(fRaw)) : null);
    const operacion = str(v[7]);
    if (!canal) { motivos.canal++; return; }
    if (!operacion) { motivos.operacion++; return; }
    if (!fecha || isNaN(fecha)) { motivos.fecha++; return; }
    const doc = {
      operacion, canal, fecha,
      pax:                    num(v[3]),
      transacciones:          num(v[4]),
      ventaBruta:             num(v[5]),
      ventaBrutaMasRedencion: num(v[6]),
    };
    const clave = `${operacion}|${canal}|${fecha.toISOString().slice(0, 10)}`;
    const previa = porClave.get(clave);
    if (!previa) { porClave.set(clave, doc); return; }
    const mismosValores = previa.pax === doc.pax && previa.transacciones === doc.transacciones
      && previa.ventaBruta === doc.ventaBruta && previa.ventaBrutaMasRedencion === doc.ventaBrutaMasRedencion;
    if (mismosValores) duplicadosIdenticos++;
    else conflictos.push({ clave, fila: i, previa, nueva: doc });
  });
  console.log(`Filas rechazadas por falta de dato — canal: ${motivos.canal}, operación: ${motivos.operacion}, fecha: ${motivos.fecha}.`);
  if (duplicadosIdenticos) console.log(`  ⚠ ${duplicadosIdenticos} filas duplicadas idénticas (misma operación+canal+fecha) — se descartó la repetida.`);
  if (conflictos.length) {
    console.log(`  ⚠ ${conflictos.length} filas con la misma clave pero VALORES DISTINTOS — se conservó la primera, revisar a mano:`);
    conflictos.forEach(c => console.log(`     ${c.clave} (fila ${c.fila}): previa=${JSON.stringify(c.previa)} nueva=${JSON.stringify(c.nueva)}`));
  }
  const rows = [...porClave.values()];

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

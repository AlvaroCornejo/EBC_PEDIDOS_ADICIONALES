/**
 * Importación diaria de EBC COSTO DE PRODUCCION.xlsx (hoja "Datos") a MongoDB —
 * costo receta vs. costo real de producción de planta, por ítem y mes. El Excel trae
 * todos los meses del año juntos (ENERO ... DICIEMBRE, se detectan por nombre), así que
 * cada corrida reemplaza operación + año completos; los años anteriores no se tocan.
 *
 * Uso:
 *   node scripts/importCostoProduccion.js [ruta_excel] [anio] [operacion]
 *
 * Ruta por defecto: servidor (CORP.PROCESOS). Año por defecto: el actual (hora Lima).
 * Operación por defecto: PLANTA (el archivo es de la planta).
 */
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');

const CostoProduccion = require('../models/CostoProduccion');
const { leerCostoProduccion } = require('../utils/costoProduccionExcel');

const FILE_PATH = process.argv[2]
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC INDICADORES PLANTA\\EBC COSTO DE PRODUCCION.xlsx';
const ANIO = Number(process.argv[3])
  || Number(new Date().toLocaleString('en-CA', { timeZone: 'America/Lima', year: 'numeric' }));
const OPERACION = (process.argv[4] || 'PLANTA').trim().toUpperCase();

async function main() {
  console.log(`\nArchivo: ${FILE_PATH}`);
  console.log(`Operación: ${OPERACION} · Año: ${ANIO}`);

  const wb = new ExcelJS.Workbook();
  console.log('Leyendo Excel...');
  await wb.xlsx.readFile(FILE_PATH);
  const { docs, meses, items, sinReceta } = leerCostoProduccion(wb, ANIO, OPERACION);
  console.log(`"Datos": ${items} ítems, meses ${meses.join(', ')} → ${docs.length} filas ítem×mes con producción.`);
  if (sinReceta) console.log(`  ⚠ ${sinReceta} ítems sin costo receta (se cargan, pero quedan fuera de las desviaciones).`);
  if (!docs.length) throw new Error('El Excel no trae producción: no se reemplaza nada.');

  console.log('Conectando a MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const cargadoEn = new Date();
  await CostoProduccion.deleteMany({ operacion: OPERACION, anio: ANIO });
  await CostoProduccion.insertMany(docs.map(d => ({ ...d, cargadoEn })), { ordered: false });
  console.log(`  ✓ ${docs.length.toLocaleString()} filas cargadas para ${OPERACION} ${ANIO}.\n`);

  await mongoose.disconnect();
  console.log('✅ Importación completada.\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});

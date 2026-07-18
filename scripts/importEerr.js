require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const Eerr     = require('../models/Eerr');

const FILE_PATH = process.argv[2]
  || process.env.EBC_EERR_PATH
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC EERR\\EBC EERR.xlsx';

const BATCH = 2000;
const str = v => (v == null ? '' : String(v).trim());
const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);

  const sh = wb.getWorksheet('EERR');
  if (!sh) throw new Error('No se encontró la hoja EERR');

  // Leer encabezados fila 1
  const header = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = str(cell.value).toUpperCase().replace(/\s+/g, '_');
    if (key) header[key] = col;
  });

  const col = name => header[name.toUpperCase().replace(/\s+/g, '_')];
  const iUnidad   = col('UNIDAD');
  const iPeriodo  = col('PERIODO');
  const iAd       = col('AD');
  const iDescAd   = col('DESCRIPCION_AD');
  const iPersona  = col('PERSONA');
  const iFactura  = col('FACTURA');
  const iGrupo    = col('GRUPO');
  const iCuenta   = col('CUENTA');
  const iNombreCuenta = col('NOMBRE_CUENTA');
  const iSoles    = col('SOLES');
  const iSociedad = col('SOCIEDAD');
  const iSede     = col('SEDE');

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const get = i => (i ? row.getCell(i).value : null);
    const periodo = num(get(iPeriodo));
    if (!periodo) return;
    rows.push({
      unidad:        str(get(iUnidad)),
      periodo,
      ad:            str(get(iAd)),
      descripcionAd: str(get(iDescAd)),
      persona:       str(get(iPersona)),
      factura:       str(get(iFactura)),
      grupo:         str(get(iGrupo)),
      cuenta:        str(get(iCuenta)),
      nombreCuenta:  str(get(iNombreCuenta)),
      soles:         num(get(iSoles)),
      sociedad:      str(get(iSociedad)),
      sede:          str(get(iSede)),
    });
  });

  if (!rows.length) {
    console.log('Sin filas en la hoja EERR');
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  await Eerr.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Eerr.insertMany(rows.slice(i, i + BATCH), { ordered: false });
    inserted += Math.min(BATCH, rows.length - i);
    process.stdout.write(`\r  ${inserted}/${rows.length} filas cargadas...`);
  }
  console.log(`\n✓ ${rows.length} registros EERR importados`);

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

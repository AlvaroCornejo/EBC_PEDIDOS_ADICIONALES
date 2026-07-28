require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose   = require('mongoose');
const ExcelJS    = require('exceljs');
const CostoVenta = require('../models/CostoVenta');

const FILE_PATH = process.argv[2]
  || process.env.EBC_COSTO_VENTA_PATH
  || 'C:\\Users\\CORP.PROCESOS\\Box\\EBC\\EBC AI\\EBC AI BASES\\EBC EERR\\EBC EERR COSTO VENTA.xlsx';

const BATCH = 2000;
const str = v => (v == null ? '' : String(v).trim());
const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);

  const sh = wb.getWorksheet('MOVIMIENTOS');
  if (!sh) throw new Error('No se encontró la hoja MOVIMIENTOS');

  // Leer encabezados fila 1
  const header = {};
  sh.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = str(cell.value).toUpperCase().replace(/\s+/g, '_');
    if (key) header[key] = col;
  });

  const col = name => header[name.toUpperCase().replace(/\s+/g, '_')];
  const iAlmacen     = col('ALMACEN');
  const iItem        = col('ITEM');
  const iTransaccion = col('TRANSACCION');
  const iPeriodo     = col('PERIODO');
  const iCantidad    = col('CANTIDAD');
  const iNombreOp    = col('NOMBRE_OP');
  const iGrupoEerr   = col('GRUPO_EERR');
  const iSoles       = col('SOLES');
  const iNombreItem  = col('NOMBRE_ITEM');
  const iGrupo       = col('GRUPO');
  const iSede        = col('SEDE');

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const get = i => (i ? row.getCell(i).value : null);
    const periodo = num(get(iPeriodo));
    if (!periodo) return;
    rows.push({
      almacen:     str(get(iAlmacen)),
      item:        str(get(iItem)),
      transaccion: str(get(iTransaccion)),
      periodo,
      cantidad:    num(get(iCantidad)),
      nombreOp:    str(get(iNombreOp)),
      grupoEerr:   str(get(iGrupoEerr)),
      soles:       num(get(iSoles)),
      nombreItem:  str(get(iNombreItem)),
      grupo:       str(get(iGrupo)),
      sede:        str(get(iSede)),
    });
  });

  if (!rows.length) {
    console.log('Sin filas en la hoja MOVIMIENTOS');
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  await CostoVenta.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await CostoVenta.insertMany(rows.slice(i, i + BATCH), { ordered: false });
    inserted += Math.min(BATCH, rows.length - i);
    process.stdout.write(`\r  ${inserted}/${rows.length} filas cargadas...`);
  }
  console.log(`\n✓ ${rows.length} registros CostoVenta importados`);

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

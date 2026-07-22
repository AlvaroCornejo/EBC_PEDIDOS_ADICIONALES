require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria          = require('../models/CajaDiaria');
const TcMovimiento        = require('../models/TcMovimiento');

const BATCH = 2000;
const str = v => (v == null ? '' : String(v).trim());
const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);
const numOrNull = v => (v == null || v === '') ? null : (isNaN(Number(v)) ? null : Number(v));
const dt  = v => (v instanceof Date ? v : (v ? new Date(v) : null));

function headerMap(sheet) {
  const header = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = str(cell.value).toUpperCase().replace(/\s+/g, '_');
    if (key) header[key] = col;
  });
  return name => header[name.toUpperCase().replace(/\s+/g, '_')];
}

async function insertBatched(Model, rows, label) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Model.insertMany(rows.slice(i, i + BATCH), { ordered: false });
    inserted += Math.min(BATCH, rows.length - i);
  }
  console.log(`  ✓ ${label}: ${inserted} filas`);
}

async function leerEECC(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const rows = [];
  wb.worksheets.forEach(sh => {
    const col = headerMap(sh);
    const iFOp   = col('F._OPERACIÓN');
    const iFVal  = col('F._VALOR');
    const iCod   = col('CÓDIGO');
    const iDoc   = col('Nº._DOC.');
    const iConc  = col('CONCEPTO');
    const iImp   = col('IMPORTE');
    const iOf    = col('OFICINA');
    const iBanco = col('BANCO');
    const iMon   = col('MONEDA');
    if (!iFOp || !iImp || !iMon) return; // hoja sin la estructura esperada

    sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const get = i => (i ? row.getCell(i).value : null);
      const fOp = dt(get(iFOp));
      const monRaw = str(get(iMon)).toUpperCase();
      if (!fOp || !monRaw) return;
      const moneda = monRaw.startsWith('S') ? 'SOL' : monRaw.startsWith('U') || monRaw.startsWith('D') ? 'USD' : null;
      if (!moneda) return;
      rows.push({
        banco:          str(get(iBanco)),
        moneda,
        fechaOperacion: fOp,
        fechaValor:     dt(get(iFVal)) || fOp,
        codigo:         str(get(iCod)),
        nroDoc:         str(get(iDoc)),
        concepto:       str(get(iConc)),
        importe:        num(get(iImp)),
        oficina:        str(get(iOf)),
      });
    });
  });
  return rows;
}

async function importEECC(sociedad, filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
  if (!paths.length) return;

  let rows = [];
  for (const p of paths) rows = rows.concat((await leerEECC(p)).map(r => ({ sociedad, ...r })));

  await EeccMovimiento.deleteMany({ sociedad });
  if (rows.length) await insertBatched(EeccMovimiento, rows, `EECC movimientos (${paths.length} archivo${paths.length>1?'s':''})`);
}

async function leerCobranza(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // ── Hoja COBRANZA ERP ──
  const shErp = wb.getWorksheet('COBRANZA ERP');
  const erpRows = [];
  if (shErp) {
    const col = headerMap(shErp);
    const iDoc   = col('DOCUMENTO');
    const iFecha = col('FECHA_COBRANZA');
    const iMedio = col('MEDIO_PAGO');
    const iOtro  = col('OTRO_MEDIO_DE_PAGO');
    const iTc    = col('TC');
    const iTarj  = col('TARJETA');
    const iTCam  = col('TIPO_DE_CAMBIO');
    const iCobM  = col('COBRANZA_MONEDA');
    const iMon   = col('MONEDA');
    const iVenta = col('VENTA');
    const iTip   = col('TIP');
    const iCobr  = col('COBRANZA');
    const iCanal = col('CANAL');
    const iFDoc  = col('FECHA_DOCUMENTO');
    const iFPed  = col('FECHA_PEDIDO');
    const iCliente = col('CLIENTE');
    const iFact  = col('FACTURADO');
    const iEstado = col('ESTADO');

    shErp.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const get = i => (i ? row.getCell(i).value : null);
      const fecha = dt(get(iFecha));
      if (!fecha) return;
      const monRaw = str(get(iMon));
      const moneda = /dolar/i.test(monRaw) ? 'Dolares' : 'Soles';
      erpRows.push({
        documento:      str(get(iDoc)),
        fecha,
        medioPago:      str(get(iMedio)),
        otroMedioPago:  str(get(iOtro)),
        tc:             str(get(iTc)),
        tarjeta:        str(get(iTarj)),
        tipoCambio:     num(get(iTCam)),
        cobranzaMoneda: num(get(iCobM)),
        moneda,
        venta:          num(get(iVenta)),
        tip:            num(get(iTip)),
        cobranza:       num(get(iCobr)),
        canal:          str(get(iCanal)),
        fechaDocumento: dt(get(iFDoc)),
        fechaPedido:    dt(get(iFPed)),
        cliente:        str(get(iCliente)),
        facturado:      num(get(iFact)),
        estado:         str(get(iEstado)),
      });
    });
  }

  // ── Hoja CAJA ──
  const shCaja = wb.getWorksheet('CAJA');
  const cajaRows = [];
  if (shCaja) {
    const col = headerMap(shCaja);
    const iFecha  = col('FECHA');
    const iEf     = col('COBRANZA_EFECTIVO');
    const iTip    = col('TIP_EFECTIVO');
    const iTipCmz = col('TIP_EFECTIVO_CMZ');
    const iTFact  = col('TIP_FACT');
    const iTFactC = col('TIP_FACT_CMZ');
    const iVuelto = col('VUELTO_EN_SOLES');
    const iDepPen = col('DEPOSITO_PEN');
    const iEfUsd  = col('COBRANZA_EFECTIVO_USD');
    const iTipUsd = col('TIP_USD');
    const iDepUsd = col('DEPOSITO_USD');

    shCaja.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const get = i => (i ? row.getCell(i).value : null);
      const fecha = dt(get(iFecha));
      if (!fecha) return;
      cajaRows.push({
        fecha,
        cobranzaEfectivo:    num(get(iEf)),
        tipEfectivo:         num(get(iTip)),
        tipEfectivoCmz:      num(get(iTipCmz)),
        tipFact:             num(get(iTFact)),
        tipFactCmz:          num(get(iTFactC)),
        vueltoSoles:         num(get(iVuelto)),
        depositoPen:         numOrNull(get(iDepPen)),
        cobranzaEfectivoUsd: num(get(iEfUsd)),
        tipUsd:              num(get(iTipUsd)),
        depositoUsd:         numOrNull(get(iDepUsd)),
      });
    });
  }

  return { erpRows, cajaRows };
}

async function importCobranza(sociedad, filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
  if (!paths.length) return;

  let erpRows = [], cajaRows = [];
  for (const p of paths) {
    const r = await leerCobranza(p);
    erpRows  = erpRows.concat(r.erpRows.map(x => ({ sociedad, ...x })));
    cajaRows = cajaRows.concat(r.cajaRows.map(x => ({ sociedad, ...x })));
  }

  // CajaDiaria tiene indice unico por {sociedad,fecha}: si varios archivos se solapan en
  // fechas, se conserva la ultima ocurrencia (archivo mas reciente en la lista) por fecha.
  const cajaPorFecha = {};
  cajaRows.forEach(r => { cajaPorFecha[r.fecha.getTime()] = r; });
  const cajaRowsDedup = Object.values(cajaPorFecha);

  await CobranzaErp.deleteMany({ sociedad });
  await CajaDiaria.deleteMany({ sociedad });
  const suf = ` (${paths.length} archivo${paths.length>1?'s':''})`;
  if (erpRows.length)       await insertBatched(CobranzaErp, erpRows, 'Cobranza ERP' + suf);
  if (cajaRowsDedup.length) await insertBatched(CajaDiaria, cajaRowsDedup, 'Caja diaria' + suf);
}

async function leerTC(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sh = wb.getWorksheet('Q TC TODAS');
  if (!sh) return [];

  const col = headerMap(sh);
  const iEstab  = col('ESTABLECIMIENTO');
  const iTarj   = col('TARJETA');
  const iFVenta = col('FECHA_VENTA');
  const iVenta  = col('VENTA');
  const iEstado = col('ESTADO');
  const iComM   = col('COMISION_MERCHANT');
  const iComE   = col('COMISION_EMISOR');
  const iIgv    = col('IGV_COMISION');
  const iDep    = col('DEPOSITO');
  const iFDep   = col('FECHA_DEPOSITO');
  const iComT   = col('COMISION_TOTAL');
  const iTc     = col('TC');
  const iAutor  = col('AUTORIZACION');
  const iMon    = col('MONEDA');

  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const get = i => (i ? row.getCell(i).value : null);
    const fechaVenta = dt(get(iFVenta));
    if (!fechaVenta) return;
    const tarjeta = str(get(iTarj));
    rows.push({
      establecimiento:  str(get(iEstab)),
      tarjeta,
      tarjetaUlt4:       tarjeta.slice(-4),
      fechaVenta,
      venta:            num(get(iVenta)),
      estado:           str(get(iEstado)),
      comisionMerchant: num(get(iComM)),
      comisionEmisor:   num(get(iComE)),
      igvComision:      num(get(iIgv)),
      deposito:         num(get(iDep)),
      fechaDeposito:    dt(get(iFDep)),
      comisionTotal:    num(get(iComT)),
      tc:               str(get(iTc)),
      autorizacion:     str(get(iAutor)),
      moneda:           str(get(iMon)),
    });
  });
  return rows;
}

async function importTC(sociedad, filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
  if (!paths.length) return;

  let rows = [];
  for (const p of paths) rows = rows.concat((await leerTC(p)).map(r => ({ sociedad, ...r })));

  await TcMovimiento.deleteMany({ sociedad });
  if (rows.length) await insertBatched(TcMovimiento, rows, `TC movimientos (${paths.length} archivo${paths.length>1?'s':''})`);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const configs = await ConciliacionConfig.find({});
  if (!configs.length) {
    console.log('Sin configuración de Conciliación (Admin → Conciliación de Cobranzas)');
    await mongoose.disconnect();
    return;
  }

  for (const cfg of configs) {
    console.log(`\nSociedad: ${cfg.sociedad}`);
    try {
      await importEECC(cfg.sociedad, cfg.rutaEECC);
      await importCobranza(cfg.sociedad, cfg.rutaCobranza);
      await importTC(cfg.sociedad, cfg.rutaTC);
    } catch (e) {
      console.error(`  ✗ Error en ${cfg.sociedad}: ${e.message}`);
    }
  }

  console.log('\n✓ Importación de conciliación finalizada');
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

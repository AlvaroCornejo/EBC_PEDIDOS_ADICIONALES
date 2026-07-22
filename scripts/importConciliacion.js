require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const ExcelJS  = require('exceljs');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria          = require('../models/CajaDiaria');

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

async function importEECC(sociedad, filePath) {
  if (!filePath) return;
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
        sociedad,
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

  await EeccMovimiento.deleteMany({ sociedad });
  if (rows.length) await insertBatched(EeccMovimiento, rows, 'EECC movimientos');
}

async function importCobranza(sociedad, filePath) {
  if (!filePath) return;
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
        sociedad,
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
        sociedad,
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

  await CobranzaErp.deleteMany({ sociedad });
  await CajaDiaria.deleteMany({ sociedad });
  if (erpRows.length)  await insertBatched(CobranzaErp, erpRows, 'Cobranza ERP');
  if (cajaRows.length) await insertBatched(CajaDiaria, cajaRows, 'Caja diaria');
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
    } catch (e) {
      console.error(`  ✗ Error en ${cfg.sociedad}: ${e.message}`);
    }
  }

  console.log('\n✓ Importación de conciliación finalizada');
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

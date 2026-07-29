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
const TcEquivalencia      = require('../models/TcEquivalencia');

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

// Algunas hojas (ej. bancos IBK) traen una hoja por banco+moneda ("IBK SOL") sin columnas
// BANCO/MONEDA propias — se infieren del nombre de la hoja: tokens separados por espacio o
// guion bajo; SOL/SOLES/PEN -> SOL, DOL/DOLAR/DOLARES/USD -> USD, el resto forma el banco.
function inferirBancoMonedaDeHoja(nombreHoja) {
  const tokens = String(nombreHoja || '').toUpperCase().split(/[\s_]+/).filter(Boolean);
  let moneda = null;
  const bancoTokens = [];
  tokens.forEach(t => {
    if (['SOL', 'SOLES', 'PEN'].includes(t)) moneda = 'SOL';
    else if (['DOL', 'DOLAR', 'DOLARES', 'USD'].includes(t)) moneda = 'USD';
    else bancoTokens.push(t);
  });
  return { banco: bancoTokens.join(' '), moneda };
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
    if (!iFOp || !iImp) return; // hoja sin la estructura minima esperada

    const { banco: bancoHoja, moneda: monedaHoja } = inferirBancoMonedaDeHoja(sh.name);

    sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const get = i => (i ? row.getCell(i).value : null);
      const fOp = dt(get(iFOp));
      const monRaw = str(get(iMon)).toUpperCase();
      const moneda = monRaw.startsWith('S') ? 'SOL' : monRaw.startsWith('U') || monRaw.startsWith('D') ? 'USD' : monedaHoja;
      if (!fOp || !moneda) return;
      rows.push({
        banco:          str(get(iBanco)) || bancoHoja,
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
      // TARJETA a veces pierde el cero inicial (celda numerica en Excel, ej. "567" en vez
      // de "0567"); son siempre los ultimos 4 digitos, se rellena para que calce con Q TC.
      const tarjRaw = str(get(iTarj));
      erpRows.push({
        documento:      str(get(iDoc)),
        fecha,
        medioPago:      str(get(iMedio)),
        otroMedioPago:  str(get(iOtro)),
        tc:             str(get(iTc)),
        tarjeta:        tarjRaw ? tarjRaw.padStart(4, '0') : '',
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
  // El nombre de la hoja varia por sociedad ("Q TC TODAS", "TC TODAS", etc.) — se busca
  // cualquier hoja cuyo nombre contenga "TC TODAS" en vez de exigir un nombre exacto.
  const sh = wb.worksheets.find(w => (w.name || '').trim().toUpperCase().includes('TC TODAS'));
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

// Hoja "PARAMETROS", sección "1. EQUIVALENCIA PARA CONCILIACION DEPOSITO TC": una tabla
// con columnas TC / EECC (cabecera detectada por texto, no por posición fija) que indica
// qué operador de TC liquida contra qué categoría de descripción del EECC. Un operador
// puede tener varias filas (ej. NIUBIZ -> COMPAÑIA PERU y NIUBIZ -> ABONO VISANET).
async function leerEquivalenciaTC(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sh = wb.getWorksheet('PARAMETROS');
  if (!sh) return [];

  const pares = [];
  let headerRow = null;
  sh.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const b = str(row.getCell(2).value).toUpperCase();
    const c = str(row.getCell(3).value).toUpperCase();
    if (b === 'TC' && c === 'EECC') { headerRow = rowNum; return; }
    if (headerRow && rowNum > headerRow) {
      const tc   = str(row.getCell(2).value);
      const eecc = str(row.getCell(3).value);
      if (tc && eecc) pares.push({ tc, eecc });
    }
  });
  return pares;
}

async function importEquivalenciaTC(sociedad, filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
  await TcEquivalencia.deleteMany({ sociedad });
  if (!paths.length) return;

  let pares = [];
  for (const p of paths) pares = pares.concat(await leerEquivalenciaTC(p));

  const vistos = new Set();
  const rows = [];
  pares.forEach(({ tc, eecc }) => {
    const k = `${tc}||${eecc}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    rows.push({ sociedad, tc, eecc });
  });
  if (rows.length) await insertBatched(TcEquivalencia, rows, `Equivalencia TC (${paths.length} archivo${paths.length>1?'s':''})`);
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
      await importEquivalenciaTC(cfg.sociedad, cfg.rutaTC);
    } catch (e) {
      console.error(`  ✗ Error en ${cfg.sociedad}: ${e.message}`);
    }
  }

  console.log('\n✓ Importación de conciliación finalizada');
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

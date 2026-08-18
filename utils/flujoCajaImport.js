// Parsers compartidos para Flujo de Caja — usados tanto por el sync diario
// (scripts/importFlujoCaja.js, lee de disco) como por la carga manual
// (routes/flujoCaja.js, lee de un buffer subido). Ambos caminos terminan
// llamando estas mismas funciones para no duplicar la lógica de columnas.

const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const norm = s => String(s ?? '').trim().toUpperCase();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function leerEncabezado(ws) {
  const header = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { header[norm(cellVal(cell.value))] = col; });
  return header;
}
function colFn(header) {
  return (...nombres) => { for (const n of nombres) if (header[n] !== undefined) return header[n]; return undefined; };
}
// Algunos archivos (ej. BN) traen celdas de texto como "rich text"
// ({richText:[{text:'...'}]}) en vez de un string plano — hay que extraer
// el texto antes de usarlo, tanto en encabezados como en valores de fila.
function cellVal(cell) {
  if (cell && typeof cell === 'object') {
    if ('result' in cell) return cell.result;
    if (Array.isArray(cell.richText)) return cell.richText.map(r => r.text).join('');
  }
  return cell;
}
function cellDate(v) { return v instanceof Date ? v : null; }
// 'DD/MM/YYYY' -> Date (UTC), o null si no matchea ese formato
function parseFechaDDMMYYYY(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

/** BBVA (soles y dólares, mismo formato): F. Operación, F. Valor, Código, Nº. Doc., Concepto, Importe, Oficina */
function parseBBVA(ws) {
  const h = leerEncabezado(ws);
  const col = colFn(h);
  const COL = {
    fecha: col('F. OPERACIÓN', 'F. OPERACION'),
    fechaValor: col('F. VALOR'),
    numDoc: col('Nº. DOC.', 'N°. DOC.', 'NO. DOC.'),
    concepto: col('CONCEPTO'),
    importe: col('IMPORTE'),
  };
  if (COL.fecha === undefined || COL.importe === undefined) throw new Error('BBVA: no se encontraron las columnas esperadas');

  const movs = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const fecha = cellDate(cellVal(v[COL.fecha]));
    if (!fecha) return; // filas de Saldo Inicial/Final no traen fecha
    const numDoc = COL.numDoc !== undefined ? String(cellVal(v[COL.numDoc]) ?? '').trim() : '';
    movs.push({
      fecha,
      fechaValor: COL.fechaValor !== undefined ? cellDate(cellVal(v[COL.fechaValor])) : null,
      numeroOperacion: numDoc || null,
      glosa: COL.concepto !== undefined ? String(cellVal(v[COL.concepto]) ?? '').trim() : '',
      importe: num(cellVal(v[COL.importe])),
    });
  });
  return movs;
}

/** BCP (soles y dólares, mismo formato): Fecha, Fecha valuta, Descripción operación, Monto, Saldo, ..., Operación - Número, ... */
function parseBCP(ws) {
  const h = leerEncabezado(ws);
  const col = colFn(h);
  const COL = {
    fecha: col('FECHA'),
    concepto: col('DESCRIPCIÓN OPERACIÓN', 'DESCRIPCION OPERACION'),
    monto: col('MONTO'),
    numOp: col('OPERACIÓN - NÚMERO', 'OPERACION - NUMERO'),
  };
  if (COL.fecha === undefined || COL.monto === undefined) throw new Error('BCP: no se encontraron las columnas esperadas');

  const movs = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const raw = cellVal(v[COL.fecha]);
    if (!raw) return;
    const fecha = raw instanceof Date ? raw : parseFechaDDMMYYYY(raw);
    if (!fecha) return;
    const numOp = COL.numOp !== undefined ? String(cellVal(v[COL.numOp]) ?? '').trim() : '';
    movs.push({
      fecha,
      fechaValor: null,
      numeroOperacion: numOp || null,
      glosa: COL.concepto !== undefined ? String(cellVal(v[COL.concepto]) ?? '').trim() : '',
      importe: num(cellVal(v[COL.monto])),
    });
  });
  return movs;
}

/** BN (solo soles): CODIFICACION NRO CHEQUE, CARGOS, ABONOS, SALDOS, DIA */
function parseBN(ws) {
  const h = leerEncabezado(ws);
  const col = colFn(h);
  const COL = {
    glosa: col('CODIFICACION NRO CHEQUE'),
    cargos: col('CARGOS'),
    abonos: col('ABONOS'),
    dia: col('DIA'),
  };
  if (COL.glosa === undefined) throw new Error('BN: no se encontraron las columnas esperadas');

  const movs = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const glosa = String(cellVal(v[COL.glosa]) ?? '').trim();
    if (!glosa || glosa === 'SALDO ANTERIOR') return; // marcador de saldo, sin fecha real
    const fecha = cellDate(cellVal(v[COL.dia]));
    if (!fecha) return;
    const cargo = num(cellVal(v[COL.cargos]));
    const abono = num(cellVal(v[COL.abonos]));
    movs.push({
      fecha,
      fechaValor: null,
      numeroOperacion: null, // no viene separado del texto de glosa
      glosa,
      importe: abono - cargo,
    });
  });
  return movs;
}

/** IBK (solo soles): Fecha de operación, Fecha de proceso, Nro. de operación, Movimiento, Descripción, Canal, Cargo, Abono, Saldo contable */
function parseIBK(ws) {
  const h = leerEncabezado(ws);
  const col = colFn(h);
  const COL = {
    fecha: col('FECHA DE OPERACIÓN', 'FECHA DE OPERACION'),
    numOp: col('NRO. DE OPERACIÓN', 'NRO. DE OPERACION'),
    movimiento: col('MOVIMIENTO'),
    descripcion: col('DESCRIPCIÓN', 'DESCRIPCION'),
    cargo: col('CARGO'),
    abono: col('ABONO'),
  };
  if (COL.fecha === undefined) throw new Error('IBK: no se encontraron las columnas esperadas');

  const movs = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values;
    const raw = cellVal(v[COL.fecha]);
    if (!raw) return;
    const fecha = raw instanceof Date ? raw : parseFechaDDMMYYYY(raw);
    if (!fecha) return;
    let numOp = COL.numOp !== undefined ? String(cellVal(v[COL.numOp]) ?? '').trim() : '';
    // En parte del archivo esta columna trae por error una fecha duplicada
    // en vez del número real (inconsistencia del propio banco) — se
    // descarta en vez de guardar una fecha como si fuera un número de op.
    if (!numOp || numOp === '-' || parseFechaDDMMYYYY(numOp)) numOp = '';
    const glosaTxt = [COL.movimiento, COL.descripcion]
      .filter(c => c !== undefined)
      .map(c => String(cellVal(v[c]) ?? '').trim())
      .filter(Boolean)
      .join(' — ');
    movs.push({
      fecha,
      fechaValor: null,
      numeroOperacion: numOp || null,
      glosa: glosaTxt,
      importe: num(cellVal(v[COL.abono])) - num(cellVal(v[COL.cargo])),
    });
  });
  return movs;
}

const PARSERS_BANCO = { BBVA: parseBBVA, BCP: parseBCP, BN: parseBN, IBK: parseIBK };

/**
 * Lee un archivo .xlsx de movimiento bancario (desde path o buffer) y
 * devuelve los movimientos parseados según el banco indicado.
 */
async function leerMovimientoBanco(banco, pathOrBuffer) {
  const parser = PARSERS_BANCO[banco];
  if (!parser) throw new Error(`Banco no soportado: ${banco}`);
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(pathOrBuffer)) await wb.xlsx.load(pathOrBuffer);
  else await wb.xlsx.readFile(pathOrBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas');
  return parser(ws);
}

/**
 * Lee PagosSpring.xls (formato legacy .xls, vía SheetJS ya que ExcelJS no lo
 * soporta) desde path o buffer. Devuelve filas crudas — la resolución de
 * sociedad (CompaniaCodigo -> sociedad) se hace en el caller, no aquí.
 */
function leerPagosERP(pathOrBuffer) {
  const wb = Buffer.isBuffer(pathOrBuffer)
    ? XLSX.read(pathOrBuffer, { type: 'buffer', cellDates: true })
    : XLSX.readFile(pathOrBuffer, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('PagosSpring: el archivo no tiene hojas');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: true });

  return rows
    .filter(r => r.CuentaBancaria && r.NumeroPago != null)
    .map(r => ({
      cuentaBancaria:   String(r.CuentaBancaria).trim(),
      companiaCodigo:   r.CompaniaCodigo != null ? String(r.CompaniaCodigo).trim() : '',
      numeroPago:       Number(r.NumeroPago),
      pagarA:           String(r.PagarA || '').trim(),
      moneda:           String(r.MonedaPago || '').trim(),
      fechaPago:        r.FechaPago instanceof Date ? r.FechaPago : null,
      montoLocal:       num(r.PagoMonedaLocal),
      montoExtranjero:  num(r.PagoMonedaExtranjera),
      tipoPago:         String(r.TipoPago || '').trim(),
      voucherPago:      String(r.VoucherPago || '').trim(),
    }));
}

module.exports = { leerMovimientoBanco, leerPagosERP, PARSERS_BANCO };

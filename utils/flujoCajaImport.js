// Parsers y descubrimiento de archivos para Flujo de Caja — usados tanto por
// el sync diario (scripts/importFlujoCaja.js) como por la carga manual
// (routes/flujoCaja.js). Ambos caminos leen los mismos 2 directorios fijos
// (Estado de Cuenta / Pagos ERP, configurables en Admin) y llaman las mismas
// funciones de parseo para no duplicar la lógica de columnas.
//
// Convención de nombres en la carpeta de Estado de Cuenta:
//   "{SOCIEDAD} {BANCO} {MONEDA}.xlsx"  (ej. "FACTORIAL K BBVA PEN.xlsx")
// La sociedad puede tener espacios (ej. "FACTORIAL K") — banco y moneda son
// siempre los últimos 2 tokens del nombre de archivo (sin extensión).
//
// La carpeta de Pagos ERP contiene uno o más .csv con TODAS las sociedades
// juntas (se distinguen por la columna CompaniaCodigo, resuelta contra el
// catálogo CompaniaCodigo por el caller).

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const BANCOS_VALIDOS = ['BBVA', 'BCP', 'BN', 'IBK'];
const MONEDAS_VALIDAS = ['PEN', 'USD'];

const norm = s => String(s ?? '').trim().toUpperCase();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Algunos exports del banco (ej. BBVA) anteponen un bloque de metadatos
// ("Histórico de Movimientos", "Periodo: de...", "Cuenta Actual: ...") de
// largo variable antes del encabezado real — no siempre está en la fila 1.
// Se escanean las primeras filas hasta encontrar una que contenga al menos
// una de las columnas "señal" esperadas para ese banco.
function leerEncabezado(ws, señales, maxScan = 25) {
  for (let r = 1; r <= Math.min(maxScan, ws.rowCount || maxScan); r++) {
    const header = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => { header[norm(cellVal(cell.value))] = col; });
    if (señales.some(s => header[s] !== undefined)) return { header, filaEncabezado: r };
  }
  return { header: {}, filaEncabezado: 1 };
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
  const { header: h, filaEncabezado } = leerEncabezado(ws, ['IMPORTE', 'CONCEPTO']);
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
    if (i <= filaEncabezado) return;
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
  const { header: h, filaEncabezado } = leerEncabezado(ws, ['MONTO']);
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
    if (i <= filaEncabezado) return;
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
  const { header: h, filaEncabezado } = leerEncabezado(ws, ['CARGOS', 'ABONOS']);
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
    if (i <= filaEncabezado) return;
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
  const { header: h, filaEncabezado } = leerEncabezado(ws, ['MOVIMIENTO', 'CARGO', 'ABONO']);
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
    if (i <= filaEncabezado) return;
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

// ── CSV genérico (con soporte de comas dentro de comillas, ej. "APELLIDO, NOMBRE") ──
function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}
// 'DD/MM/YYYY HH:MM:SS:ms' o 'DD/MM/YYYY' -> Date (UTC); solo se usa la parte de fecha
function parseFechaPago(v) {
  if (!v) return null;
  const soloFecha = String(v).split(' ')[0];
  return parseFechaDDMMYYYY(soloFecha);
}

/**
 * Lee un CSV de Pagos ERP (desde path o buffer/texto) y devuelve filas
 * crudas — la resolución de sociedad (CompaniaCodigo -> sociedad) se hace
 * en el caller, no aquí.
 */
function leerPagosERP(pathOrBuffer) {
  const text = Buffer.isBuffer(pathOrBuffer)
    ? pathOrBuffer.toString('latin1')
    : (typeof pathOrBuffer === 'string' && fs.existsSync(pathOrBuffer) ? fs.readFileSync(pathOrBuffer, 'latin1') : pathOrBuffer);
  const rows = parseCSV(text);

  return rows
    .filter(r => r.CuentaBancaria && r.NumeroPago !== '')
    .map(r => ({
      cuentaBancaria:   String(r.CuentaBancaria).trim(),
      companiaCodigo:   String(r.CompaniaCodigo || '').trim(),
      numeroPago:       Number(r.NumeroPago),
      pagarA:           String(r.PagarA || '').trim(),
      moneda:           String(r.MonedaPago || '').trim(),
      fechaPago:        parseFechaPago(r.FechaPago),
      montoLocal:       num(r.PagoMonedaLocal),
      montoExtranjero:  num(r.PagoMonedaExtranjera),
      tipoPago:         String(r.TipoPago || '').trim(),
      voucherPago:      String(r.VoucherPago || '').trim(),
    }));
}

/**
 * Lista los archivos .xlsx de la carpeta de Estado de Cuenta, parseando
 * sociedad/banco/moneda desde el nombre ("{SOCIEDAD} {BANCO} {MONEDA}.xlsx").
 * Ignora (con advertencia) archivos que no matcheen el patrón esperado.
 */
function listarArchivosEstadoCuenta(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const archivos = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx'));
  const out = [];
  for (const nombreArchivo of archivos) {
    const base = nombreArchivo.replace(/\.xlsx$/i, '');
    const tokens = base.split(' ').filter(Boolean);
    if (tokens.length < 3) { out.push({ nombreArchivo, error: 'nombre no reconocido' }); continue; }
    const moneda = tokens[tokens.length - 1].toUpperCase();
    const banco = tokens[tokens.length - 2].toUpperCase();
    const sociedad = tokens.slice(0, -2).join(' ');
    if (!MONEDAS_VALIDAS.includes(moneda) || !BANCOS_VALIDOS.includes(banco)) {
      out.push({ nombreArchivo, error: `banco/moneda no reconocido (${banco} ${moneda})` });
      continue;
    }
    out.push({ nombreArchivo, sociedad, banco, moneda, archivo: path.join(dir, nombreArchivo) });
  }
  return out;
}

/** Lista los archivos .csv de la carpeta de Pagos ERP. */
function listarArchivosPagosERP(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .map(nombreArchivo => ({ nombreArchivo, archivo: path.join(dir, nombreArchivo) }));
}

module.exports = {
  leerMovimientoBanco, leerPagosERP, PARSERS_BANCO,
  listarArchivosEstadoCuenta, listarArchivosPagosERP,
};

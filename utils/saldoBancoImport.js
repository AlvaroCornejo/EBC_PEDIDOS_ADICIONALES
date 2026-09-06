// Parsers y descubrimiento de archivos para el módulo Saldos Bancarios —
// a diferencia de Flujo de Caja (que lee de una carpeta de Box con nombres
// "{SOCIEDAD} {BANCO} {MONEDA}.xlsx"), acá se lee de la carpeta Descargas
// del servidor, con el nombre que trae cada banco al exportar ("movimientos
// (N).xls" en BBVA, "093_movimientos_historicos (N).xlsx" en BCP,
// "Movimientos_..._....zip" en IBK) — el banco NO se puede saber por el
// nombre, se detecta por la estructura del archivo. La cuenta/sociedad se
// resuelve después contra el catálogo SaldoCuentaBanco (admin), usando el
// número de cuenta tal como aparece en el archivo.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');

// Algunos archivos (ej. IBK) traen celdas como "rich text"
// ({richText:[{text:'...'}]}) en vez de un string plano.
function cellVal(cell) {
  if (cell && typeof cell === 'object') {
    if ('result' in cell) return cell.result;
    if (Array.isArray(cell.richText)) return cell.richText.map(r => r.text).join('');
  }
  return cell;
}
const num = v => {
  v = cellVal(v);
  if (v == null) return NaN;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
};
// 'DD-MM-YYYY' o 'DD/MM/YYYY' -> Date (UTC)
function parseFecha(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}
const ymd = d => d.toISOString().slice(0, 10);

// ── BBVA: archivo .xls que en realidad es una tabla HTML (truco típico de
// exports bancarios) — ExcelJS no lo puede leer como xlsx real. Se parsea
// con regex sobre el texto (windows-1252/latin1). La fuente NO trae un
// "saldo tras cada movimiento" por fila — solo marcadores "Saldo Inicial:
// DD-MM-YYYY" / "Saldo Final: DD-MM-YYYY" al abrir/cerrar cada día — así que
// el saldo corrido se reconstruye acumulando importe a partir del último
// "Saldo Inicial" visto. ──────────────────────────────────────────────────
function parseBBVA_HTML(buffer) {
  const html = buffer.toString('latin1');
  const cuentaM = html.match(/Cuenta Actual:\s*([\d]+)\s+(PEN|USD|SOL|D[OÓ]LARES)?\s*([^<]*)/i);
  if (!cuentaM) throw new Error('BBVA: no se encontró "Cuenta Actual"');
  const cuenta = cuentaM[1].trim();
  const monedaTxt = (cuentaM[2] || '').toUpperCase();
  const nombreCuenta = (cuentaM[3] || '').trim();
  const importesEnM = html.match(/Importes en:\s*(PEN|USD|SOL(?:ES)?|D[OÓ]LARES)/i);
  const monedaRaw = (importesEnM ? importesEnM[1] : monedaTxt).toUpperCase();
  const moneda = /USD|D[OÓ]LAR/.test(monedaRaw) ? 'USD' : 'PEN';

  const filas = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html))) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1]))) {
      const txt = tdMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .trim();
      cells.push(txt);
    }
    if (cells.length >= 6) filas.push(cells);
  }

  // Encabezado real: "F. Operación | F. Valor | Código | Nº. Doc. | Concepto | Importe | Oficina"
  const idxHeader = filas.findIndex(c => /F\.\s*Operaci/i.test(c[0] || ''));
  const dataRows = idxHeader >= 0 ? filas.slice(idxHeader + 1) : filas;

  const movimientos = [];
  let saldoCorrido = null;
  for (const c of dataRows) {
    const [fechaStr, , , , concepto, importeStr] = c;
    if (/^Saldo Inicial:/i.test(concepto || '')) { saldoCorrido = num(importeStr); continue; }
    if (/^Saldo Final:/i.test(concepto || '')) continue; // solo para validar, no es movimiento
    const fecha = parseFecha(fechaStr);
    if (!fecha) continue;
    const importe = num(importeStr);
    if (!Number.isFinite(importe)) continue;
    saldoCorrido = (saldoCorrido == null ? 0 : saldoCorrido) + importe;
    movimientos.push({ fecha, glosa: concepto || '', importe, saldo: saldoCorrido });
  }

  return { cuenta, moneda, nombreCuenta, movimientos };
}

// ── BCP: .xlsx real, filas en orden DESCENDENTE (más nuevo primero). Trae
// "Saldo" (running balance) por fila, así que no hace falta acumular. ─────
function parseBCP_XLSX(ws) {
  let cuenta = null, monedaTxt = null, nombreCuenta = '';
  for (let r = 1; r <= 6; r++) {
    const label = String(cellVal(ws.getCell(r, 1).value) ?? '').trim().toUpperCase();
    const val = String(cellVal(ws.getCell(r, 2).value) ?? '').trim();
    if (label === 'CUENTA') {
      const partes = val.split(' - ');
      cuenta = (partes[0] || '').trim();
      nombreCuenta = (partes.slice(1).join(' - ') || '').trim();
    }
    if (label === 'MONEDA') monedaTxt = val.toUpperCase();
  }
  if (!cuenta) throw new Error('BCP: no se encontró "Cuenta"');
  const moneda = /D[OÓ]LAR|USD/.test(monedaTxt || '') ? 'USD' : 'PEN';

  let filaHeader = null, COL = {};
  for (let r = 1; r <= 10; r++) {
    const v1 = String(cellVal(ws.getCell(r, 1).value) ?? '').trim().toUpperCase();
    if (v1 === 'FECHA') {
      filaHeader = r;
      ws.getRow(r).eachCell((cell, col) => { COL[String(cellVal(cell.value) ?? '').trim().toUpperCase()] = col; });
      break;
    }
  }
  if (!filaHeader) throw new Error('BCP: no se encontró el encabezado de movimientos');
  const colFecha = COL['FECHA'], colDesc = COL['DESCRIPCIÓN OPERACIÓN'] || COL['DESCRIPCION OPERACION'], colMonto = COL['MONTO'], colSaldo = COL['SALDO'];
  if (!colFecha || !colMonto || !colSaldo) throw new Error('BCP: columnas esperadas no encontradas');

  const movimientos = [];
  ws.eachRow((row, i) => {
    if (i <= filaHeader) return;
    const rawFecha = cellVal(row.getCell(colFecha).value);
    const fecha = rawFecha instanceof Date ? rawFecha : parseFecha(rawFecha);
    if (!fecha) return;
    const importe = num(row.getCell(colMonto).value);
    const saldo = num(row.getCell(colSaldo).value);
    if (!Number.isFinite(importe) || !Number.isFinite(saldo)) return;
    movimientos.push({ fecha, glosa: String(cellVal(row.getCell(colDesc)?.value) ?? '').trim(), importe, saldo });
  });
  // El archivo viene DESCENDENTE (más nuevo primero) — revertir alcanza para
  // dejarlo ascendente sin perder el orden real dentro de un mismo día (un
  // .sort() por fecha sola no distingue movimientos del mismo día entre sí,
  // ya que la fecha del banco no trae hora).
  movimientos.reverse();
  return { cuenta, moneda, nombreCuenta, movimientos };
}

// ── IBK: .xlsx real (llega dentro de un .zip) — trae "Empresa:" (código de
// sociedad DIRECTO) y "Saldo contable" (running balance) por fila. ────────
function parseIBK_XLSX(ws) {
  let sociedadDirecta = null, cuenta = null, monedaTxt = null;
  for (let r = 1; r <= 12; r++) {
    const label = String(cellVal(ws.getCell(r, 2).value) ?? '').trim().toUpperCase();
    const val = String(cellVal(ws.getCell(r, 4).value) ?? '').trim();
    if (label === 'EMPRESA:') sociedadDirecta = val;
    if (label === 'CUENTA:') {
      monedaTxt = val.toUpperCase();
      const m = val.match(/([\d-]{6,})\s*$/);
      cuenta = m ? m[1].trim() : val;
    }
  }
  if (!cuenta) throw new Error('IBK: no se encontró "Cuenta:"');
  const moneda = /D[OÓ]LAR|USD/.test(monedaTxt || '') ? 'USD' : 'PEN';

  let filaHeader = null, COL = {};
  for (let r = 1; r <= 15; r++) {
    const vals = [];
    ws.getRow(r).eachCell(cell => vals.push(String(cellVal(cell.value) ?? '').trim().toUpperCase()));
    if (vals.some(v => v.startsWith('FECHA DE OPERACI'))) {
      filaHeader = r;
      ws.getRow(r).eachCell((cell, col) => { COL[String(cellVal(cell.value) ?? '').trim().toUpperCase()] = col; });
      break;
    }
  }
  if (!filaHeader) throw new Error('IBK: no se encontró el encabezado de movimientos');
  const colFecha = COL['FECHA DE OPERACIÓN'] || COL['FECHA DE OPERACION'];
  const colMov = COL['MOVIMIENTO'], colDesc = COL['DESCRIPCIÓN'] || COL['DESCRIPCION'];
  const colCargo = COL['CARGO'], colAbono = COL['ABONO'], colSaldo = COL['SALDO CONTABLE'];
  if (!colFecha || !colSaldo) throw new Error('IBK: columnas esperadas no encontradas');

  const movimientos = [];
  ws.eachRow((row, i) => {
    if (i <= filaHeader) return;
    const rawFecha = cellVal(row.getCell(colFecha).value);
    const fecha = rawFecha instanceof Date ? rawFecha : parseFecha(rawFecha);
    if (!fecha) return;
    const saldo = num(row.getCell(colSaldo).value);
    if (!Number.isFinite(saldo)) return;
    const cargo = Math.abs(num(row.getCell(colCargo)?.value) || 0);
    const abono = Math.abs(num(row.getCell(colAbono)?.value) || 0);
    const glosa = [colMov, colDesc].filter(Boolean).map(c => String(cellVal(row.getCell(c).value) ?? '').trim()).filter(Boolean).join(' — ');
    movimientos.push({ fecha, glosa, importe: abono - cargo, saldo });
  });
  movimientos.sort((a, b) => a.fecha - b.fecha);
  return { cuenta, moneda, nombreCuenta: '', sociedadDirecta, movimientos };
}

/** Detecta el banco de un .xlsx ya cargado en ExcelJS mirando su estructura. */
function detectarBancoXLSX(ws) {
  for (let r = 1; r <= 12; r++) {
    const v1 = String(cellVal(ws.getCell(r, 1).value) ?? '').trim().toUpperCase();
    if (v1 === 'CUENTA') return 'BCP';
    const v2 = String(cellVal(ws.getCell(r, 2).value) ?? '').trim().toUpperCase();
    if (v2 === 'EMPRESA:') return 'IBK';
  }
  return null;
}

/**
 * Lee un archivo de movimientos (ruta o buffer) sin saber de antemano el
 * banco — lo detecta por extensión/estructura. Devuelve
 * { banco, cuenta, moneda, nombreCuenta, sociedadDirecta, movimientos }.
 */
async function leerArchivoMovimientos(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let resultado;

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntries().find(e => /\.xlsx$/i.test(e.entryName));
    if (!entry) throw new Error('El .zip no contiene ningún .xlsx');
    const buf = entry.getData();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const banco = detectarBancoXLSX(ws) || 'IBK'; // el único caso conocido en zip, por ahora
    const datos = banco === 'IBK' ? parseIBK_XLSX(ws) : parseBCP_XLSX(ws);
    resultado = { banco, ...datos };
  } else if (ext === '.xls') {
    const buf = fs.readFileSync(filePath);
    const inicioTxt = buf.slice(0, 200).toString('latin1').trim().toLowerCase();
    if (!inicioTxt.startsWith('<table') && !inicioTxt.includes('<table')) {
      throw new Error('.xls no reconocido (no es la tabla HTML de BBVA)');
    }
    const datos = parseBBVA_HTML(buf);
    resultado = { banco: 'BBVA', ...datos };
  } else if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    const banco = detectarBancoXLSX(ws);
    if (!banco) throw new Error('.xlsx no reconocido (ni BCP ni IBK)');
    const datos = banco === 'BCP' ? parseBCP_XLSX(ws) : parseIBK_XLSX(ws);
    resultado = { banco, ...datos };
  } else {
    throw new Error(`Extensión no soportada: ${ext}`);
  }

  // seq preserva el orden cronológico real dentro del archivo — la fecha del
  // banco no trae hora, y ni insertMany({ordered:false}) ni un sort por
  // fecha sola garantizan mantener el orden entre movimientos del mismo día.
  resultado.movimientos.forEach((m, i) => { m.seq = i; });
  return resultado;
}

/**
 * Lista los archivos de la carpeta Descargas cuyo nombre contiene
 * "movimiento" (en cualquier posición, no solo al inicio — BCP los nombra
 * "093_movimientos_historicos (N).xlsx") y cuya fecha de modificación es
 * HOY. Nuevos archivos que aparezcan (más cuentas) se recogen solos, sin
 * tocar código — no hay una lista fija de cuántos esperar.
 */
function listarArchivosDeHoy(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const hoy = ymd(new Date());
  return fs.readdirSync(dir)
    .filter(f => /movimiento/i.test(f) && /\.(xls|xlsx|zip)$/i.test(f))
    .map(f => ({ nombreArchivo: f, archivo: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .filter(f => ymd(f.mtime) === hoy);
}

module.exports = { leerArchivoMovimientos, listarArchivosDeHoy, parseBBVA_HTML, parseBCP_XLSX, parseIBK_XLSX };

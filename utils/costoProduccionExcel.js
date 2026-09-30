// Lectura de la hoja "Datos" de EBC COSTO DE PRODUCCION.xlsx (sin BD, para probarla sola).
//
// Estructura de la hoja: una fila de cabecera con COD / DescripcionLocal / AREA / UND y,
// encima, una fila con "COSTO RECETA" y el nombre de cada mes (celdas combinadas sobre sus
// 3 columnas CANTIDAD / COSTO S/ / DESVIACIÓN). Los meses se detectan por nombre, así que
// al agregar SETIEMBRE ... DICIEMBRE entran solos, sin tocar código.

const MESES = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8,
  SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

const cellVal = c => (c && typeof c === 'object' && !(c instanceof Date) ? (c.result ?? c.text ?? c.richText?.map(t => t.text).join('') ?? null) : c);
const norm = v => String(cellVal(v) ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Número de una celda: acepta "S/ 1,234.50"; errores (#N/A, #DIV/0!) y vacíos → null. */
function numero(v) {
  const x = cellVal(v);
  if (x == null || x === '') return null;
  if (typeof x === 'object') return null; // { error: '#N/A' }
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const n = Number(String(x).replace(/S\/|,|\s/gi, ''));
  return Number.isFinite(n) ? n : null;
}

/** Ubica cabecera, columnas fijas y columnas de cada mes. */
function leerEstructura(ws) {
  let filaCab = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 30) && !filaCab; r++) {
    ws.getRow(r).eachCell((c) => { if (norm(c.value) === 'COD') filaCab = r; });
  }
  if (!filaCab || filaCab < 2) throw new Error('Hoja "Datos": no se encontró la fila de cabecera (columna COD)');

  const cab = ws.getRow(filaCab), sup = ws.getRow(filaCab - 1);
  const ultima = Math.max(cab.cellCount, sup.cellCount);
  const col = {};
  const meses = new Map(); // mes -> { cantidad, costo }
  for (let c = 1; c <= ultima; c++) {
    const h = norm(cab.getCell(c).value), s = norm(sup.getCell(c).value);
    if (h === 'COD') col.item = c;
    else if (h === 'AREA') col.area = c;
    else if (h === 'UND') col.unidad = c;
    else if (h.startsWith('DESCRIPCION')) col.nombre = c;
    if (s === 'COSTO RECETA' || h === 'COSTO RECETA') col.receta = c;
    const mes = MESES[s];
    if (mes) {
      const m = meses.get(mes) || {};
      if (h === 'CANTIDAD' && m.cantidad === undefined) m.cantidad = c;
      if (h.startsWith('COSTO') && m.costo === undefined) m.costo = c;
      meses.set(mes, m);
    }
  }
  const faltan = ['item', 'area', 'nombre', 'receta'].filter(k => col[k] === undefined);
  if (faltan.length) throw new Error(`Hoja "Datos": no se encontraron las columnas: ${faltan.join(', ')}`);
  const incompletos = [...meses].filter(([, m]) => !m.cantidad || !m.costo).map(([k]) => k);
  if (incompletos.length) throw new Error(`Hoja "Datos": meses sin columna CANTIDAD o COSTO: ${incompletos.join(', ')}`);
  if (!meses.size) throw new Error('Hoja "Datos": no se encontró ningún mes (ENERO ... DICIEMBRE)');
  return { filaCab, col, meses };
}

/**
 * Devuelve { docs, meses, items, sinReceta } — docs: una fila por ítem × mes con producción
 * (cantidad > 0 y costo real > 0); los meses sin producción no se guardan.
 */
function leerCostoProduccion(wb, anio, operacion = 'PLANTA') {
  const ws = wb.getWorksheet('Datos');
  if (!ws) throw new Error('No se encontró la hoja "Datos"');
  const { filaCab, col, meses } = leerEstructura(ws);

  const docs = [];
  const items = new Set(), sinReceta = new Set();
  for (let r = filaCab + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const item = String(cellVal(row.getCell(col.item).value) ?? '').trim();
    const area = norm(row.getCell(col.area).value);
    if (!item || !area || area === 'AREA') continue;
    const receta = numero(row.getCell(col.receta).value);
    const base = {
      operacion, anio, area, item,
      nombre: String(cellVal(row.getCell(col.nombre).value) ?? '').trim(),
      unidad: col.unidad ? String(cellVal(row.getCell(col.unidad).value) ?? '').trim() : '',
      costoReceta: receta > 0 ? receta : null,
    };
    items.add(item);
    if (!base.costoReceta) sinReceta.add(item);
    for (const [mes, c] of meses) {
      const cantidad = numero(row.getCell(c.cantidad).value) || 0;
      const costoReal = numero(row.getCell(c.costo).value) || 0;
      if (cantidad > 0 && costoReal > 0) docs.push({ ...base, mes, cantidad, costoReal });
    }
  }
  return { docs, meses: [...meses.keys()].sort((a, b) => a - b), items: items.size, sinReceta: sinReceta.size };
}

module.exports = { leerCostoProduccion, numero, MESES };

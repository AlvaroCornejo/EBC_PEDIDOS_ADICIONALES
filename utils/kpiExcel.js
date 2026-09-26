const ExcelJS = require('exceljs');
const { construirTablero, pendientesDeCaptura } = require('./kpiTablero');
const P = require('./kpiPeriodo');

// Exportación a Excel de lo que el usuario ve en el dashboard: se arma con el MISMO cálculo
// (utils/kpiTablero.js) y el mismo acceso, así que nunca incluye áreas no asignadas.
// Formato peruano: coma de miles, punto decimal, fechas dd/mm/aaaa.

const ETIQUETA = { VERDE: 'Verde', AMBAR: 'Ámbar', ROJO: 'Rojo', SIN_DATO: 'Sin dato', PENDIENTE: 'En plazo', NO_EXIGIBLE: '—', null: 'Informativo' };
const RELLENO = { VERDE: 'FFDCFCE7', AMBAR: 'FFFEF3C7', ROJO: 'FFFEE2E2', SIN_DATO: 'FFF1F5F9' };
const UNIDAD = { '%': '%', 'S/': 'S/', 'US$': 'US$', dias: 'días', horas: 'horas', numero: 'N°', pp: 'pp' };
const FMT_NUM = '#,##0.00';

function textoMeta(sentido, m) {
  if (!m) return 'Informativo';
  const n = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (sentido === 'RANGO') return m.rangoMin == null ? 'Informativo' : `${n(m.rangoMin)} a ${n(m.rangoMax)}${m.tolerancia ? ` (± ${n(m.tolerancia)})` : ''}`;
  if (m.meta == null) return 'Informativo';
  const op = sentido === 'MAYOR' ? '≥' : '≤';
  return `${op} ${n(m.meta)}${m.umbralAmbar != null && m.umbralAmbar !== m.meta ? ` (ámbar ${op} ${n(m.umbralAmbar)})` : ''}`;
}

const fechaDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

function hoja(wb, nombre, encabezados, anchos, titulo) {
  const ws = wb.addWorksheet(nombre);
  ws.addRow([titulo]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const h = ws.addRow(encabezados);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1F3A' } }; });
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return ws;
}

function pintarEstado(celda, estado) {
  celda.value = ETIQUETA[estado ?? 'null'];
  if (RELLENO[estado]) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELLENO[estado] } };
}

async function generarExcel(acc, { mes, area, unidad, usuario = '' } = {}) {
  const t = await construirTablero(acc, { mes, area, unidad });
  const pend = await pendientesDeCaptura(acc, { area, unidad });
  const wb = new ExcelJS.Workbook();
  wb.creator = `Indicadores GAF — ${usuario}`;
  const filtros = [`Periodo: ${t.etiquetaMes}`, area ? `Área: ${t.areas[0]?.nombre || area}` : 'Todas mis áreas', unidad ? `Unidad: ${unidad}` : 'Todas las unidades'].join(' · ');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const ahora = `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  const titulo = (s) => `Indicadores GAF — ${s} — ${filtros} — generado por ${usuario} el ${ahora}`;

  // Resumen por área
  const r = hoja(wb, 'Resumen', ['Área', 'Semáforo', 'Verde', 'Ámbar', 'Rojo', 'Sin dato', 'En plazo', 'Informativos'], [24, 14, 9, 9, 9, 10, 10, 13], titulo('Resumen por área'));
  for (const a of t.areas) {
    const row = r.addRow([a.nombre, '', a.conteo.VERDE, a.conteo.AMBAR, a.conteo.ROJO, a.conteo.SIN_DATO, a.pendientes, a.informativos]);
    if (a.color) pintarEstado(row.getCell(2), a.color); else row.getCell(2).value = 'Sin KPIs';
  }

  // Detalle KPI × unidad
  const d = hoja(wb, 'Detalle', ['Área', 'Código', 'KPI', 'Unidad', 'Periodo', 'Valor', 'Medida', 'Meta', 'Semáforo', 'Variación vs anterior', 'Comentario', 'Corregido', 'Evidencias'],
    [18, 9, 38, 12, 11, 12, 8, 26, 12, 12, 50, 10, 10], titulo(`Detalle ${t.etiquetaMes}`));
  const nombreArea = Object.fromEntries(t.areas.map(a => [a.codigo, a.nombre]));
  for (const a of t.areas) for (const k of a.kpis) for (const f of k.filas) {
    const row = d.addRow([nombreArea[a.codigo], k.codigo, k.nombre, f.unidad, f.etiqueta, f.valor, UNIDAD[k.unidad],
      textoMeta(k.sentido, f.meta), '', f.variacion, f.comentario, f.corregido ? 'Sí' : '', f.adjuntos || '']);
    row.getCell(6).numFmt = FMT_NUM; row.getCell(10).numFmt = `+${FMT_NUM};-${FMT_NUM};0`;
    pintarEstado(row.getCell(9), f.estado);
  }

  // Tendencia (formato largo: una fila por periodo)
  const tr = hoja(wb, 'Tendencia 12 periodos', ['Área', 'Código', 'KPI', 'Unidad', 'Periodo', 'Inicio', 'Valor', 'Semáforo'],
    [18, 9, 38, 12, 11, 12, 12, 12], titulo('Últimos 12 periodos'));
  for (const a of t.areas) for (const k of a.kpis) for (const f of k.filas) for (const p of f.tendencia) {
    const row = tr.addRow([nombreArea[a.codigo], k.codigo, k.nombre, f.unidad, p.etiqueta, fechaDate(P.rango(p.periodo).inicio), p.valor, '']);
    row.getCell(6).numFmt = 'dd/mm/yyyy'; row.getCell(7).numFmt = FMT_NUM;
    if (p.registrado) pintarEstado(row.getCell(8), p.semaforo); else row.getCell(8).value = 'Sin registro';
  }

  // Pendientes de captura
  const pe = hoja(wb, 'Pendientes', ['Responsable', 'Área', 'Código', 'KPI', 'Unidad', 'Periodo', 'Venció', 'Días de atraso'],
    [20, 18, 9, 38, 12, 11, 12, 14], titulo('Capturas vencidas sin registro'));
  for (const g of pend.grupos) for (const i of g.items) {
    const row = pe.addRow([g.responsable, nombreArea[i.areaCodigo] || i.areaCodigo, i.codigo, i.nombre, i.unidad, i.etiqueta, fechaDate(i.vence), i.diasAtraso]);
    row.getCell(7).numFmt = 'dd/mm/yyyy';
  }

  return { buffer: await wb.xlsx.writeBuffer(), nombre: `Indicadores GAF ${t.mes}${area ? ` ${area}` : ''}${unidad ? ` ${unidad}` : ''}.xlsx` };
}

module.exports = { generarExcel };

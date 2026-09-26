// Periodos de Indicadores GAF, como texto para que sean claves estables y ordenables:
//   MENSUAL → 'YYYY-MM'      (ej. '2026-09')
//   SEMANAL → 'YYYY-Www'     (semana ISO, lunes a domingo, ej. '2026-W39')
// Las fechas se manejan como 'YYYY-MM-DD' (hora de Lima) para no depender de la zona
// horaria del servidor. Sin dependencias externas.

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const RE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const RE_SEM = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const aUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const sumarDias = (s, n) => { const d = aUTC(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

function hoyLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

// Lunes de la semana ISO 1 de un año (la que contiene el 4 de enero).
function lunesSemana1(anio) {
  const d = new Date(Date.UTC(anio, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function semanasDelAnio(anio) {
  return Math.round((lunesSemana1(anio + 1) - lunesSemana1(anio)) / (7 * 864e5));
}

function esValido(periodo, frecuencia) {
  if (frecuencia === 'MENSUAL') return RE_MES.test(periodo);
  if (frecuencia === 'SEMANAL') {
    const m = RE_SEM.exec(periodo);
    return !!m && Number(m[2]) <= semanasDelAnio(Number(m[1]));
  }
  return false;
}

function periodoDeFecha(fecha, frecuencia) {
  if (frecuencia === 'MENSUAL') return fecha.slice(0, 7);
  const d = aUTC(fecha);
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // el jueves decide el año ISO
  const anio = jueves.getUTCFullYear();
  const semana = 1 + Math.floor((jueves - lunesSemana1(anio)) / (7 * 864e5));
  return `${anio}-W${pad(semana)}`;
}

function frecuenciaDe(periodo) {
  return RE_SEM.test(periodo) ? 'SEMANAL' : RE_MES.test(periodo) ? 'MENSUAL' : null;
}

// { inicio, fin } como 'YYYY-MM-DD', ambos inclusive.
function rango(periodo) {
  const m = RE_MES.exec(periodo);
  if (m) {
    const anio = Number(m[1]), mes = Number(m[2]);
    return { inicio: `${periodo}-01`, fin: ymd(new Date(Date.UTC(anio, mes, 0))) };
  }
  const s = RE_SEM.exec(periodo);
  if (!s) throw new Error(`Periodo inválido: ${periodo}`);
  const lunes = lunesSemana1(Number(s[1]));
  lunes.setUTCDate(lunes.getUTCDate() + (Number(s[2]) - 1) * 7);
  const inicio = ymd(lunes);
  return { inicio, fin: sumarDias(inicio, 6) };
}

// Último día para capturar: `plazoDias` días después del cierre del periodo.
function vencimiento(periodo, plazoDias) {
  return sumarDias(rango(periodo).fin, Number(plazoDias) || 0);
}

function desplazar(periodo, n) {
  const frec = frecuenciaDe(periodo);
  if (frec === 'MENSUAL') {
    const [y, m] = periodo.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  return periodoDeFecha(sumarDias(rango(periodo).inicio, 7 * n), 'SEMANAL');
}

const anterior = (periodo) => desplazar(periodo, -1);

// Los últimos `n` periodos terminando en `periodo` (incluido), del más antiguo al más reciente.
function ultimos(periodo, n) {
  return Array.from({ length: n }, (_, i) => desplazar(periodo, i - n + 1));
}

// 'Set 2026' / 'S39 2026'
function etiqueta(periodo) {
  const m = RE_MES.exec(periodo);
  if (m) return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
  const s = RE_SEM.exec(periodo);
  return s ? `S${Number(s[2])} ${s[1]}` : periodo;
}

module.exports = {
  hoyLima, esValido, periodoDeFecha, frecuenciaDe, rango, vencimiento,
  desplazar, anterior, ultimos, etiqueta, sumarDias,
};

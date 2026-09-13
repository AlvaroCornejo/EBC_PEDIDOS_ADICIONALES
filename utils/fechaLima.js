// Helpers de fecha/hora para el módulo de Cierre Contable, todo en America/Lima
// (UTC-5, sin horario de verano — no hace falta una librería de zonas horarias).
const DiaNoLaborable = require('../models/DiaNoLaborable');

const LIMA_TZ = 'America/Lima';

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD' de la fecha actual en Lima.
function hoyLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA_TZ }).format(new Date());
}

// 'HH:mm' de la hora actual en Lima.
function horaActualLima() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LIMA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === 'hour').value;
  const m = parts.find(p => p.type === 'minute').value;
  return `${h}:${m}`;
}

function ahoraLimaMs() {
  return Date.now();
}

// Convierte 'YYYY-MM-DD' + 'HH:mm' (interpretados en America/Lima, UTC-5 fijo) a epoch ms.
function limiteAMs(fechaStr, horaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const [hh, mm] = (horaStr || '23:59').split(':').map(Number);
  // UTC-5 fijo: hora Lima 00:00 == 05:00 UTC del mismo día.
  return Date.UTC(y, m - 1, d, hh + 5, mm);
}

// ISO string del instante actual (para grabar fechaHoraCumplimiento).
function ahoraLimaISO() {
  return new Date().toISOString();
}

async function esDiaHabil(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
  if (dow === 0 || dow === 6) return false;
  const noLaborable = await DiaNoLaborable.findOne({ fecha: fechaStr }).lean();
  return !noLaborable;
}

// Todos los días hábiles (YYYY-MM-DD) de un periodo 'YYYY-MM', en orden — se calcula una
// sola vez por periodo en vez de re-consultar DiaNoLaborable por cada Actividad al generar.
async function diasHabilesDelMes(periodoYYYYMM) {
  const [anio, mes] = periodoYYYYMM.split('-').map(Number);
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dias = [];
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const fechaStr = `${anio}-${pad2(mes)}-${pad2(dia)}`;
    if (await esDiaHabil(fechaStr)) dias.push(fechaStr);
  }
  return dias;
}

// Calcula la fecha (YYYY-MM-DD) del n-ésimo día hábil de un periodo 'YYYY-MM'.
async function calcularDiaHabilN(periodoYYYYMM, n) {
  const dias = await diasHabilesDelMes(periodoYYYYMM);
  if (!dias[n - 1]) throw new Error(`El periodo ${periodoYYYYMM} no tiene ${n} días hábiles`);
  return dias[n - 1];
}

// Estado mostrado en el tablero — deriva "vencida"/"cumplida a tiempo"/"cumplida tarde"
// sin persistirlos, ya que esta app no tiene un scheduler que los actualice solo.
function estadoDerivado(actividadCierre) {
  const limiteMs = limiteAMs(actividadCierre.fechaLimite, actividadCierre.horaLimite);
  if (actividadCierre.estado === 'REABIERTA') return 'REABIERTA';
  if (actividadCierre.estado === 'CUMPLIDA') {
    const cumplidoMs = new Date(actividadCierre.fechaHoraCumplimiento).getTime();
    return cumplidoMs <= limiteMs ? 'CUMPLIDA_A_TIEMPO' : 'CUMPLIDA_TARDE';
  }
  return ahoraLimaMs() > limiteMs ? 'VENCIDA' : 'PENDIENTE';
}

module.exports = {
  hoyLima, horaActualLima, ahoraLimaMs, ahoraLimaISO, limiteAMs,
  esDiaHabil, diasHabilesDelMes, calcularDiaHabilN, estadoDerivado,
};

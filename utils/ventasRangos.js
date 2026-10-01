/**
 * Rangos de fecha para los comparativos Día/Semana/Mes/Año del Reporte de
 * Ventas — reproduce la lógica del Excel de referencia
 * ("CDLAO - Reporte de Ventas.xlsm", hoja REPORTE, filas 6-7):
 *
 * - La semana empieza en LUNES.
 * - Semana/Mes/Año son siempre "a la fecha" (WTD/MTD/YTD): desde el inicio
 *   del período hasta la fecha seleccionada, no el período completo.
 * - "Anterior" = mismo rango relativo, una semana/mes/año antes.
 * - Para Día y Semana, "año anterior" usa como referencia `fecha - 364 días`
 *   (52 semanas exactas, para caer en el mismo día de la semana) — así lo
 *   hace el Excel de referencia (celda AF6 = AD6-364). Para Mes y Año,
 *   "año anterior" usa el mismo mes/día calendario del año pasado (sin
 *   ajustar por día de semana) — confirmado con el usuario.
 *
 * Todas las funciones devuelven fechas a las 00:00:00 (desde) y 23:59:59.999
 * (hasta), listas para usar en un filtro Mongo `$gte/$lte`.
 */

const MS_DIA = 24 * 60 * 60 * 1000;

function aMedianoche(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function finDeDia(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function sumarDias(d, n) { return new Date(d.getTime() + n * MS_DIA); }
function inicioDeMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function inicioDeAnio(d) { return new Date(d.getFullYear(), 0, 1); }
/** Mismo día-del-mes que `d`, en el mes/año de `ref` — si el mes de `ref` tiene
 * menos días, se recorta al último día de ese mes (evita fechas inválidas). */
function diaEquivalente(ref, diaDelMes) {
  const ultimoDia = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  return new Date(ref.getFullYear(), ref.getMonth(), Math.min(diaDelMes, ultimoDia));
}
/** Lunes de la semana que contiene `d` (lunes=0 días de offset). */
function lunesDeLaSemana(d) {
  const diaSemana = d.getDay(); // 0=domingo..6=sábado
  const offset = diaSemana === 0 ? 6 : diaSemana - 1; // días desde el lunes
  return sumarDias(aMedianoche(d), -offset);
}
const rango = (desde, hasta) => [aMedianoche(desde), finDeDia(hasta)];

function rangoDia(fechaRef) {
  const hoy = aMedianoche(fechaRef);
  const semAnt = sumarDias(hoy, -7);
  const anioAnt = sumarDias(hoy, -364);
  return { actual: rango(hoy, hoy), anterior: rango(semAnt, semAnt), anioAnterior: rango(anioAnt, anioAnt) };
}

function rangoSemana(fechaRef) {
  const hoy = aMedianoche(fechaRef);
  const lunesActual = lunesDeLaSemana(hoy);
  const semAnt = sumarDias(hoy, -7);
  const lunesSemAnt = sumarDias(lunesActual, -7);
  const anioAnt = sumarDias(hoy, -364);
  const lunesAnioAnt = sumarDias(lunesActual, -364);
  return {
    actual: rango(lunesActual, hoy),
    anterior: rango(lunesSemAnt, semAnt),
    anioAnterior: rango(lunesAnioAnt, anioAnt),
  };
}

function rangoMes(fechaRef) {
  const hoy = aMedianoche(fechaRef);
  const inicioActual = inicioDeMes(hoy);
  const mesAntRef = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const inicioMesAnt = inicioDeMes(mesAntRef);
  const finMesAnt = diaEquivalente(mesAntRef, hoy.getDate());
  // Año anterior: mismo mes/día calendario, un año antes (no fecha-364).
  const mesAnioAntRef = new Date(hoy.getFullYear() - 1, hoy.getMonth(), 1);
  const inicioMesAnioAnt = inicioDeMes(mesAnioAntRef);
  const finMesAnioAnt = diaEquivalente(mesAnioAntRef, hoy.getDate());
  return {
    actual: rango(inicioActual, hoy),
    anterior: rango(inicioMesAnt, finMesAnt),
    anioAnterior: rango(inicioMesAnioAnt, finMesAnioAnt),
  };
}

function rangoAnio(fechaRef) {
  const hoy = aMedianoche(fechaRef);
  const inicioActual = inicioDeAnio(hoy);
  // Año anterior: mismo mes/día calendario, un año antes.
  const inicioAnioAnt = new Date(hoy.getFullYear() - 1, 0, 1);
  const finAnioAnt = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate());
  return {
    actual: rango(inicioActual, hoy),
    anterior: rango(inicioAnioAnt, finAnioAnt),
    // El Excel de referencia solo muestra Año: "A Hoy" vs "Año Ant" (2 columnas, no 3)
    anioAnterior: null,
  };
}

module.exports = { rangoDia, rangoSemana, rangoMes, rangoAnio, lunesDeLaSemana, aMedianoche, finDeDia, sumarDias };

/**
 * Cálculos derivados de Planillas — puros, nada se persiste (ver models/Planilla.js).
 * Días de un rango: inclusive en ambos extremos (desde y hasta cuentan).
 */

const MS_DIA = 24 * 60 * 60 * 1000;

function diasRango(r) {
  const dias = Math.round((new Date(r.hasta) - new Date(r.desde)) / MS_DIA) + 1;
  return Math.max(0, dias);
}

function diasEnRangos(rangos) {
  return (rangos || []).reduce((s, r) => s + diasRango(r), 0);
}

/** Días brutos trabajados: de la fecha de ingreso a la fecha de pago, tope 15. */
function diasBrutos(fechaIngreso, fechaPago) {
  const dias = Math.round((new Date(fechaPago) - new Date(fechaIngreso)) / MS_DIA);
  return Math.max(0, Math.min(15, dias));
}

/** Días netos = brutos - faltas - licencia sin goce de haber. */
function diasNetos(bruto, diasFaltas, diasLicSinGoce) {
  return Math.max(0, bruto - diasFaltas - diasLicSinGoce);
}

/**
 * Calcula todos los derivados de un trabajador para el Paso 4 / resumen.
 * `bolsaOperacion` y `totalPuntosOperacion` ya vienen calculados a nivel de
 * toda la planilla (routes/planillas.js) para no repetir la suma por fila.
 */
function calcularTrabajador(t, fechaPago, bolsaOperacion, totalPuntosOperacion) {
  const diasPorTipo = {
    feriados:        diasEnRangos(t.feriados),
    faltas:          diasEnRangos(t.faltas),
    vacaciones:      diasEnRangos(t.vacaciones),
    licenciaSinGoce: diasEnRangos(t.licenciaSinGoce),
    licenciaConGoce: diasEnRangos(t.licenciaConGoce),
    descansoMedico:  diasEnRangos(t.descansoMedico),
  };
  const bruto = diasBrutos(t.fechaIngreso, fechaPago);
  const neto = diasNetos(bruto, diasPorTipo.faltas, diasPorTipo.licenciaSinGoce);

  const prorrateoBasico = (Number(t.basico) || 0) / 15 * neto;
  const bolsaTrabajador = totalPuntosOperacion > 0
    ? bolsaOperacion * (Number(t.puntos) || 0) / totalPuntosOperacion
    : 0;
  const montoEstimado = prorrateoBasico
    + (Number(t.asignacionFamiliar) || 0)
    + bolsaTrabajador
    + (Number(t.extraMonto) || 0)
    - (Number(t.descuentoMonto) || 0)
    - (Number(t.aporteAFP) || 0);

  return {
    diasPorTipo,
    diasBrutos: bruto,
    diasNetos: neto,
    bolsaTrabajador,
    prorrateoBasico,
    montoEstimado,
  };
}

/** Bolsa de la operación = TIP (100%) + RC (% que se queda) - descuentos. */
function calcularBolsaOperacion(planilla) {
  const descuentos = (planilla.descuentosBolsa || []).reduce((s, d) => s + (Number(d.monto) || 0), 0);
  return (Number(planilla.tip) || 0) + (Number(planilla.rc) || 0) * (Number(planilla.rcPctOperacion) || 0) - descuentos;
}

module.exports = { diasRango, diasEnRangos, diasBrutos, diasNetos, calcularTrabajador, calcularBolsaOperacion };

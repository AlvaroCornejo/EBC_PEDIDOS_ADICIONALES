const mongoose = require('mongoose');

// Presupuesto anual por operación, con importes por mes. Un documento por operacion+anio.
//  - partidas: filas libres dentro de cada rubro del PL (planilla, SSPP, ...); cada una con su
//    nombre y 12 importes (enero a diciembre). Los importes se guardan en positivo; el signo
//    (ingreso o gasto) lo da el rubro. La partida con `esAyB` es la venta neta A&B, base del
//    costo de venta.
//  - cvPct: % de costo de venta por mes; el importe del costo de venta se calcula al vuelo como
//    cvPct × venta neta A&B (no se guarda).
const partidaSchema = new mongoose.Schema({
  id:     { type: String, required: true },
  rubro:  { type: String, required: true },          // clave del rubro: VENTA_NETA, PLANILLA, ...
  nombre: { type: String, default: '' },
  esAyB:  { type: Boolean, default: false },
  montos: { type: [Number], default: () => Array(12).fill(0) },
}, { _id: false });

const presupuestoSchema = new mongoose.Schema({
  operacion:     { type: String, required: true },
  anio:          { type: Number, required: true },
  cvPct:         { type: [Number], default: () => Array(12).fill(0) },
  // % mensual sobre la venta neta A&B de los ítems que se calculan así (comisión tarjeta, comisión delivery): { [ítem]: [12 números] }
  pcts:          { type: Object, default: () => ({}) },
  partidas:      { type: [partidaSchema], default: [] },
  actualizadoPor: { type: String, default: '' },
  actualizadoEn:  { type: Date },
});
presupuestoSchema.index({ operacion: 1, anio: 1 }, { unique: true });

module.exports = mongoose.model('Presupuesto', presupuestoSchema);

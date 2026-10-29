const mongoose = require('mongoose');

// Ciclo diario de Oficina (módulo Cierre de Caja): a diferencia de Tienda, Oficina
// no opera por turno — abre y cierra el día una sola vez, con conteo físico de
// denominación PEN/USD en ambos momentos (mismo patrón que TurnoCaja).
const cierreOficinaDiarioSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  fecha:     { type: Date, required: true },

  // { pen: {denom: qty}, usd: {denom: qty} }
  conteoApertura: { type: mongoose.Schema.Types.Mixed, default: null },
  conteoCierre:   { type: mongoose.Schema.Types.Mixed, default: null },

  abiertoPor:   { type: String, default: '' },
  fechaApertura: { type: Date, default: null },
  cerradoPor:   { type: String, default: '' },
  fechaCierre:  { type: Date, default: null },
  comentario:   { type: String, default: '' },
});
cierreOficinaDiarioSchema.index({ operacion: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('CierreOficinaDiario', cierreOficinaDiarioSchema);

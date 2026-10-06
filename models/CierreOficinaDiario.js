const mongoose = require('mongoose');

// Ciclo diario de Oficina (módulo Cierre de Caja): a diferencia de Caja,
// Oficina no opera por turno — recibe envíos de Caja durante el día y hace un
// solo conteo físico de cierre diario.
const cierreOficinaDiarioSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  fecha:     { type: Date, required: true },

  // { pen: {denom: qty}, usd: {denom: qty} }
  conteoCierre: { type: mongoose.Schema.Types.Mixed, default: null },

  cerradoPor:  { type: String, default: '' },
  fechaCierre: { type: Date, default: null },
  comentario:  { type: String, default: '' },
});
cierreOficinaDiarioSchema.index({ operacion: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('CierreOficinaDiario', cierreOficinaDiarioSchema);

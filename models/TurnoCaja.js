const mongoose = require('mongoose');

// Ciclo de Caja de Tienda (módulo Cierre de Caja): un turno por operación+fecha+turno,
// con conteo físico de efectivo (por denominación, PEN/USD) al abrir y al cerrar.
// El conteo de cierre es el del propio cajero (operativo, para saber cuánto
// enviar/depositar) — el conteo independiente del supervisor vive en SupervisorConteo.
const turnoCajaSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  fecha:     { type: Date, required: true },
  turno:     { type: String, required: true },
  estado:    { type: String, enum: ['ABIERTO', 'CERRADO'], default: 'ABIERTO' },

  // { pen: {denom: qty}, usd: {denom: qty} }
  conteoApertura: { type: mongoose.Schema.Types.Mixed, default: {} },
  conteoCierre:   { type: mongoose.Schema.Types.Mixed, default: null },

  // Reclamado por un depósito directo al banco (solo operaciones sin oficina) —
  // por moneda, porque un depósito es de una sola moneda a la vez.
  depositoPenId: { type: mongoose.Schema.Types.ObjectId, ref: 'DepositoBanco', default: null },
  depositoUsdId: { type: mongoose.Schema.Types.ObjectId, ref: 'DepositoBanco', default: null },

  abiertoPor:   { type: String, default: '' },
  fechaApertura: { type: Date, default: Date.now },
  cerradoPor:   { type: String, default: '' },
  fechaCierre:  { type: Date, default: null },
  comentario:   { type: String, default: '' },
});
turnoCajaSchema.index({ operacion: 1, fecha: 1, turno: 1 }, { unique: true });

module.exports = mongoose.model('TurnoCaja', turnoCajaSchema);

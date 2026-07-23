const mongoose = require('mongoose');

// Permite excluir manualmente un movimiento del EECC de la agrupacion automatica de
// "Deposito CAJA vs Movimiento Bancario" (ej. quedo agrupado al dia equivocado). Una vez
// excluido, el movimiento deja de sumarse en cualquier deposito y pasa a la lista de
// "sin conciliar".
const conciliacionExclusionEECCSchema = new mongoose.Schema({
  sociedad:         { type: String, required: true, index: true },
  eeccMovimientoId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'EeccMovimiento' },
  creadoPor:        { type: String, default: '' },
  creadoEn:         { type: Date, default: Date.now },
});

conciliacionExclusionEECCSchema.index({ sociedad: 1, eeccMovimientoId: 1 }, { unique: true });

module.exports = mongoose.model('ConciliacionExclusionEECC', conciliacionExclusionEECCSchema);

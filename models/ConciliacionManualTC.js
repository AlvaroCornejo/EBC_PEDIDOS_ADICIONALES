const mongoose = require('mongoose');

// Conciliacion manual: el usuario empareja a mano una cobranza (COBRANZA ERP, Tarjeta de
// Credito) sin match automatico con un movimiento de Q TC tambien sin match automatico.
const conciliacionManualTCSchema = new mongoose.Schema({
  sociedad:          { type: String, required: true, index: true },
  documentoCobranza: { type: String, required: true },
  tcMovimientoId:    { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'TcMovimiento' },
  creadoPor:         { type: String, default: '' },
  creadoEn:          { type: Date, default: Date.now },
});

conciliacionManualTCSchema.index({ sociedad: 1, documentoCobranza: 1 }, { unique: true });

module.exports = mongoose.model('ConciliacionManualTC', conciliacionManualTCSchema);

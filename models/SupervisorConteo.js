const mongoose = require('mongoose');

// Conteo independiente del supervisor, al cierre — adicional al conteo propio del
// cajero/oficina (que es solo operativo). Es el conteo que usa Gerencia para
// comparar contra el saldo calculado (teórico). Uno por TurnoCaja o por
// CierreOficinaDiario (refId apunta al que corresponda según `ubicacion`).
const supervisorConteoSchema = new mongoose.Schema({
  operacion:  { type: String, required: true, index: true },
  ubicacion:  { type: String, enum: ['TIENDA', 'OFICINA'], required: true },
  refId:      { type: mongoose.Schema.Types.ObjectId, required: true },
  fecha:      { type: Date, required: true },

  // { pen: {denom: qty}, usd: {denom: qty} }
  conteo: { type: mongoose.Schema.Types.Mixed, required: true },

  supervisadoPor: { type: String, default: '' },
  fechaRegistro:  { type: Date, default: Date.now },
  comentario:     { type: String, default: '' },
});
supervisorConteoSchema.index({ ubicacion: 1, refId: 1 }, { unique: true });

module.exports = mongoose.model('SupervisorConteo', supervisorConteoSchema);

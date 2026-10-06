const mongoose = require('mongoose');

// Transferencias de custodia del efectivo: Caja→Oficina, Caja→Banco (directo,
// operaciones sin oficina) u Oficina→Banco. Quien envía registra `montoEnviado`
// (su propia custodia termina ahí); quien recibe confirma con `montoConfirmado`,
// que puede diferir si hubo una diferencia real en el conteo.
const envioEfectivoSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },

  origen: { type: String, enum: ['CAJA', 'OFICINA'], required: true },
  // Solo para origen=CAJA (de qué turno salió). Oficina no tiene un "turno" —
  // su día se arma por rango de fecha (ver /oficina/dia, /control/oficina).
  origenTurnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'TurnoCaja', default: null },

  destino: { type: String, enum: ['OFICINA', 'BANCO'], required: true },
  moneda:  { type: String, enum: ['PEN', 'USD'], required: true },
  montoEnviado: { type: Number, required: true },

  estado: { type: String, enum: ['ENVIADO', 'CONFIRMADO'], default: 'ENVIADO' },
  montoConfirmado: { type: Number, default: null },

  fechaEnvio: { type: Date, default: Date.now },
  enviadoPor: { type: String, default: '' },
  fechaConfirmacion: { type: Date, default: null },
  confirmadoPor: { type: String, default: '' },

  comentario: { type: String, default: '' },
});
envioEfectivoSchema.index({ operacion: 1, destino: 1, estado: 1 });

module.exports = mongoose.model('EnvioEfectivo', envioEfectivoSchema);

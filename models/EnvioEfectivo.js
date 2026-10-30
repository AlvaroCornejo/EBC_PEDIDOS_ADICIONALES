const mongoose = require('mongoose');

// Transferencia de custodia Tienda → Oficina (solo operaciones con oficina central).
// Caja registra el envío al cerrar su egreso de custodia; Oficina confirma con el
// monto realmente recibido (puede diferir). Una vez CONFIRMADO, Oficina puede
// reclamarlo dentro de un DepositoBanco (se marca `depositoId`, no se puede reusar).
const envioEfectivoSchema = new mongoose.Schema({
  operacion:     { type: String, required: true, index: true },
  origenTurnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'TurnoCaja', required: true },

  moneda:       { type: String, enum: ['PEN', 'USD'], required: true },
  montoEnviado: { type: Number, required: true },
  // Desglose de lo enviado: cuánto es venta y cuánto es TIP (montoVenta+montoTip ==
  // montoEnviado) y el conteo físico por billete/moneda que se envía (misma
  // denominación que conteoApertura/Cierre, pero de una sola moneda — `denominacion`
  // = { "200": 2, "100": 1, ... }).
  montoVenta: { type: Number, default: 0 },
  montoTip:   { type: Number, default: 0 },
  denominacion: { type: mongoose.Schema.Types.Mixed, default: {} },

  estado:          { type: String, enum: ['ENVIADO', 'CONFIRMADO'], default: 'ENVIADO' },
  montoConfirmado: { type: Number, default: null },

  fechaEnvio: { type: Date, default: Date.now },
  enviadoPor: { type: String, default: '' },
  fechaConfirmacion: { type: Date, default: null },
  confirmadoPor: { type: String, default: '' },

  // Reclamado por un depósito de Oficina al banco — no se puede reusar en otro.
  depositoId: { type: mongoose.Schema.Types.ObjectId, ref: 'DepositoBanco', default: null },

  comentario: { type: String, default: '' },
});
envioEfectivoSchema.index({ operacion: 1, estado: 1 });

module.exports = mongoose.model('EnvioEfectivo', envioEfectivoSchema);

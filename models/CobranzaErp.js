const mongoose = require('mongoose');

const cobranzaErpSchema = new mongoose.Schema({
  sociedad:       { type: String, required: true, index: true },
  documento:      { type: String, default: '' },
  fecha:          { type: Date, required: true },
  medioPago:      { type: String, default: '' },
  otroMedioPago:  { type: String, default: '' },
  tc:             { type: String, default: '' }, // operador TC (NIUBIZ, etc.)
  tarjeta:        { type: String, default: '' },
  tipoCambio:     { type: Number, default: 0 },
  cobranzaMoneda: { type: Number, default: 0 }, // monto en la moneda original (Soles/Dolares)
  moneda:         { type: String, enum: ['Soles', 'Dolares'], required: true },
  venta:          { type: Number, default: 0 },
  tip:            { type: Number, default: 0 },
  cobranza:       { type: Number, default: 0 },
});

cobranzaErpSchema.index({ sociedad: 1, medioPago: 1, moneda: 1, fecha: 1 });

module.exports = mongoose.model('CobranzaErp', cobranzaErpSchema);

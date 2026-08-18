const mongoose = require('mongoose');

// Fila de pago del ERP (PagosSpring.xls), snapshot con reemplazo completo
// por sociedad en cada import.
const schema = new mongoose.Schema({
  sociedad:            { type: String, required: true },
  cuentaBancaria:      { type: String, required: true }, // código ERP
  numeroPago:          { type: Number, required: true },
  pagarA:              { type: String, default: '' },
  moneda:              { type: String, default: '' }, // LO | EX (tal como viene del ERP)
  fechaPago:           { type: Date, default: null },
  montoLocal:          { type: Number, default: 0 },
  montoExtranjero:     { type: Number, default: 0 },
  tipoPago:            { type: String, default: '' }, // EF | CC | AB | IB | CH
  voucherPago:         { type: String, default: '' },
});
schema.index({ sociedad: 1, cuentaBancaria: 1, numeroPago: 1 });

module.exports = mongoose.model('FlujoPagoERP', schema);

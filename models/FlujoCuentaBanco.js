const mongoose = require('mongoose');

// Mapea una cuenta bancaria del ERP (campo CuentaBancaria de PagosSpring) a
// su banco y moneda reales, para poder resolver a qué archivo de estado de
// cuenta corresponde cada pago del ERP.
const schema = new mongoose.Schema({
  sociedad:       { type: String, required: true },
  cuentaBancaria: { type: String, required: true }, // código ERP, ej. '0026572'
  banco:          { type: String, required: true, enum: ['BBVA', 'BCP', 'BN', 'IBK'] },
  moneda:         { type: String, required: true, enum: ['PEN', 'USD'] },
});
schema.index({ sociedad: 1, cuentaBancaria: 1 }, { unique: true });

module.exports = mongoose.model('FlujoCuentaBanco', schema);

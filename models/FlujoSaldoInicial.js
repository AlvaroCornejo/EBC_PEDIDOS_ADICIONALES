const mongoose = require('mongoose');

// Ancla del saldo corrido, una por cada cuenta bancaria (banco+moneda dentro de
// la sociedad — misma granularidad que FlujoMovimientoBancario, que no guarda
// número de cuenta ERP). Es el saldo real de esa cuenta justo antes de `fecha`.
// A partir de ahí, SALDO INICIAL/SALDO FINAL de cada día se calculan sumando
// los movimientos bancarios día a día (no se vuelve a tocar salvo que cambie
// la fecha de arranque).
const schema = new mongoose.Schema({
  sociedad: { type: String, required: true },
  banco:    { type: String, required: true, enum: ['BBVA', 'BCP', 'BN', 'IBK'] },
  moneda:   { type: String, required: true, enum: ['PEN', 'USD'] },
  fecha:    { type: Date, required: true },
  monto:    { type: Number, required: true },
});
schema.index({ sociedad: 1, banco: 1, moneda: 1 }, { unique: true });

module.exports = mongoose.model('FlujoSaldoInicial', schema);

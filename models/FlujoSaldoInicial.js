const mongoose = require('mongoose');

// Ancla del saldo corrido: el saldo real de la sociedad justo antes de `fecha`.
// A partir de ahí, SALDO INICIAL/SALDO FINAL de cada día se calculan sumando
// los movimientos bancarios día a día (no se vuelve a tocar salvo que cambie
// la fecha de arranque).
const schema = new mongoose.Schema({
  sociedad: { type: String, required: true, unique: true },
  fecha:    { type: Date, required: true },
  monto:    { type: Number, required: true },
});

module.exports = mongoose.model('FlujoSaldoInicial', schema);

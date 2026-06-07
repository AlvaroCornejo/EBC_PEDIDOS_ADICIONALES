const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  compania:          { type: String, required: true },
  banco:             { type: String, required: true },          // BBVA, BCP, IBK, etc.
  moneda:            { type: String, required: true, enum: ['SOL', 'USD'] },
  numeroCuenta:      { type: String, default: '' },
  alias:             { type: String, default: '' },
  saldoInicial:      { type: Number, default: 0 },
  fechaSaldoInicial: { type: Date, default: null },
  activa:            { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ compania: 1, banco: 1, moneda: 1, numeroCuenta: 1 });

module.exports = mongoose.model('FlujoCajaCuenta', schema);

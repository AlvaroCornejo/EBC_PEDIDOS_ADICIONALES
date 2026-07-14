const mongoose = require('mongoose');

const trxSchema = new mongoose.Schema({
  fecha:    Date,
  codigo:   { type: String, default: '' }, // código de operación bancaria (p.ej. "612", "016")
  nroDoc:   String,
  concepto: String,
  importe:  Number,
}, { _id: false });

const schema = new mongoose.Schema({
  compania:     { type: String, required: true },
  banco:        { type: String, required: true },  // BBVA, BCP, IBK
  moneda:       { type: String, required: true },  // USD, SOL
  numeroCuenta: { type: String, default: '' },     // extraído del extracto bancario
  cargadoPor:   String,
  cargadoEn:    { type: Date, default: Date.now },
  transacciones: [trxSchema],
});

schema.index({ compania: 1, banco: 1, moneda: 1 }, { unique: true });

module.exports = mongoose.model('EstadoCuenta', schema);

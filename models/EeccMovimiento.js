const mongoose = require('mongoose');

const eeccMovimientoSchema = new mongoose.Schema({
  sociedad:        { type: String, required: true, index: true },
  banco:           { type: String, default: '' },
  moneda:          { type: String, enum: ['SOL', 'USD'], required: true },
  fechaOperacion:  { type: Date, required: true },
  fechaValor:      { type: Date },
  codigo:          { type: String, default: '' },
  nroDoc:          { type: String, default: '' },
  concepto:        { type: String, default: '' },
  importe:         { type: Number, default: 0 },
  oficina:         { type: String, default: '' },
});

eeccMovimientoSchema.index({ sociedad: 1, moneda: 1, fechaOperacion: 1 });

module.exports = mongoose.model('EeccMovimiento', eeccMovimientoSchema);

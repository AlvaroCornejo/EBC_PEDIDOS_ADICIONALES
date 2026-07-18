const mongoose = require('mongoose');

const eerrSchema = new mongoose.Schema({
  unidad:       { type: String, index: true },
  periodo:      { type: Number, index: true },
  ad:           String,
  descripcionAd:String,
  persona:      String,
  factura:      String,
  grupo:        { type: String, index: true },
  cuenta:       String,
  nombreCuenta: String,
  soles:        Number,
  sociedad:     String,
  sede:         String,
});

eerrSchema.index({ periodo: 1, unidad: 1, grupo: 1 });

module.exports = mongoose.model('Eerr', eerrSchema);

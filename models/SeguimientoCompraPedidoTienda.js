const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion:     { type: String, required: true },
  grupoCompra:   { type: String, required: true }, // Familia
  año:           { type: Number, required: true },
  semana:        { type: Number, required: true },
  monto:         { type: Number, default: 0 },
  registradoPor: { type: String, default: '' },
  registradoEn:  { type: Date, default: Date.now },
});
schema.index({ operacion: 1, grupoCompra: 1, año: 1, semana: 1 }, { unique: true });

module.exports = mongoose.model('SeguimientoCompraPedidoTienda', schema);

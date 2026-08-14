const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  grupo:        { type: String, required: true }, // FC | SD (solo se importa FC)
  grupoGeneral: { type: String, default: '' },
  grupoCompra:  { type: String, required: true }, // Familia
  operacion:    { type: String, required: true },
  movimiento:   { type: String, required: true }, // INICIAL, COMPRA, VENTA, CONSUMOS, ...
  año:          { type: Number, required: true },
  semana:       { type: Number, required: true },
  cantidad:     { type: Number, default: 0 },
  importe:      { type: Number, default: 0 }, // con signo ya aplicado en la fuente
});
schema.index({ operacion: 1, año: 1, semana: 1 });
schema.index({ operacion: 1, grupoCompra: 1, año: 1, semana: 1 });

module.exports = mongoose.model('SeguimientoCompraMovimiento', schema);

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  grupo:        { type: String, required: true }, // FC | SD
  grupoGeneral: { type: String, default: '' },
  grupoCompra:  { type: String, required: true }, // Familia
  operacion:    { type: String, required: true },
  año:          { type: Number, required: true },
  semana:       { type: Number, required: true },
  claseOC:      { type: String, required: true }, // NORMAL | ADICIONAL | OTRA
  cantidadOC:   { type: Number, default: 0 },
  importeOC:    { type: Number, default: 0 },
});
schema.index({ operacion: 1, año: 1, semana: 1 });
schema.index({ operacion: 1, grupoCompra: 1, año: 1, semana: 1 });

module.exports = mongoose.model('SeguimientoCompraOC', schema);

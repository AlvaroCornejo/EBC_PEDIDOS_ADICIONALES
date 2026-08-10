const mongoose = require('mongoose');

const recetaCosteoDetalleSchema = new mongoose.Schema({
  item:          { type: Number, required: true },
  nombre:        { type: String, default: '' },
  insumo:        { type: Number, required: true },
  nombreInsumo:  { type: String, default: '' },
  cantidad:      { type: Number, default: 0 },
  mesa:          { type: Boolean, default: false },
  llevar:        { type: Boolean, default: false },
  delivery:      { type: Boolean, default: false },
  unitario:      { type: Number, default: 0 },
  batch:         { type: Number, default: 0 },
  costo:         { type: Number, default: 0 },
  grupo:         { type: String, default: '' },
  sociedad:      { type: String, default: '' },
  operacion:     { type: String, required: true },
});
recetaCosteoDetalleSchema.index({ item: 1, operacion: 1 });

module.exports = mongoose.model('RecetaCosteoDetalle', recetaCosteoDetalleSchema);

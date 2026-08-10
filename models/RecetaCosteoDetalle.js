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
// Se permite que un mismo INSUMO se repita dentro de la misma SOCIEDAD+OPERACION+ITEM (puede
// aparecer más de una vez en la receta real, ej. usado en dos preparaciones distintas del
// mismo producto) — por eso NO hay índice único acá, a diferencia de RecetaCosteo (resumen).
recetaCosteoDetalleSchema.index({ sociedad: 1, operacion: 1, item: 1, insumo: 1 });
recetaCosteoDetalleSchema.index({ item: 1, operacion: 1 });

module.exports = mongoose.model('RecetaCosteoDetalle', recetaCosteoDetalleSchema);

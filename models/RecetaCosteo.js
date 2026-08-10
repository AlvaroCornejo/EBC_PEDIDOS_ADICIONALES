const mongoose = require('mongoose');

const recetaCosteoSchema = new mongoose.Schema({
  grupo:      { type: String, default: '' },
  item:       { type: Number, required: true },
  nombre:     { type: String, default: '' },
  costo:      { type: Number, default: 0 },
  batch:      { type: Number, default: 0 },
  costoReal:  { type: Number, default: 0 },
  sociedad:   { type: String, default: '' },
  operacion:  { type: String, required: true },
});
recetaCosteoSchema.index({ item: 1, operacion: 1 }, { unique: true });
recetaCosteoSchema.index({ operacion: 1, grupo: 1 });

module.exports = mongoose.model('RecetaCosteo', recetaCosteoSchema);

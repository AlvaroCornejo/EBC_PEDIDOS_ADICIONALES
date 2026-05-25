const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sociedad:  { type: Number, required: true },
  operacion: { type: String },
  almacen:   { type: String },
  item:      { type: Number, required: true },
  fecha:     { type: Date,   required: true },
  importe:   { type: Number, default: 0 },
  cantidad:  { type: Number, default: 0 },
});
// Índices para las consultas más frecuentes
schema.index({ item: 1, sociedad: 1, fecha: -1 });
schema.index({ sociedad: 1, fecha: -1 });

module.exports = mongoose.model('CompraRoc', schema);

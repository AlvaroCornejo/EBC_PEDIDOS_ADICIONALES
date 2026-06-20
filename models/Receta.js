const mongoose = require('mongoose');

const ingredienteSchema = new mongoose.Schema({
  item:        { type: Number, required: true },
  descripcion: { type: String, default: '' },
  cantidad:    { type: Number, default: 0 },   // cantidad por batch del producto padre
  unidad:      { type: String, default: '' },
  areaDescarga:{ type: String, default: '' },
  esSub:       { type: Boolean, default: false }, // true = es sub-producido (aparece como Item1 en NT)
}, { _id: false });

const recetaSchema = new mongoose.Schema({
  item:        { type: Number, required: true, unique: true },
  descripcion: { type: String, default: '' },
  batch:       { type: Number, default: 1 },   // unidades por corrida de producción
  ingredientes:[ingredienteSchema],
  updatedAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model('Receta', recetaSchema);

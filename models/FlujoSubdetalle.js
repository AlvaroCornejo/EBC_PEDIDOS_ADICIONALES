const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  codigo:        { type: String, required: true, unique: true },
  nombre:        { type: String, required: true },
  detalleCodigo: { type: String, required: true },
  // Si está activo, al asignar un movimiento a este subdetalle la app pide
  // un comentario opcional explicando el motivo (ej. POR ASIGNAR).
  pedirComentario: { type: Boolean, default: false },
});
schema.index({ detalleCodigo: 1 });

module.exports = mongoose.model('FlujoSubdetalle', schema);

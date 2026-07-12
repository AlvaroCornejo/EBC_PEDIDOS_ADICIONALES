const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  tiendaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'ProyeccionTienda', required: true },
  semana:     { type: Number, required: true },   // YYYYIW p.ej. 202638
  ventaBruta: { type: Number, required: true, default: 0 },
}, { timestamps: true });

schema.index({ tiendaId: 1, semana: 1 }, { unique: true });

module.exports = mongoose.model('ProyeccionTiendaSupuesto', schema);

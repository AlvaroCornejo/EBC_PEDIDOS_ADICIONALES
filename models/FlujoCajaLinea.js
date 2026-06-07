const mongoose = require('mongoose');

const SECCIONES = ['SALDO_INICIAL', 'INGRESOS', 'EGRESOS', 'OTROS', 'POR_IDENTIFICAR', 'SALDO_FINAL'];

const schema = new mongoose.Schema({
  compania:    { type: String, required: true },   // '__BASE__' = estructura base, o sociedad (ERSAC, FRQ1, ...)
  seccion:     { type: String, required: true, enum: SECCIONES },
  nombre:      { type: String, required: true },
  orden:       { type: Number, default: 0 },
  // Toda línea de sociedad debe enlazar a una línea base (para poder consolidar
  // varias sociedades agrupando por línea base). Las líneas __BASE__ no tienen padre.
  baseLineaId: { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', default: null },
  activa:      { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ compania: 1, seccion: 1, orden: 1 });

schema.statics.SECCIONES = SECCIONES;

module.exports = mongoose.model('FlujoCajaLinea', schema);

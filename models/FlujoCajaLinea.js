const mongoose = require('mongoose');

const SECCIONES = ['SALDO_INICIAL', 'INGRESOS', 'EGRESOS', 'OTROS', 'POR_IDENTIFICAR', 'SALDO_FINAL'];

// Clasificación contable estándar de actividades de flujo de caja.
const TIPOS_ACTIVIDAD = ['OPERACION', 'FINANCIAMIENTO', 'INVERSION'];

const schema = new mongoose.Schema({
  compania:    { type: String, required: true },   // '__BASE__' = estructura base, o sociedad (ERSAC, FRQ1, ...)
  seccion:     { type: String, required: true, enum: SECCIONES },
  nombre:      { type: String, required: true },
  orden:       { type: Number, default: 0 },
  // Clasificación de la línea según el estado de flujo de efectivo: actividad de
  // operación, de financiamiento o de inversión. Aplica a todas las líneas
  // (base y por sociedad); las de sociedad heredan el valor de su línea base al crearse.
  tipoActividad: { type: String, enum: TIPOS_ACTIVIDAD, default: 'OPERACION' },
  // Toda línea de sociedad debe enlazar a una línea base (para poder consolidar
  // varias sociedades agrupando por línea base). Las líneas __BASE__ no tienen padre.
  baseLineaId: { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', default: null },
  activa:      { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ compania: 1, seccion: 1, orden: 1 });

schema.statics.SECCIONES = SECCIONES;
schema.statics.TIPOS_ACTIVIDAD = TIPOS_ACTIVIDAD;

module.exports = mongoose.model('FlujoCajaLinea', schema);

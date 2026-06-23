const mongoose = require('mongoose');

// venta/propina x PEN/USD — los 4 "combos" que se mueven a través de todo el flujo
const montoSchema = new mongoose.Schema({
  ventaPEN:   { type: Number, default: 0 },
  ventaUSD:   { type: Number, default: 0 },
  propinaPEN: { type: Number, default: 0 },
  propinaUSD: { type: Number, default: 0 },
}, { _id: false });

// Solo el efectivo contado viaja Caja -> Oficina -> Banco; este estado rastrea en qué etapa
// está cada combo para no enviarlo/depositarlo dos veces.
const estadoEfectivoSchema = new mongoose.Schema({
  ventaPEN:   { type: String, enum: ['PENDIENTE', 'EN_OFICINA', 'DEPOSITADO'], default: 'PENDIENTE' },
  ventaUSD:   { type: String, enum: ['PENDIENTE', 'EN_OFICINA', 'DEPOSITADO'], default: 'PENDIENTE' },
  propinaPEN: { type: String, enum: ['PENDIENTE', 'EN_OFICINA', 'DEPOSITADO'], default: 'PENDIENTE' },
  propinaUSD: { type: String, enum: ['PENDIENTE', 'EN_OFICINA', 'DEPOSITADO'], default: 'PENDIENTE' },
}, { _id: false });

const cierreCajaSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  operacion:   { type: String, required: true },
  fecha:       { type: String, required: true }, // YYYY-MM-DD
  tipoNegocio: { type: String, enum: ['RESTAURANTE', 'MOSTRADOR'], default: 'MOSTRADOR' },

  cobranzas: {
    efectivo:      { type: montoSchema, default: () => ({}) },
    tarjeta:       { type: montoSchema, default: () => ({}) },
    delivery:      { type: montoSchema, default: () => ({}) }, // CxC de aplicativos
    transferencia: { type: montoSchema, default: () => ({}) },
  },
  efectivoContado: { type: montoSchema, default: () => ({}) }, // conteo físico real (lo que se mueve)
  estadoEfectivo:  { type: estadoEfectivoSchema, default: () => ({}) },

  estado:          { type: String, enum: ['ABIERTO', 'CERRADO'], default: 'ABIERTO' },
  comentarios:     { type: String, default: '' },
  creadoPorId:     String,
  creadoPorNombre: String,
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now },
});

cierreCajaSchema.index({ operacion: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('CierreCaja', cierreCajaSchema);

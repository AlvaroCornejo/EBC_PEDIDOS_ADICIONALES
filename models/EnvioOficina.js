const mongoose = require('mongoose');

const montoSchema = new mongoose.Schema({
  ventaPEN:   { type: Number, default: 0 },
  ventaUSD:   { type: Number, default: 0 },
  propinaPEN: { type: Number, default: 0 },
  propinaUSD: { type: Number, default: 0 },
}, { _id: false });

const estadoEfectivoSchema = new mongoose.Schema({
  ventaPEN:   { type: String, enum: ['PENDIENTE', 'DEPOSITADO'], default: 'PENDIENTE' },
  ventaUSD:   { type: String, enum: ['PENDIENTE', 'DEPOSITADO'], default: 'PENDIENTE' },
  propinaPEN: { type: String, enum: ['PENDIENTE', 'DEPOSITADO'], default: 'PENDIENTE' },
  propinaUSD: { type: String, enum: ['PENDIENTE', 'DEPOSITADO'], default: 'PENDIENTE' },
}, { _id: false });

const envioOficinaSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  operacion: { type: String, required: true },
  fecha:     { type: String, required: true }, // fecha del envío

  // Cierres de caja cuyo efectivo se incluye en este envío (auditoría)
  cierres: [{ _id: false, cierreId: String, fecha: String }],

  montos:          { type: montoSchema, default: () => ({}) }, // suma del efectivo contado incluido
  montosRecibidos: { type: montoSchema, default: () => ({}) }, // confirmado por oficina al recibir
  estadoEfectivo:  { type: estadoEfectivoSchema, default: () => ({}) },

  estado:            { type: String, enum: ['ENVIADO', 'RECIBIDO'], default: 'ENVIADO' },
  comentarios:       { type: String, default: '' },
  creadoPorId:       String,
  creadoPorNombre:   String,
  recibidoPorId:     { type: String, default: '' },
  recibidoPorNombre: { type: String, default: '' },
  recibidoEn:        { type: Date, default: null },
  createdAt:         { type: Date, default: Date.now },
});

envioOficinaSchema.index({ operacion: 1, fecha: -1 });

module.exports = mongoose.model('EnvioOficina', envioOficinaSchema);

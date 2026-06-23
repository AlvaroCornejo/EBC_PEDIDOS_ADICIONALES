const mongoose = require('mongoose');

const depositoBancarioSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  operacion: { type: String, required: true },
  fecha:     { type: String, required: true }, // fecha del depósito
  moneda:    { type: String, enum: ['PEN', 'USD'], required: true },
  tipo:      { type: String, enum: ['VENTA', 'PROPINA'], required: true },
  monto:     { type: Number, required: true },
  banco:           { type: String, default: '' },
  numeroOperacion: { type: String, default: '' },

  // Según la operación tenga oficina o no, el origen son CierreCaja directos o EnvioOficina
  origenTipo: { type: String, enum: ['CIERRE', 'ENVIO'], required: true },
  origenes:   [{ _id: false, id: String, fecha: String, monto: Number }],

  comentarios:     { type: String, default: '' },
  creadoPorId:     String,
  creadoPorNombre: String,
  createdAt:       { type: Date, default: Date.now },
});

depositoBancarioSchema.index({ operacion: 1, fecha: -1 });

module.exports = mongoose.model('DepositoBancario', depositoBancarioSchema);

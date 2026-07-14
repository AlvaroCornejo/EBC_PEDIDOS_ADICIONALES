const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  compania:       { type: String, required: true },
  cuentaBancaria: { type: String, required: true }, // código corto ERP, p.ej. 00058217
  numeroProceso:  { type: Number },
  secuencia:      { type: Number },
  numeroPago:     { type: Number },
  pagarA:         { type: String, default: '' },
  moneda:         { type: String },          // LO / EX
  fechaPago:      { type: Date },
  pagoLocal:      { type: Number, default: 0 },
  pagoExtranjero: { type: Number, default: 0 },
  tipoPago:       { type: String, default: '' }, // AB CC EF IB TC
  voucher:        { type: String, default: '' },
  cargadoEn:      { type: Date, default: Date.now },
}, { timestamps: false });

schema.index({ compania: 1, numeroProceso: 1, secuencia: 1 }, { unique: true });
schema.index({ compania: 1, cuentaBancaria: 1, fechaPago: 1 });

module.exports = mongoose.model('PagoERP', schema);

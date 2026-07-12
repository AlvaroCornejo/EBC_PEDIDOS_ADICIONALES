const mongoose = require('mongoose');

const canalSchema = new mongoose.Schema({
  tipo:            { type: String, enum: ['efectivo', 'TC', 'delivery'], required: true },
  nombre:          { type: String, default: '' },
  pct:             { type: Number, default: 0 },
  comisionRate:    { type: Number, default: 0 },
  igvComisionRate: { type: Number, default: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
  compania: { type: String, required: true },
  nombre:   { type: String, required: true },
  moneda:   { type: String, enum: ['PEN', 'USD'], default: 'PEN' },
  igvRate:  { type: Number, default: 0.18 },
  rcRate:   { type: Number, default: 0.10 },
  tipRate:  { type: Number, default: 0.10 },
  activa:   { type: Boolean, default: true },
  canales:  { type: [canalSchema], default: [] },
}, { timestamps: true });

schema.index({ compania: 1, nombre: 1 });

module.exports = mongoose.model('ProyeccionTienda', schema);

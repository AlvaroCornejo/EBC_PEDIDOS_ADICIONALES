const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  item:         { type: String, required: true },
  año:          { type: Number, required: true },
  semana:       { type: Number, required: true },
  añosem:       { type: Number, required: true },   // YYYYWW
  nombre:       { type: String, default: '' },
  grupoCompra:  { type: String, default: '' },
  grupo:        { type: String, default: '' },       // grupo item (FC, etc.)
  operacion:    { type: String, required: true },
  cantidadReal: { type: Number, default: 0 },
  importeReal:  { type: Number, default: 0 },
  cantidadOC:   { type: Number, default: 0 },
  importeOC:    { type: Number, default: 0 },
  cantidadOCOT: { type: Number, default: 0 },
  importeOCOT:  { type: Number, default: 0 }
});

// Índices para consultas frecuentes
schema.index({ operacion: 1, añosem: -1 });
schema.index({ operacion: 1, item: 1, añosem: -1 });
schema.index({ operacion: 1, item: 1, añosem: 1 }, { unique: true });

module.exports = mongoose.model('ComparativoOC', schema);

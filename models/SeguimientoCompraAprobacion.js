const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion:      { type: String, required: true },
  grupoCompra:    { type: String, required: true }, // Familia
  año:            { type: Number, required: true },
  semana:         { type: Number, required: true },
  montoAprobado:  { type: Number, default: 0 }, // snapshot de OC Aprobada (todas las clases) al momento de aprobar
  aprobadoPor:    { type: String, default: '' },
  aprobadoEn:     { type: Date, default: Date.now },
});
schema.index({ operacion: 1, grupoCompra: 1, año: 1, semana: 1 }, { unique: true });

module.exports = mongoose.model('SeguimientoCompraAprobacion', schema);

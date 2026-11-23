const mongoose = require('mongoose');

// Consumo real diario (VENTA + CONSUMO TRANSFORMACION + CONSUMO PRODUCCION) de los últimos 14 días,
// desde Odoo. Reemplaza la hoja "DosSemanas" de los ADICIONALES (promedio diario para proyectar).
const schema = new mongoose.Schema({
  operacion: { type: String, required: true },
  item:      { type: String, required: true },
  fecha:     { type: String, required: true },   // YYYY-MM-DD (hora de Lima)
  cantidad:  { type: Number, default: 0 },       // positivo
  sincronizadoEn: { type: Date },
});
schema.index({ operacion: 1, item: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('ConsumoDiarioOdoo', schema);

const mongoose = require('mongoose');

// Consumo proyectado por semana desde el RQ Programado de Odoo ("Consumo proy semana obj").
// Reemplaza la hoja "Requisiciones" de los ADICIONALES.
const schema = new mongoose.Schema({
  operacion: { type: String, required: true },
  item:      { type: String, required: true },
  añosem:    { type: Number, required: true },   // semana objetivo del RQ (año*100 + semana)
  cantidad:  { type: Number, default: 0 },
  rq:        { type: String, default: '' },      // referencia del RQ de Odoo
  sincronizadoEn: { type: Date },
});
schema.index({ operacion: 1, añosem: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('ConsumoEstimadoOdoo', schema);

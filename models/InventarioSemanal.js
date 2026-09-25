const mongoose = require('mongoose');

// Histórico semanal de conteo/importe de inventario, por operación,
// almacén e ítem. El propio Excel de origen ya trae varias semanas — se
// reemplaza por completo en cada import (ver scripts/importInventarioSemanal.js),
// no se acumula historia propia en Mongo.
const inventarioSemanalSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  almacen:   { type: String, required: true },
  item:      { type: String, required: true },
  anio:      { type: Number, required: true },
  semana:    { type: Number, required: true },
  conteo:    { type: Number, default: 0 },
  importe:   { type: Number, default: 0 },
});
inventarioSemanalSchema.index({ operacion: 1, almacen: 1, anio: 1, semana: 1 });

module.exports = mongoose.model('InventarioSemanal', inventarioSemanalSchema);

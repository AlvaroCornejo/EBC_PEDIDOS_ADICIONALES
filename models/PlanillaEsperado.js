const mongoose = require('mongoose');

// Catálogo simple "esperado -> puntos", usado por el GAF en el Paso 3 de
// Planillas para asignar puntos a cada trabajador y repartir la Bolsa.
const planillaEsperadoSchema = new mongoose.Schema({
  esperado: { type: String, required: true, unique: true, trim: true },
  puntos:   { type: Number, required: true },
});

module.exports = mongoose.model('PlanillaEsperado', planillaEsperadoSchema);

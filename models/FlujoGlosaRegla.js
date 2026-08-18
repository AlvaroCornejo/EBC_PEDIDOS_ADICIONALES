const mongoose = require('mongoose');

// Método 1 de asignación: reglas de glosa -> línea de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  texto:         { type: String, required: true },
  criterio:      { type: String, required: true, enum: ['exacta', 'contiene'] },
  detalleCodigo: { type: String, required: true },
});
schema.index({ detalleCodigo: 1 });

module.exports = mongoose.model('FlujoGlosaRegla', schema);

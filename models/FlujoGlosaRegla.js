const mongoose = require('mongoose');

// Método 1 de asignación: reglas de glosa -> subdetalle de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  texto:            { type: String, required: true },
  criterio:         { type: String, required: true, enum: ['exacta', 'contiene'] },
  subdetalleCodigo: { type: String, required: true },
});
schema.index({ subdetalleCodigo: 1 });

module.exports = mongoose.model('FlujoGlosaRegla', schema);

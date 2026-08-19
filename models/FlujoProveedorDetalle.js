const mongoose = require('mongoose');

// Método 2 de asignación: beneficiario (PAGARA) -> subdetalle de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  beneficiario:     { type: String, required: true, unique: true }, // normalizado: trim + upper
  criterio:         { type: String, required: true, enum: ['exacta', 'contiene'], default: 'exacta' },
  subdetalleCodigo: { type: String, required: true },
});
schema.index({ subdetalleCodigo: 1 });

module.exports = mongoose.model('FlujoProveedorDetalle', schema);

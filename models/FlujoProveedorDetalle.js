const mongoose = require('mongoose');

// Método 2 de asignación: beneficiario (PAGARA) -> línea de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  beneficiario:  { type: String, required: true, unique: true }, // normalizado: trim + upper
  detalleCodigo: { type: String, required: true },
});
schema.index({ detalleCodigo: 1 });

module.exports = mongoose.model('FlujoProveedorDetalle', schema);

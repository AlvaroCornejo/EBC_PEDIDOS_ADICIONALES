const mongoose = require('mongoose');

// Método 2 de asignación: beneficiario (PAGARA) -> subdetalle de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  beneficiario:     { type: String, required: true }, // normalizado: trim + upper
  criterio:         { type: String, required: true, enum: ['exacta', 'contiene'], default: 'exacta' },
  subdetalleCodigo: { type: String, required: true },
  // Vacío/null = aplica a todas las sociedades. Si se especifica, la regla
  // solo se evalúa para esa sociedad (y tiene prioridad sobre una regla
  // equivalente sin sociedad — ver resolverProveedor en flujoCajaReconciliar.js).
  sociedad:         { type: String, default: '' },
});
schema.index({ beneficiario: 1, sociedad: 1 }, { unique: true });
schema.index({ subdetalleCodigo: 1 });

module.exports = mongoose.model('FlujoProveedorDetalle', schema);

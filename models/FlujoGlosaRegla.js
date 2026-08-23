const mongoose = require('mongoose');

// Método 1 de asignación: reglas de glosa -> subdetalle de flujo (mantenimiento manual).
const schema = new mongoose.Schema({
  texto:            { type: String, required: true },
  criterio:         { type: String, required: true, enum: ['exacta', 'contiene'] },
  subdetalleCodigo: { type: String, required: true },
  // Vacío/null = aplica a todas las sociedades. Si se especifica, la regla
  // solo se evalúa para esa sociedad (y tiene prioridad sobre una regla
  // equivalente sin sociedad — ver resolverReglaGlosa en flujoCajaReconciliar.js).
  sociedad:         { type: String, default: '' },
});
schema.index({ subdetalleCodigo: 1 });

module.exports = mongoose.model('FlujoGlosaRegla', schema);

const mongoose = require('mongoose');

// Asignación directa de línea del flujo a un movimiento bancario del EECC.
// Tiene máxima prioridad en la conciliación y nunca se sobreescribe por lookups automáticos.
const schema = new mongoose.Schema({
  compania: { type: String, required: true },
  banco:    { type: String, required: true },
  moneda:   { type: String, required: true },
  nroDoc:   { type: String, required: true },
  lineaId:  { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', required: true },
  asignadoPor: String,
  asignadoEn:  { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ compania: 1, banco: 1, moneda: 1, nroDoc: 1 }, { unique: true });

module.exports = mongoose.model('FlujoCajaAsignacion', schema);

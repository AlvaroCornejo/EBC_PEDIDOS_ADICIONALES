const mongoose = require('mongoose');

const personaSchema = new mongoose.Schema({
  nombre:   { type: String, required: true, trim: true },
  telefono: { type: String, default: '', trim: true },
  correos:  [{ type: String, trim: true, lowercase: true }],
  compania: { type: String, required: true, trim: true },
  creadoPor:     { type: String, default: '' },
  creadoEn:      { type: Date, default: Date.now },
  actualizadoEn: { type: Date, default: Date.now },
});

personaSchema.index({ nombre: 1, compania: 1 }, { unique: true });

module.exports = mongoose.model('Persona', personaSchema);

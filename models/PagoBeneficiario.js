const mongoose = require('mongoose');

// Maestro de beneficiarios — se actualiza automáticamente al cargar CSV
const schema = new mongoose.Schema({
  nombre:        { type: String, required: true },
  compania:      { type: String, required: true },
  grupo:         { type: String, default: 'OTROS' },
  detalleGrupo:  { type: String, default: 'OTROS' },
  banco:         { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});

schema.index({ nombre: 1, compania: 1 }, { unique: true });

module.exports = mongoose.model('PagoBeneficiario', schema);

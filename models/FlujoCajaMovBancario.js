const mongoose = require('mongoose');

// Tabla de apoyo "a": cuenta bancaria + número de operación → línea del flujo.
// Es el primer criterio que se usa para identificar a qué línea del flujo
// corresponde un movimiento bancario real.
const schema = new mongoose.Schema({
  compania:        { type: String, required: true },
  cuentaId:        { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaCuenta', required: true },
  numeroOperacion: { type: String, required: true, trim: true },
  lineaId:         { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', required: true },
}, { timestamps: true });

schema.index({ compania: 1, cuentaId: 1, numeroOperacion: 1 }, { unique: true });

module.exports = mongoose.model('FlujoCajaMovBancario', schema);

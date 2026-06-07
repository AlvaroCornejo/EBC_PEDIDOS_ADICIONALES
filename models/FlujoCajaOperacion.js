const mongoose = require('mongoose');

// Tabla de apoyo "c": descripción de la operación bancaria → línea del flujo.
// Es el 3er criterio de conciliación (cuando no se identificó por movimiento
// bancario ni por proveedor).
const schema = new mongoose.Schema({
  compania:    { type: String, required: true },
  descripcion: { type: String, required: true, trim: true },
  lineaId:     { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', required: true },
}, { timestamps: true });

schema.index({ compania: 1, descripcion: 1 }, { unique: true });

module.exports = mongoose.model('FlujoCajaOperacion', schema);

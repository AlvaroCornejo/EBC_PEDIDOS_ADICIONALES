const mongoose = require('mongoose');

// Tabla de apoyo "b": nombre del proveedor/beneficiario → línea del flujo.
// Se usa en el 2do paso de la conciliación (cuando no se identificó la línea
// por la Tabla de Movimiento Bancario y se concilia por nombre de quien recibió el pago).
const schema = new mongoose.Schema({
  compania:        { type: String, required: true },
  nombreProveedor: { type: String, required: true, trim: true },
  lineaId:         { type: mongoose.Schema.Types.ObjectId, ref: 'FlujoCajaLinea', required: true },
}, { timestamps: true });

schema.index({ compania: 1, nombreProveedor: 1 }, { unique: true });

module.exports = mongoose.model('FlujoCajaProveedor', schema);

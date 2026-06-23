const mongoose = require('mongoose');

const cajaConfigSchema = new mongoose.Schema({
  operacion:    { type: String, required: true, unique: true },
  tipoNegocio:  { type: String, enum: ['RESTAURANTE', 'MOSTRADOR'], default: 'MOSTRADOR' },
  tieneOficina: { type: Boolean, default: false },
});

module.exports = mongoose.model('CajaConfig', cajaConfigSchema);

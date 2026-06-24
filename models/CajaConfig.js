const mongoose = require('mongoose');

const cajaConfigSchema = new mongoose.Schema({
  operacion:    { type: String, required: true, unique: true },
  tipoNegocio:  { type: String, enum: ['RESTAURANTE', 'MOSTRADOR'], default: 'MOSTRADOR' },
  tieneOficina: { type: Boolean, default: false },
  // Turnos definibles por operación (ej. "Mañana"/"Tarde"/"Noche"). En un mismo
  // día se pueden abrir varias cajas (una por turno), pero nunca dos a la vez:
  // un turno nuevo solo se puede abrir si el anterior ya quedó CERRADO.
  turnos:       { type: [String], default: ['Único'] },
});

module.exports = mongoose.model('CajaConfig', cajaConfigSchema);

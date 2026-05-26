const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['ADMIN', 'OPERADOR_SOLICITUD', 'OPERADOR_APROBACION', 'OPERADOR_ATENCION', 'OPERADOR_PLANTA', 'CONSULTA_PRECIO'] },
  operations: { type: [String], default: [] },
  mustChangePassword: { type: Boolean, default: true },
  sociedadesCompra: { type: [String], default: [] }
});

module.exports = mongoose.model('User', userSchema);

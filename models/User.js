const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['ADMIN', 'OPERADOR_SOLICITUD', 'OPERADOR_APROBACION', 'OPERADOR_ATENCION', 'OPERADOR_PLANTA', 'OPERADOR_CONSULTA'] },
  operations: { type: [String], default: [] },
  mustChangePassword: { type: Boolean, default: true },
  puedeVerKardex:      { type: Boolean, default: false },
  puedeVerComparativo: { type: Boolean, default: false },
  puedeVerVentas:      { type: Boolean, default: false },
  puedeVerBajas:       { type: Boolean, default: false },
  itemsRol:            { type: String, default: '' },
  rolPago:             { type: String, default: '' },  // programador|aprobador|pagador|autorizador|admin
  sociedadesCompra:    { type: [String], default: [] }
});

module.exports = mongoose.model('User', userSchema);

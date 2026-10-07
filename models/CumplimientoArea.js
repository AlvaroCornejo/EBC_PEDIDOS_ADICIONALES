const mongoose = require('mongoose');

const cumplimientoAreaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  responsableUserId: { type: String, required: true }, // User.id
  activo: { type: Boolean, default: true },
});

module.exports = mongoose.model('CumplimientoArea', cumplimientoAreaSchema);

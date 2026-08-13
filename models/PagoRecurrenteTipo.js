const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  activo: { type: Boolean, default: true },
});
module.exports = mongoose.model('PagoRecurrenteTipo', schema);

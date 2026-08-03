const mongoose = require('mongoose');

const maestroCuentaSchema = new mongoose.Schema({
  cuenta: { type: Number, required: true, unique: true },
  nombre: { type: String, required: true, trim: true },
});

module.exports = mongoose.model('MaestroCuenta', maestroCuentaSchema);

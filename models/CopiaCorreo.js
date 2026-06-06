const mongoose = require('mongoose');

const copiaCorreoSchema = new mongoose.Schema({
  compania:      { type: String, required: true, unique: true, trim: true },
  correos:       [{ type: String, trim: true, lowercase: true }],
  actualizadoEn: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CopiaCorreo', copiaCorreoSchema);

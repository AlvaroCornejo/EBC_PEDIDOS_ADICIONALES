const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  codigo: { type: String, default: '' },
  activo: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('PagoBanco', schema);

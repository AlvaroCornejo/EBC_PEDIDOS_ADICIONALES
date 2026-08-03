const mongoose = require('mongoose');

const maestroTipoItemSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, trim: true },
  nombre: { type: String, required: true, trim: true },
});

module.exports = mongoose.model('MaestroTipoItem', maestroTipoItemSchema);

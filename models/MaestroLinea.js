const mongoose = require('mongoose');

const maestroLineaSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, trim: true },
  nombre: { type: String, required: true, trim: true },
  ver:    { type: String, default: 'G', enum: ['G', 'S'] }, // S = excluida de "no asignados"
});

module.exports = mongoose.model('MaestroLinea', maestroLineaSchema);

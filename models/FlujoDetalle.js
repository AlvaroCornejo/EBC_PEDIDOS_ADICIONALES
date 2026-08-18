const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  codigo:      { type: String, required: true, unique: true },
  nombre:      { type: String, required: true },
  tipo:        { type: String, required: true, enum: ['operacion', 'inversion', 'financiamiento'] },
  lineaCodigo: { type: String, required: true },
});
schema.index({ lineaCodigo: 1 });

module.exports = mongoose.model('FlujoDetalle', schema);

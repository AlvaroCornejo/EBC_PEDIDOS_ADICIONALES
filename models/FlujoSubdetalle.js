const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  codigo:        { type: String, required: true, unique: true },
  nombre:        { type: String, required: true },
  detalleCodigo: { type: String, required: true },
});
schema.index({ detalleCodigo: 1 });

module.exports = mongoose.model('FlujoSubdetalle', schema);

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion:  { type: String, required: true },
  item:       { type: Number, required: true },
  basePareto: { type: Number, default: 0 },
});
schema.index({ operacion: 1, basePareto: -1 });
schema.index({ operacion: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('CompraPareto', schema);

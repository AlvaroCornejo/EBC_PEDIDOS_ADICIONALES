const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  item:        { type: Number, required: true, unique: true },
  nombre:      { type: String },
  grupoCompra: { type: String },
  grupo:       { type: String },
  grupoFamilia:{ type: String },
});
schema.index({ grupoCompra: 1 });

module.exports = mongoose.model('CompraItem', schema);

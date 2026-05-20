const mongoose = require('mongoose');
const itemSchema = new mongoose.Schema({
  operacion:   { type: String, required: true },
  item:        { type: String, required: true },
  nombre:      { type: String, default: '' },
  grupoCompra: { type: String, default: '' },
  gestion:     { type: String, default: 'COMPRAS' },
  loteCompra:  { type: Number, default: 1 },
  activo:      { type: Boolean, default: true }
});
itemSchema.index({ operacion: 1, item: 1 }, { unique: true });
module.exports = mongoose.model('Item', itemSchema);

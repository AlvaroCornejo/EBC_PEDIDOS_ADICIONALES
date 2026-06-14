const mongoose = require('mongoose');
const itemVentaSchema = new mongoose.Schema({
  operacion: { type: String, required: true },
  item:      { type: Number, required: true },
  nombre:    { type: String, default: '' },
});
itemVentaSchema.index({ operacion: 1, item: 1 }, { unique: true });
module.exports = mongoose.model('ItemVenta', itemVentaSchema);

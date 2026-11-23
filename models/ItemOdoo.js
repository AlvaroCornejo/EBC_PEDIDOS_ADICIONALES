const mongoose = require('mongoose');

// Ítems de Adicionales leídos de Odoo (scripts/syncKardexOdoo.js): productos de los RQ Programados
// recientes de cada almacén. Reemplaza la hoja "Items" + "Costos" de los ADICIONALES.
const schema = new mongoose.Schema({
  operacion:   { type: String, required: true },
  item:        { type: String, required: true },   // código legacy
  nombre:      { type: String, default: '' },
  grupoCompra: { type: String, default: '' },      // categoría del producto en Odoo
  uom:         { type: String, default: '' },
  costo:       { type: Number, default: 0 },       // costo de Odoo (standard_price) de la empresa del almacén
  sincronizadoEn: { type: Date },
});
schema.index({ operacion: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('ItemOdoo', schema);

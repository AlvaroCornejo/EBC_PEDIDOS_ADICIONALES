const mongoose = require('mongoose');

// Catálogo de ítems por operación (hoja "ITEMS_POR_OPERACION" de EBC
// ITEMS.xlsx). Se reemplaza por completo en cada import (ver
// scripts/importEbcItems.js). No confundir con el modelo `Item` existente
// (sincronizado aparte, desde los Excel ADICIONALES, hoja "Items") — fuentes
// distintas, se mantienen separadas a propósito.
const itemPorOperacionSchema = new mongoose.Schema({
  operacion:   { type: String, required: true },
  item:        { type: String, required: true },
  nombre:      { type: String, default: '' },
  grupoCompra: { type: String, default: '' },
  grupo:       { type: String, default: '' },
});
itemPorOperacionSchema.index({ operacion: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('ItemPorOperacion', itemPorOperacionSchema);

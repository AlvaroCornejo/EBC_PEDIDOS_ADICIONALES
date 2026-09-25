const mongoose = require('mongoose');

// Catálogo global de ítems (hoja "MAESTRO_ITEMS" de EBC ITEMS.xlsx, sin
// operación) — usado para resolver el nombre en Inventarios Diarios.
// Se reemplaza por completo en cada import (ver scripts/importEbcItems.js).
const itemMaestroSchema = new mongoose.Schema({
  item:        { type: String, required: true, unique: true },
  nombre:      { type: String, default: '' },
  grupoCompra: { type: String, default: '' },
  grupo:       { type: String, default: '' },
});

module.exports = mongoose.model('ItemMaestro', itemMaestroSchema);

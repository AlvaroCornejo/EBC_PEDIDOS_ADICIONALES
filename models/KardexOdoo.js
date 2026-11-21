const mongoose = require('mongoose');

// Kardex (consumos reales) leído de Odoo por scripts/syncKardexOdoo.js — mismo formato que la
// hoja "Kardex" de los ADICIONALES: ITEM, TRX, AÑOSEM, CANTIDAD (con signo), IMPORTE, OPERACION.
// Se reemplaza por completo en cada corrida.
const schema = new mongoose.Schema({
  operacion: { type: String, required: true },   // código de la app (PTAFK → PLANTA, etc.)
  almacen:   { type: String, default: '' },      // código del almacén en Odoo
  item:      { type: String, required: true },   // código legacy (default_code_legacy)
  añosem:    { type: Number, required: true },   // año ISO * 100 + semana ISO
  trx:       { type: String, required: true },   // COMPRA, VENTA, CONSUMOS, RANCHO, …
  cantidad:  { type: Number, default: 0 },       // + ingreso / − salida, en la UdM del producto
  importe:   { type: Number, default: 0 },       // S/ sin IGV (valorización de Odoo), mismo signo
  sincronizadoEn: { type: Date },
});

schema.index({ operacion: 1, item: 1, añosem: 1, trx: 1 }, { unique: true });

module.exports = mongoose.model('KardexOdoo', schema);

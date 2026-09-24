const mongoose = require('mongoose');

// Snapshot diario de conteo físico vs. saldo de sistema, por operación y
// almacén/área. Se reemplaza por completo en cada import — no guarda
// historia (ver scripts/importInventarioDiario.js).
const inventarioDiarioSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  almacen:   { type: String, required: true },
  item:      { type: String, required: true },
  conteo:    { type: Number, default: 0 },
  saldo:     { type: Number, default: 0 },
});
inventarioDiarioSchema.index({ operacion: 1, almacen: 1 });

module.exports = mongoose.model('InventarioDiario', inventarioDiarioSchema);

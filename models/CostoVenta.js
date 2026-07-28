const mongoose = require('mongoose');

const costoVentaSchema = new mongoose.Schema({
  almacen:     String,
  item:        String,
  transaccion: String,
  periodo:     { type: Number, index: true },
  cantidad:    Number,
  nombreOp:    String,
  grupoEerr:   String,
  soles:       Number,
  nombreItem:  String,
  grupo:       { type: String, index: true },
  sede:        { type: String, index: true },
});

costoVentaSchema.index({ periodo: 1, sede: 1, grupo: 1, nombreOp: 1 });

module.exports = mongoose.model('CostoVenta', costoVentaSchema);

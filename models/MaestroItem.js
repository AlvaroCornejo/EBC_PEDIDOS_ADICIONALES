const mongoose = require('mongoose');

const maestroItemSchema = new mongoose.Schema({
  item:            { type: Number, required: true, unique: true },
  nombre:          { type: String, required: true, trim: true },
  tipoItem:        { type: String, default: '' },
  linea:           { type: String, default: '' },
  familia:         { type: String, default: '' },
  subFamilia:      { type: String, default: '' },
  um:              { type: String, default: '' },
  cuentaInventario:  { type: Number, default: null },
  cuentaGasto:       { type: Number, default: null },
  cuentaCostoVenta:  { type: Number, default: null },
  cuentaVenta:       { type: Number, default: null },
  activo:          { type: Boolean, default: true },
});

module.exports = mongoose.model('MaestroItem', maestroItemSchema);

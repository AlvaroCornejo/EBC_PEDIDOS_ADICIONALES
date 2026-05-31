const mongoose = require('mongoose');

// Catálogo de ítems maestro (una fila por operacion+item)
const schema = new mongoose.Schema({
  operacion:     { type: String, required: true },
  item:          { type: Number, required: true },
  nombre:        String,
  tipoItem:      String,
  linea:         Number,
  familia:       Number,
  subFamilia:    Number,
  unidad:        String,
  codigoInterno: Number,
});

schema.index({ item: 1, operacion: 1 }, { unique: true });
schema.index({ operacion: 1, nombre: 1 });
schema.index({ operacion: 1, linea: 1, familia: 1, subFamilia: 1 });

module.exports = mongoose.model('ItemsMaestro', schema);

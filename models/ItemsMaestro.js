const mongoose = require('mongoose');

// Catálogo de ítems maestro (cargado desde EBC ITEMS.xlsx)
const schema = new mongoose.Schema({
  item:          { type: Number, required: true, unique: true },
  nombre:        String,
  tipoItem:      String,   // código puede ser '01','C','PT','TR'
  linea:         Number,
  familia:       Number,
  subFamilia:    Number,
  unidad:        String,
  codigoInterno: Number,
});

schema.index({ nombre: 'text' });
schema.index({ linea: 1, familia: 1, subFamilia: 1 });
schema.index({ tipoItem: 1 });

module.exports = mongoose.model('ItemsMaestro', schema);

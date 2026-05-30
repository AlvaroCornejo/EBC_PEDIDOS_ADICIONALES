const mongoose = require('mongoose');

// Tablas de referencia del catálogo (lineas, familias, sub_familias, tipo_items, grupo_compra)
// Se almacenan como {tipo, codigo, nombre, linea?, familia?} para consulta flexible
const schema = new mongoose.Schema({
  tipo:       { type: String, required: true }, // 'linea'|'familia'|'sub_familia'|'tipo_item'|'grupo_compra'
  codigo:     { type: String, required: true }, // pk de cada tabla (puede ser string para tipo_item)
  nombre:     { type: String, required: true },
  linea:      Number,    // para familia y sub_familia
  familia:    Number,    // para sub_familia
});

schema.index({ tipo: 1, linea: 1, familia: 1, codigo: 1 }, { unique: true });
schema.index({ tipo: 1, linea: 1 });

module.exports = mongoose.model('ItemsRef', schema);

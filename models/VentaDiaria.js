const mongoose = require('mongoose');

// Histórico de venta diaria por operación/canal/turno, desde EBC VENTAS.xlsx
// (hoja "VENTA"). El Excel ya trae el histórico completo — se reemplaza por
// completo en cada import, no se acumula historia propia (ver
// scripts/importVentas.js).
const ventaDiariaSchema = new mongoose.Schema({
  operacion:     { type: String, required: true, index: true },
  canal:         { type: String, required: true },
  fecha:         { type: Date, required: true },
  tipoDocumento: { type: String, required: true, enum: ['VENTA', 'CORTESIA'] },
  turno:         { type: String, default: '' },
  pax:           { type: Number, default: 0 },
  tickets:       { type: Number, default: 0 },
  venta:         { type: Number, default: 0 },
  // Suma de permanencia en fracción de día de todas las operaciones de esta
  // fila — se divide entre pax o tickets (según el canal) para el promedio.
  permanencia:   { type: Number, default: 0 },
});
ventaDiariaSchema.index({ operacion: 1, fecha: 1 });

module.exports = mongoose.model('VentaDiaria', ventaDiariaSchema);

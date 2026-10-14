const mongoose = require('mongoose');

// Pronóstico semanal de venta por operación/canal, desde EBC PRONOSTICO VENTAS.xlsx
// (hoja "PRONOSTICO"). Se reemplaza por completo en cada import
// (scripts/importVentas.js lo carga junto con la venta real).
const ventaPronosticoSchema = new mongoose.Schema({
  operacion: { type: String, required: true },
  periodo:   { type: Number, required: true },   // AAAASS (semana ISO), ej. 202642
  anio:      { type: Number, default: 0 },
  semana:    { type: Number, default: 0 },
  canal:     { type: String, required: true },   // tal como viene en el Excel (LOCAL, TO GO, ...)
  pax:       { type: Number, default: 0 },
  ticket:    { type: Number, default: 0 },
  venta:     { type: Number, default: 0 },
});
ventaPronosticoSchema.index({ operacion: 1, periodo: 1 });

module.exports = mongoose.model('VentaPronostico', ventaPronosticoSchema);

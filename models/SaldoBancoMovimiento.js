const mongoose = require('mongoose');

// Snapshot de movimientos por cuenta — se reemplaza por completo (por
// "cuenta") en cada import diario del archivo "movimientos*" de esa cuenta,
// descargado a la carpeta Descargas del servidor. "saldo" es el saldo DESPUÉS
// de ese movimiento (running balance) — para BBVA se calcula acumulando
// desde el marcador "Saldo Inicial" del archivo (no viene explícito por
// fila); para BCP e IBK viene directo en la columna Saldo del banco.
const saldoBancoMovimientoSchema = new mongoose.Schema({
  cuenta:   { type: String, required: true, index: true }, // ref SaldoCuentaBanco.cuenta
  sociedad: { type: String, required: true },
  banco:    { type: String, required: true },
  moneda:   { type: String, required: true },
  fecha:    { type: Date, required: true },
  glosa:    { type: String, default: '' },
  importe:  { type: Number, required: true }, // con signo
  saldo:    { type: Number, required: true }, // saldo tras este movimiento
  // Orden cronológico dentro del import (la fecha del banco solo trae día,
  // sin hora, así que con varios movimientos el mismo día "fecha" no basta
  // para saber cuál fue el último — seq lo preserva).
  seq:      { type: Number, default: 0 },
});
saldoBancoMovimientoSchema.index({ cuenta: 1, fecha: 1, seq: 1 });

module.exports = mongoose.model('SaldoBancoMovimiento', saldoBancoMovimientoSchema);

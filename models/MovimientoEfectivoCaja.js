const mongoose = require('mongoose');

// Ingresos/egresos de efectivo dentro de un turno de Tienda. VENTA y TIP son
// ingresos (PEN o USD, cada venta se registra en la moneda en que se cobró).
// VUELTO es el único egreso de movimiento — siempre en PEN, porque el negocio
// solo vende en soles: un pago en dólares da su vuelto en soles, registrado
// como un VUELTO independiente, no emparejado con el ingreso que lo generó.
const movimientoEfectivoCajaSchema = new mongoose.Schema({
  turnoId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TurnoCaja', required: true, index: true },
  operacion: { type: String, required: true },
  fecha:     { type: Date, required: true },

  tipo:   { type: String, enum: ['VENTA', 'TIP', 'VUELTO'], required: true },
  moneda: { type: String, enum: ['PEN', 'USD'], required: true },
  monto:  { type: Number, required: true },

  comentario: { type: String, default: '' },
  creadoPor:  { type: String, default: '' },
  fechaRegistro: { type: Date, default: Date.now },
});
movimientoEfectivoCajaSchema.index({ turnoId: 1 });

module.exports = mongoose.model('MovimientoEfectivoCaja', movimientoEfectivoCajaSchema);

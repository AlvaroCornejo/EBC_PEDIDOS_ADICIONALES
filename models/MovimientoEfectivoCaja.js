const mongoose = require('mongoose');

// Ingresos de efectivo dentro de un turno de Caja. VENTA/TIP_COMERCIAL/
// TIP_TIENDA mueven una sola moneda (moneda+monto). CAMBIO_MONEDA es un vuelto
// en otra moneda (ej. se cobra en USD una cuenta en PEN y se da vuelto en
// PEN) — se guarda como un solo movimiento con los dos lados, para no perder
// la relación entre el ingreso y el egreso que lo generó.
const movimientoEfectivoCajaSchema = new mongoose.Schema({
  turnoId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TurnoCaja', required: true, index: true },
  operacion: { type: String, required: true },
  fecha:     { type: Date, required: true },

  tipo: { type: String, enum: ['VENTA', 'TIP_COMERCIAL', 'TIP_TIENDA', 'CAMBIO_MONEDA'], required: true },

  // VENTA / TIP_COMERCIAL / TIP_TIENDA
  moneda: { type: String, enum: ['PEN', 'USD', null], default: null },
  monto:  { type: Number, default: 0 },

  // CAMBIO_MONEDA (vuelto en otra moneda)
  monedaIngreso: { type: String, enum: ['PEN', 'USD', null], default: null },
  montoIngreso:  { type: Number, default: 0 },
  monedaEgreso:  { type: String, enum: ['PEN', 'USD', null], default: null },
  montoEgreso:   { type: Number, default: 0 },

  comentario: { type: String, default: '' },
  creadoPor:  { type: String, default: '' },
  fechaRegistro: { type: Date, default: Date.now },
});
movimientoEfectivoCajaSchema.index({ turnoId: 1 });

module.exports = mongoose.model('MovimientoEfectivoCaja', movimientoEfectivoCajaSchema);

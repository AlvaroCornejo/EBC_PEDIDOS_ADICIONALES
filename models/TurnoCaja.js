const mongoose = require('mongoose');

// Ciclo de Caja (módulo Cierre de Caja): un turno por operación+fecha+turno,
// con conteo físico de efectivo (por denominación, PEN/USD) al abrir y al
// cerrar. Venta por canal y TIP facturado son datos de reporte capturados al
// cerrar, no mueven efectivo.
const turnoCajaSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  fecha:     { type: Date, required: true },
  turno:     { type: String, required: true },
  estado:    { type: String, enum: ['ABIERTO', 'CERRADO'], default: 'ABIERTO' },

  // { pen: {denom: qty}, usd: {denom: qty} }
  conteoApertura: { type: mongoose.Schema.Types.Mixed, default: {} },
  conteoCierre:   { type: mongoose.Schema.Types.Mixed, default: null },

  ventaPorCanal: {
    LOCAL:     { type: Number, default: 0 },
    LLEVAR:    { type: Number, default: 0 },
    DELIVERY:  { type: Number, default: 0 },
    COMERCIAL: { type: Number, default: 0 },
    OTROS:     { type: Number, default: 0 },
  },
  tipFacturado: { type: Number, default: 0 },

  abiertoPor:   { type: String, default: '' },
  fechaApertura: { type: Date, default: Date.now },
  cerradoPor:   { type: String, default: '' },
  fechaCierre:  { type: Date, default: null },
  comentario:   { type: String, default: '' },
});
turnoCajaSchema.index({ operacion: 1, fecha: 1, turno: 1 }, { unique: true });

module.exports = mongoose.model('TurnoCaja', turnoCajaSchema);

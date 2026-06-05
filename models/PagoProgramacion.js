const mongoose = require('mongoose');

const obligacionSchema = new mongoose.Schema({
  tipoDocumento:   String,
  numeroDocumento: String,
  fechaVencimiento:Date,
  moneda:          String,
  monto:           Number,
  pagarA:          String,
  fechaDocumento:  Date,
  banco:           String,   // banco original de la obligación
  diasVencido:     Number,
  grupo:           { type: String, default: 'OTROS' },
  detalleGrupo:    { type: String, default: 'OTROS' },
  seleccionado:    { type: Boolean, default: false },
  // Paso 3 — Preparación
  bancoAsignado:   { type: String, default: '' },   // banco de pago asignado en Paso 3
  agrupadorPago:   { type: String, default: 'INDIVIDUAL' }, // agrupador de pago
}, { _id: true });

const schema = new mongoose.Schema({
  compania:   { type: String, required: true },
  fechaPago:  { type: Date, required: true },   // próximo viernes
  semana:     Number,
  año:        Number,
  creadoPor:   String,
  creadoEn:    { type: Date, default: Date.now },
  enviadoPor:    String,
  enviadoEn:     Date,
  aprobadoPor:   String,
  aprobadoEn:    Date,
  preparadoPor:  String,
  preparadoEn:   Date,
  autorizadoPor: String,
  autorizadoEn:  Date,
  estado:          { type: String, default: 'borrador',
                     enum: ['borrador','pendiente','aprobado','preparado','autorizado','pagado'] },
  promediosPagos:  { type: mongoose.Schema.Types.Mixed, default: {} },
  obligaciones: [obligacionSchema],
});

schema.index({ compania: 1, año: 1, semana: 1 });

module.exports = mongoose.model('PagoProgramacion', schema);

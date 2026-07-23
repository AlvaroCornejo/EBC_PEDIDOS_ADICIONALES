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
  bancoAsignado:    { type: String, default: '' },
  agrupadorPago:    { type: String, default: 'INDIVIDUAL' },
  retencion:        { type: Number, default: 0 },
  observaciones:    { type: String, default: '' },
  // Pago parcial: esParcial=true indica que esta fila es una porción de otra obligación
  esParcial:           { type: Boolean, default: false },
  obligacionOrigenId:  { type: String, default: '' }, // _id de la obligación original
  origenEBC:           { type: Boolean, default: false }, // marcado via Autorizaciones de Pago
  // Paso 5 — Registro Movimiento Bancario
  operacionBancaria:{ type: String, default: '' },
  importeBanco:     { type: Number, default: null }, // legacy
  p5Banco:          { type: String, default: '' },  // banco de pago (def = bancoAsignado P3)
  p5Moneda:         { type: String, default: '' },  // moneda de pago  (def = moneda P3)
  // Fecha/hora real de la operación bancaria: se sugiere con el Estado de Cuenta (EC)
  // cargado, pero es editable a mano porque el EC casi nunca trae hora.
  fechaHoraOperacion: { type: Date, default: null },
  pagada:           { type: Boolean, default: false }, // true cuando se registra el pago
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
  pagadoPor:     String,
  pagadoEn:      Date,
  estado:          { type: String, default: 'borrador',
                     enum: ['borrador','pendiente','aprobado','preparado','autorizado','pagado'] },
  promediosPagos:  { type: mongoose.Schema.Types.Mixed, default: {} },
  obligaciones: [obligacionSchema],
});

schema.index({ compania: 1, año: 1, semana: 1 });

module.exports = mongoose.model('PagoProgramacion', schema);

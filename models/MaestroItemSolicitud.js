const mongoose = require('mongoose');

const maestroItemSolicitudSchema = new mongoose.Schema({
  sociedad:   { type: String, required: true },
  origenItem: { type: Number, default: null }, // item copiado, si aplica

  nombre:     { type: String, default: '' },
  tipoItem:   { type: String, default: '' },
  linea:      { type: String, default: '' },
  familia:    { type: String, default: '' },
  subFamilia: { type: String, default: '' },
  um:         { type: String, default: '' },
  cuentaInventario: { type: Number, default: null },
  cuentaGasto:      { type: Number, default: null },
  cuentaCostoVenta: { type: Number, default: null },
  cuentaVenta:      { type: Number, default: null },

  estado: { type: String, default: 'borrador', enum: ['borrador', 'pendiente', 'aprobado', 'rechazado', 'completado'] },

  creadoPor: { type: String, required: true },
  creadoEn:  { type: Date, default: Date.now },
  enviadoEn: { type: Date },

  validadoPor: { type: String },
  validadoEn:  { type: Date },
  comentarioValidador: { type: String, default: '' },

  itemAsignado:  { type: Number, default: null },
  registradoPor: { type: String },
  registradoEn:  { type: Date },
});

module.exports = mongoose.model('MaestroItemSolicitud', maestroItemSolicitudSchema);

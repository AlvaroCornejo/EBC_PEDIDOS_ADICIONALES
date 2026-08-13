const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion:      { type: String, required: true },
  tipoPago:       { type: String, required: true },
  descripcion:    { type: String, default: '' },
  diaPago:        { type: Number, required: true, min: 1, max: 31 },
  intervaloMeses: { type: Number, default: 1 }, // 1=mensual, 2=bimestral, 3=trimestral, 6=semestral, 12=anual
  montoEstimado:  { type: Number, required: true },
  fechaInicio:    { type: Date, required: true },
  activa:         { type: Boolean, default: true },
  creadoPor:      { type: String, default: '' },
  creadoEn:       { type: Date, default: Date.now },
});
schema.index({ operacion: 1, activa: 1 });

module.exports = mongoose.model('PagoRecurrenteRegla', schema);

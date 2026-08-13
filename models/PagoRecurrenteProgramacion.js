const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  reglaId:         { type: String, required: true },
  operacion:       { type: String, required: true },
  tipoPago:        { type: String, required: true },
  descripcion:     { type: String, default: '' },
  fechaProgramada: { type: Date, required: true },
  montoProgramado: { type: Number, required: true },
  estado:          { type: String, default: 'pendiente', enum: ['pendiente', 'pagado', 'anulado'] },
  fechaPagoReal:   { type: Date, default: null },
  montoPagoReal:   { type: Number, default: null },
  comentario:      { type: String, default: '' },
  registradoPor:   { type: String, default: '' },
  registradoEn:    { type: Date, default: Date.now },
  pagadoPor:       { type: String, default: '' },
  pagadoEn:        { type: Date, default: null },
});
schema.index({ reglaId: 1, fechaProgramada: 1 }, { unique: true });
schema.index({ operacion: 1, fechaProgramada: 1 });
schema.index({ tipoPago: 1 });

module.exports = mongoose.model('PagoRecurrenteProgramacion', schema);

const mongoose = require('mongoose');

const diaProyectadoSchema = new mongoose.Schema({
  diaSemana: { type: Number, required: true }, // 1=lunes .. 7=domingo
  cantidad:  { type: Number, default: 0 },
}, { _id: false });

const canalForecastSchema = new mongoose.Schema({
  canal:            { type: String, required: true },
  ticketPropuesto:  { type: Number, default: 0 },
  dias:             { type: [diaProyectadoSchema], default: [] },
}, { _id: false });

const ventaForecastSchema = new mongoose.Schema({
  operacion: { type: String, required: true },
  año:       { type: Number, required: true },
  semana:    { type: Number, required: true }, // semana ISO que se está proyectando

  canales: { type: [canalForecastSchema], default: [] },

  actualizadoPor: { type: String },
  actualizadoEn:  { type: Date, default: Date.now },
});
ventaForecastSchema.index({ operacion: 1, año: 1, semana: 1 }, { unique: true });

module.exports = mongoose.model('VentaForecast', ventaForecastSchema);

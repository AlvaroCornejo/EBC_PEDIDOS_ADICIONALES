const mongoose = require('mongoose');

const ventaCanalDiariaSchema = new mongoose.Schema({
  operacion:              { type: String, required: true },
  canal:                  { type: String, required: true },
  fecha:                  { type: Date, required: true },
  pax:                    { type: Number, default: 0 },
  transacciones:          { type: Number, default: 0 },
  ventaBruta:             { type: Number, default: 0 },
  ventaBrutaMasRedencion: { type: Number, default: 0 },
  ventaNeta:              { type: Number, default: 0 },
  ventaNetaMasRedencion:  { type: Number, default: 0 },
});
ventaCanalDiariaSchema.index({ operacion: 1, canal: 1, fecha: 1 }, { unique: true });
ventaCanalDiariaSchema.index({ operacion: 1, fecha: 1 });

module.exports = mongoose.model('VentaCanalDiaria', ventaCanalDiariaSchema);

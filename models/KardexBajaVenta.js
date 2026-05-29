const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion: { type: String, required: true },
  item:      { type: Number, required: true },
  añosem:    { type: Number, required: true },   // año*100 + semana ISO
  año:       { type: Number, required: true },
  semana:    { type: Number, required: true },
  bajaCant:  { type: Number, default: 0 },
  bajaImp:   { type: Number, default: 0 },
  ventaCant: { type: Number, default: 0 },
  ventaImp:  { type: Number, default: 0 },
});

schema.index({ operacion: 1, item: 1, añosem: 1 }, { unique: true });
schema.index({ operacion: 1, añosem: 1 });

module.exports = mongoose.model('KardexBajaVenta', schema);

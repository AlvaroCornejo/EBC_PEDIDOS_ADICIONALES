const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  operacion:    { type: String, required: true },
  año:          { type: Number, required: true },
  semana:       { type: Number, required: true },
  añosem:       { type: Number, required: true },   // año*100 + semana (ISO week)
  añoN:         { type: Number },                    // año calendario
  mesN:         { type: Number },                    // mes 1-12 (calendario)
  añomes:       { type: Number },                    // añoN*100 + mesN
  ventaBruta:   { type: Number, default: 0 },
  ventaNeta:    { type: Number, default: 0 },
  tipEfectivo:  { type: Number, default: 0 },
  tipTC:        { type: Number, default: 0 }
});

schema.index({ operacion: 1, añosem: 1 }, { unique: true });
schema.index({ operacion: 1, añomes: 1 });

module.exports = mongoose.model('VentasTip', schema);

const mongoose = require('mongoose');

const cajaDiariaSchema = new mongoose.Schema({
  sociedad:            { type: String, required: true, index: true },
  fecha:               { type: Date, required: true },
  cobranzaEfectivo:    { type: Number, default: 0 },
  tipEfectivo:         { type: Number, default: 0 },
  tipEfectivoCmz:      { type: Number, default: 0 },
  tipFact:             { type: Number, default: 0 },
  tipFactCmz:          { type: Number, default: 0 },
  vueltoSoles:         { type: Number, default: 0 }, // ya viene en negativo
  depositoPen:         { type: Number, default: null }, // null = sin depósito ese día
  cobranzaEfectivoUsd: { type: Number, default: 0 },
  tipUsd:              { type: Number, default: 0 },
  depositoUsd:         { type: Number, default: null },
});

cajaDiariaSchema.index({ sociedad: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('CajaDiaria', cajaDiariaSchema);

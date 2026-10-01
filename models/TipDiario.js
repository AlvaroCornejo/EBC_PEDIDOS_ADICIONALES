const mongoose = require('mongoose');

// Propinas diarias por operación, desde EBC VENTAS.xlsx (hoja "TIP"). Se
// reemplaza por completo en cada import, igual que VentaDiaria.
const tipDiarioSchema = new mongoose.Schema({
  operacion:  { type: String, required: true, index: true },
  fecha:      { type: Date, required: true },
  tipEfeSol:  { type: Number, default: 0 },
  tipTcSol:   { type: Number, default: 0 },
  tipEfeDol:  { type: Number, default: 0 },
});
tipDiarioSchema.index({ operacion: 1, fecha: 1 });

module.exports = mongoose.model('TipDiario', tipDiarioSchema);

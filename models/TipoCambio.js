const mongoose = require('mongoose');

// Tabla manual de tipo de cambio (USD → SOL), usada para combinar el flujo de
// caja de varias monedas en una sola vista "Combinado en Soles".
const schema = new mongoose.Schema({
  fecha:          { type: Date, required: true, unique: true },
  valor:          { type: Number, required: true },   // soles por 1 dólar
  actualizadoPor: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('TipoCambio', schema);

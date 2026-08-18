const mongoose = require('mongoose');

// Rutas de archivos de origen por sociedad, para el sync diario.
const schema = new mongoose.Schema({
  sociedad:      { type: String, required: true, unique: true },
  rutaPagosERP:  { type: String, default: '' }, // PagosSpring.xls
  archivosBanco: {
    type: [{
      banco:  { type: String, required: true, enum: ['BBVA', 'BCP', 'BN', 'IBK'] },
      moneda: { type: String, required: true, enum: ['PEN', 'USD'] },
      ruta:   { type: String, required: true },
    }],
    default: [],
  },
});

module.exports = mongoose.model('FlujoConfig', schema);

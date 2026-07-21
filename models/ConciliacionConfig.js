const mongoose = require('mongoose');

const conciliacionConfigSchema = new mongoose.Schema({
  sociedad:      { type: String, required: true, unique: true },
  rutaEECC:      { type: String, default: '' }, // Q EECC BANCOS.xlsx — hojas por banco+moneda
  rutaCobranza:  { type: String, default: '' }, // Q COBRANZA.xlsx — hojas COBRANZA ERP + CAJA
  rutaTC:        { type: String, default: '' }, // Q TC.xlsx — reporte operadores de TC
});

module.exports = mongoose.model('ConciliacionConfig', conciliacionConfigSchema);

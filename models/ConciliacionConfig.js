const mongoose = require('mongoose');

const conciliacionConfigSchema = new mongoose.Schema({
  sociedad:      { type: String, required: true, unique: true },
  rutaEECC:      { type: [String], default: [] }, // Q EECC BANCOS.xlsx — hojas por banco+moneda (uno o varios archivos)
  rutaCobranza:  { type: [String], default: [] }, // Q COBRANZA.xlsx — hojas COBRANZA ERP + CAJA (uno o varios archivos)
  rutaTC:        { type: [String], default: [] }, // Q TC.xlsx — reporte operadores de TC (uno o varios archivos)
});

module.exports = mongoose.model('ConciliacionConfig', conciliacionConfigSchema);

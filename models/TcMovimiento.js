const mongoose = require('mongoose');

const tcMovimientoSchema = new mongoose.Schema({
  sociedad:         { type: String, required: true, index: true },
  establecimiento:  { type: String, default: '' },
  tarjeta:          { type: String, default: '' },   // ej. "0484-3527"
  tarjetaUlt4:       { type: String, default: '', index: true }, // ultimos 4 digitos, para conciliar
  fechaVenta:       { type: Date, required: true },
  venta:            { type: Number, default: 0 },
  estado:           { type: String, default: '' },   // SEA, ABONADO, PROCESADO
  comisionMerchant: { type: Number, default: 0 },
  comisionEmisor:   { type: Number, default: 0 },
  igvComision:      { type: Number, default: 0 },
  deposito:         { type: Number, default: 0 },
  fechaDeposito:    { type: Date, default: null },
  comisionTotal:    { type: Number, default: 0 },
  tc:               { type: String, default: '' },   // operador: NIUBIZ, AMEX, etc.
  autorizacion:     { type: String, default: '' },
  moneda:           { type: String, default: '' },
});

tcMovimientoSchema.index({ sociedad: 1, tarjetaUlt4: 1, fechaVenta: 1 });

module.exports = mongoose.model('TcMovimiento', tcMovimientoSchema);

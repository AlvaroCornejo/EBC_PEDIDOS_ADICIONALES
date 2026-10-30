const mongoose = require('mongoose');

// Depósito al banco — el paso final de la cadena de custodia, por selección manual
// de qué cubre (nunca una fracción de un turno/envío, siempre el registro completo):
//   - origen CAJA (operaciones sin oficina): cubre uno o más TurnoCaja directamente.
//     El monto de cada uno es su ingreso neto de esa moneda (VENTA+TIP−VUELTO, sin
//     contar el fondo fijo) — es el egreso de custodia de la Tienda, equivalente a
//     un envío a Oficina en las operaciones que sí la tienen.
//   - origen OFICINA: cubre uno o más EnvioEfectivo ya CONFIRMADOs. El monto de
//     cada uno es su `montoConfirmado`.
// `diferencia` es el cuadre que consultan Contabilidad y Gerencia: el depósito real
// vs. la suma de lo que dice cubrir.
const depositoBancoSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  origen:    { type: String, enum: ['CAJA', 'OFICINA'], required: true },
  moneda:    { type: String, enum: ['PEN', 'USD'], required: true },

  montoDepositado: { type: Number, required: true },
  fechaDeposito:    { type: Date, required: true },

  // tipo TURNO -> id de TurnoCaja (origen CAJA); tipo ENVIO -> id de EnvioEfectivo (origen OFICINA)
  cubre: [{
    tipo:  { type: String, enum: ['TURNO', 'ENVIO'], required: true },
    id:    { type: mongoose.Schema.Types.ObjectId, required: true },
    fecha: { type: Date, required: true },
    monto: { type: Number, required: true },
  }],
  totalCubierto: { type: Number, required: true },
  diferencia:    { type: Number, required: true },
  // Desglose venta/TIP del total cubierto (sin detalle de billetaje — a diferencia
  // del envío a Oficina, el depósito no necesita conteo físico, ya se contó al
  // enviar/cerrar). Se calcula en el servidor a partir de lo que cubre cada ítem
  // (EnvioEfectivo.montoVenta/montoTip si es ENVIO, o los movimientos del turno si
  // es TURNO) — nunca se recibe del cliente.
  montoVenta: { type: Number, default: 0 },
  montoTip:   { type: Number, default: 0 },

  registradoPor: { type: String, default: '' },
  fechaRegistro: { type: Date, default: Date.now },
  comentario:    { type: String, default: '' },
});
depositoBancoSchema.index({ operacion: 1, moneda: 1, fechaDeposito: -1 });

module.exports = mongoose.model('DepositoBanco', depositoBancoSchema);

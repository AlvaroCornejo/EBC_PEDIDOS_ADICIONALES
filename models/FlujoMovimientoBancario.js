const mongoose = require('mongoose');

// Movimiento de un estado de cuenta bancario (snapshot, reemplazo completo
// por sociedad+banco+moneda en cada import).
const schema = new mongoose.Schema({
  sociedad:        { type: String, required: true },
  banco:           { type: String, required: true, enum: ['BBVA', 'BCP', 'BN', 'IBK'] },
  moneda:          { type: String, required: true, enum: ['PEN', 'USD'] },
  fecha:           { type: Date, required: true },
  fechaValor:      { type: Date, default: null },
  numeroOperacion: { type: String, default: null }, // null si el banco no lo trae (ej. BN)
  glosa:           { type: String, default: '' },
  importe:         { type: Number, required: true }, // con signo

  // Nivel más granular de asignación — LINEA y DETALLE se derivan de aquí
  // (FlujoSubdetalle.detalleCodigo -> FlujoDetalle.lineaCodigo), no se
  // guardan por separado para no desincronizar si cambia el catálogo.
  // Un movimiento se asigna de una de dos formas, mutuamente excluyentes:
  // - subdetalleCodigo: asignación simple (todo el importe a un solo subdetalle).
  // - splits: desglose manual en 2+ subdetalles (la suma debe igualar `importe`);
  //   cuando hay splits, subdetalleCodigo queda en null.
  subdetalleCodigo: { type: String, default: null },
  splits: [{
    subdetalleCodigo: { type: String, required: true },
    monto:            { type: Number, required: true },
    proveedor:        { type: String, default: '' }, // beneficiario(s) que componen esta línea del desglose, informativo
  }],
  metodoAsignacion: { type: String, default: null, enum: [null, 'glosa', 'erp', 'manual'] },
  proveedor:        { type: String, default: '' }, // beneficiario (PAGARA) resuelto por el método 2 (cruce ERP)
  comentario:       { type: String, default: '' }, // nota libre, típicamente al asignar a POR ASIGNAR (60110) para explicar el pendiente
  asignadoPor:      { type: String, default: '' },
  asignadoEn:       { type: Date, default: null },
});
schema.index({ sociedad: 1, banco: 1, moneda: 1, fecha: 1 });
schema.index({ sociedad: 1, subdetalleCodigo: 1 });
schema.index({ sociedad: 1, numeroOperacion: 1 });

module.exports = mongoose.model('FlujoMovimientoBancario', schema);

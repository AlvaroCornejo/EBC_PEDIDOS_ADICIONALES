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
  subdetalleCodigo: { type: String, default: null },
  metodoAsignacion: { type: String, default: null, enum: [null, 'glosa', 'erp', 'manual'] },
  asignadoPor:      { type: String, default: '' },
  asignadoEn:       { type: Date, default: null },
});
schema.index({ sociedad: 1, banco: 1, moneda: 1, fecha: 1 });
schema.index({ sociedad: 1, subdetalleCodigo: 1 });
schema.index({ sociedad: 1, numeroOperacion: 1 });

module.exports = mongoose.model('FlujoMovimientoBancario', schema);

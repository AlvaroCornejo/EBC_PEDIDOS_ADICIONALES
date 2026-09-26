const mongoose = require('mongoose');

// Avisos ya enviados por Indicadores GAF, para no repetirlos: la tarea diaria recorre las
// mismas capturas pendientes cada mañana y solo avisa lo que no avisó antes.
//   tipo:  RECORDATORIO (al responsable, antes del vencimiento) | VENCIDO (a los de alertas)
//          | ROJO (a los de alertas, al registrar o corregir en rojo)
//   clave: kpiId|unidad|periodo
const kpiNotificacionSchema = new mongoose.Schema({
  tipo:           { type: String, required: true, enum: ['RECORDATORIO', 'VENCIDO', 'ROJO'] },
  clave:          { type: String, required: true },
  destinatarioId: { type: String, required: true },
  enviadoEn:      { type: Date, default: Date.now },
});
kpiNotificacionSchema.index({ tipo: 1, clave: 1, destinatarioId: 1 }, { unique: true });

module.exports = mongoose.model('KpiNotificacion', kpiNotificacionSchema);

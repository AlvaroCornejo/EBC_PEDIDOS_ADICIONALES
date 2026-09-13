const mongoose = require('mongoose');

// Instancia mensual operativa de una Actividad, generada al crear un CierreMensual
// (routes/cierreContable.js). "VENCIDA"/"CUMPLIDA_A_TIEMPO"/"CUMPLIDA_TARDE" no se
// guardan aquí — se derivan al vuelo comparando fechaLimite/horaLimite y
// fechaHoraCumplimiento contra la hora actual (ver utils/fechaLima.js:estadoDerivado).
const actividadCierreSchema = new mongoose.Schema({
  id:               { type: String, required: true, unique: true },
  cierreId:         { type: String, required: true, index: true },
  actividadOrigenId: { type: String, required: true, index: true },

  nombre:          { type: String, required: true },
  procesoCodigo:   { type: String, required: true },
  nivelAsignacion: { type: String, required: true, enum: ['SOCIEDAD', 'OPERACION', 'TODAS'] },
  sociedadCodigos: { type: [String], default: [] },
  operacionCodigo: { type: String, default: '' },

  fechaLimite: { type: String, required: true }, // 'YYYY-MM-DD'
  horaLimite:  { type: String, required: true }, // 'HH:mm'
  requiereAdjunto: { type: Boolean, default: false },

  estado: { type: String, default: 'PENDIENTE', enum: ['PENDIENTE', 'CUMPLIDA', 'REABIERTA'] },
  fechaHoraCumplimiento: { type: String, default: null }, // ISO, hora de servidor
  cumplidoPorId:     { type: String, default: null },
  cumplidoPorNombre: { type: String, default: null },

  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});

module.exports = mongoose.model('ActividadCierre', actividadCierreSchema);

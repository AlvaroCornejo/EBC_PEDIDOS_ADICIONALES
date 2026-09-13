const mongoose = require('mongoose');

// Asigna un usuario como responsable de una Actividad (plantilla del mes vigente,
// no de una instancia ActividadCierre puntual) dentro de un alcance. Un usuario puede
// tener varias filas (distintas actividades y/o alcances). La resolución de "quién es
// responsable" de una ActividadCierre se hace en vivo contra actividadOrigenId, no se
// congela por mes.
const asignacionResponsableSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  usuarioId:   { type: String, required: true, index: true },
  actividadId: { type: String, required: true, index: true },
  scope:           { type: String, required: true, enum: ['TODAS', 'SOCIEDAD', 'OPERACION'] },
  sociedadCodigo:  { type: String, default: '' },
  operacionCodigo: { type: String, default: '' },
});

module.exports = mongoose.model('AsignacionResponsable', asignacionResponsableSchema);

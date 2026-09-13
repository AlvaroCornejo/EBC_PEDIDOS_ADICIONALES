const mongoose = require('mongoose');

// Da a un usuario acceso de solo lectura al tablero de Cierre Contable dentro de un
// alcance (todas las sociedades/operaciones, una Sociedad, o una Operación) — nunca
// puede marcar actividades como cumplidas ni subir adjuntos.
const asignacionConsultaSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  usuarioId: { type: String, required: true, index: true },
  scope:           { type: String, required: true, enum: ['TODAS', 'SOCIEDAD', 'OPERACION'] },
  sociedadCodigo:  { type: String, default: '' },
  operacionCodigo: { type: String, default: '' },
});

module.exports = mongoose.model('AsignacionConsulta', asignacionConsultaSchema);

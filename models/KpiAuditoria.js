const mongoose = require('mongoose');

// Bitácora de auditoría de Indicadores GAF: creación de cada registro y cada corrección
// del admin (valor anterior, valor nuevo, usuario, fecha y hora, motivo). NUNCA se edita
// ni se borra — bloqueado a nivel de modelo.
const kpiAuditoriaSchema = new mongoose.Schema({
  registroId:    { type: mongoose.Schema.Types.ObjectId, ref: 'KpiRegistro', required: true, index: true },
  kpiId:         { type: mongoose.Schema.Types.ObjectId, required: true },
  areaCodigo:    { type: String, required: true },     // para filtrar por áreas visibles
  accion:        { type: String, required: true, enum: ['CREACION', 'CORRECCION', 'ADJUNTO'] },
  antes:         { type: mongoose.Schema.Types.Mixed, default: null },
  despues:       { type: mongoose.Schema.Types.Mixed, default: null },
  motivo:        { type: String, default: '' },
  usuarioId:     { type: String, required: true },
  usuarioNombre: { type: String, required: true },
  fechaHora:     { type: Date, default: Date.now },
});

const bloquear = () => { throw new Error('La bitácora de auditoría no se modifica ni se borra'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  kpiAuditoriaSchema.pre(op, { document: true, query: true }, bloquear);
}
kpiAuditoriaSchema.pre('save', function () { if (!this.isNew) bloquear(); });

module.exports = mongoose.model('KpiAuditoria', kpiAuditoriaSchema);

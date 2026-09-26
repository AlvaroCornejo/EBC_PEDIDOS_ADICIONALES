const mongoose = require('mongoose');

// Valor registrado de un KPI para un periodo y una unidad. INMUTABLE una vez guardado:
// el único cambio posible es la corrección del admin (routes/kpiRegistros.js →
// PUT /registros/:id/corregir), que marca el documento con $locals.correccionAutorizada
// y deja rastro en KpiAuditoria. Nunca se borra.
//
// Guarda copia de todo lo que define su evaluación (unidad, sentido, tipo de captura y la
// meta vigente en su periodo) para que el historial no cambie si luego cambia el catálogo.
const adjuntoSchema = new mongoose.Schema({
  boxFileId:      { type: String, required: true },
  nombre:         { type: String, required: true },   // nombre en Box (con timestamp)
  nombreOriginal: { type: String, required: true },
  tamano:         { type: Number, default: 0 },
  tipo:           { type: String, default: '' },
  subidoPor:      { type: String, default: '' },      // username
  subidoEn:       { type: Date, default: Date.now },
}, { _id: false });

const kpiRegistroSchema = new mongoose.Schema({
  kpiId:        { type: mongoose.Schema.Types.ObjectId, ref: 'KpiDefinicion', required: true },
  kpiCodigo:    { type: String, required: true },
  areaCodigo:   { type: String, required: true, index: true },
  unidadCodigo: { type: String, required: true },
  periodo:      { type: String, required: true },     // 'YYYY-MM' | 'YYYY-Www'
  // 'YYYY-MM-DD' del primer día del periodo: permite filtrar/ordenar semanales y mensuales
  // juntos (como texto, '2026-W39' y '2026-09' no se comparan bien).
  periodoInicio: { type: String, required: true, index: true },
  frecuencia:   { type: String, required: true },
  tipoCaptura:  { type: String, required: true },
  unidad:       { type: String, required: true },
  sentido:      { type: String, required: true },
  valor:        { type: Number, required: true },     // resultado (en RATIO: calculado)
  numerador:    { type: Number, default: null },
  denominador:  { type: Number, default: null },
  meta:         { type: mongoose.Schema.Types.Mixed, default: null }, // snapshot de KpiMetaVersion (null = informativo)
  semaforo:     { type: String, enum: ['VERDE', 'AMBAR', 'ROJO', null], default: null },
  comentario:   { type: String, default: '' },
  adjuntos:     { type: [adjuntoSchema], default: [] },
  registradoPor:       { type: String, required: true }, // User.id
  registradoPorNombre: { type: String, required: true }, // username en ese momento
  registradoEn:        { type: Date, default: Date.now },
  corregido:     { type: Boolean, default: false },
  nCorrecciones: { type: Number, default: 0 },
}, { optimisticConcurrency: true }); // dos correcciones simultáneas: la segunda falla en vez de pisar

kpiRegistroSchema.index({ kpiId: 1, periodo: 1, unidadCodigo: 1 }, { unique: true });

const bloquear = () => {
  throw new Error('Los registros de KPI no se modifican ni se borran (solo el admin puede corregirlos)');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  kpiRegistroSchema.pre(op, { document: true, query: true }, bloquear);
}
kpiRegistroSchema.pre('save', function () {
  if (!this.isNew && !this.$locals.correccionAutorizada) bloquear();
});

module.exports = mongoose.model('KpiRegistro', kpiRegistroSchema);

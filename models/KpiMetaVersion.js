const mongoose = require('mongoose');

// Versiones de meta/umbrales de un KPI. SOLO SE AGREGAN: cambiar una meta = crear una
// versión nueva con su fecha de vigencia. Cada registro guarda además una copia de la
// versión que usó, así el historial nunca se recalcula.
//
// Resolución (utils/kpiMetas.js): para una unidad y un periodo manda la versión con
// `vigenteDesde` más reciente que no sea posterior al inicio del periodo; una versión
// específica de la unidad (`unidadCodigo`) tiene prioridad sobre la general ('').
const kpiMetaVersionSchema = new mongoose.Schema({
  kpiId:        { type: mongoose.Schema.Types.ObjectId, ref: 'KpiDefinicion', required: true, index: true },
  unidadCodigo: { type: String, default: '' },           // '' = todas las unidades del KPI
  vigenteDesde: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // 'YYYY-MM-DD'
  meta:         { type: Number, default: null },         // MAYOR / MENOR
  umbralAmbar:  { type: Number, default: null },         // MAYOR / MENOR
  rangoMin:     { type: Number, default: null },         // RANGO
  rangoMax:     { type: Number, default: null },         // RANGO
  tolerancia:   { type: Number, default: null },         // RANGO: margen ámbar fuera del rango
  motivo:       { type: String, default: '' },
  creadoPor:    { type: String, default: '' },
  creadoEn:     { type: Date, default: Date.now },
});

// Inmutable a nivel de modelo: cualquier intento de editar o borrar falla, venga de una
// ruta, de un script o de un error de programación.
// (Mongoose 9: las hooks `pre` ya no reciben `next`; se bloquea lanzando el error.)
const bloquear = function () {
  throw new Error('Las versiones de meta no se modifican ni se borran: cree una versión nueva');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  kpiMetaVersionSchema.pre(op, { document: true, query: true }, bloquear);
}
kpiMetaVersionSchema.pre('save', function () {
  if (!this.isNew) bloquear();
});

module.exports = mongoose.model('KpiMetaVersion', kpiMetaVersionSchema);

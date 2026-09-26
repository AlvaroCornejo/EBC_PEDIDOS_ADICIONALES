const mongoose = require('mongoose');

// Catálogo de KPIs de Indicadores GAF. Nada de esto va en código: lo administra el
// admin de Indicadores. Nunca se borra un KPI (solo `activo:false`); las metas y
// umbrales NO viven aquí sino en KpiMetaVersion (versionadas por fecha de vigencia).
const UNIDADES     = ['%', 'S/', 'US$', 'dias', 'horas', 'numero', 'pp'];
const FRECUENCIAS  = ['SEMANAL', 'MENSUAL'];
const TIPOS_CAPTURA = ['DIRECTO', 'RATIO']; // RATIO: numerador/denominador (× 100 si la unidad es %)
const SENTIDOS     = ['MAYOR', 'MENOR', 'RANGO'];
const NIVELES_AMBITO = ['SOCIEDAD', 'OPERACION'];

const kpiDefinicionSchema = new mongoose.Schema({
  codigo:      { type: String, required: true, unique: true, trim: true, uppercase: true },
  nombre:      { type: String, required: true, trim: true },
  areaCodigo:  { type: String, required: true, index: true },
  descripcion: { type: String, default: '' },
  formula:     { type: String, default: '' }, // texto explicativo, no se evalúa
  unidad:      { type: String, required: true, enum: UNIDADES },
  frecuencia:  { type: String, required: true, enum: FRECUENCIAS },
  tipoCaptura: { type: String, required: true, enum: TIPOS_CAPTURA, default: 'DIRECTO' },
  sentido:     { type: String, required: true, enum: SENTIDOS },
  // Ámbito: a qué unidades aplica el KPI (no todas las operaciones tienen todos los KPIs).
  // Códigos del catálogo Sociedad u Operacion según `nivelAmbito`.
  nivelAmbito: { type: String, required: true, enum: NIVELES_AMBITO, default: 'SOCIEDAD' },
  unidades:    { type: [String], default: [] },
  responsables: { type: [String], default: [] }, // User.id de quienes deben capturarlo
  fuente:      { type: String, default: '' },    // SPRING, BBVA, tickets TI, manual…
  plazoCapturaDias: { type: Number, default: 8, min: 0 }, // días después del cierre del periodo
  activo:      { type: Boolean, default: true },
  creadoPor:   { type: String, default: '' },
  creadoEn:    { type: Date, default: Date.now },
});

kpiDefinicionSchema.statics.UNIDADES = UNIDADES;
kpiDefinicionSchema.statics.FRECUENCIAS = FRECUENCIAS;
kpiDefinicionSchema.statics.TIPOS_CAPTURA = TIPOS_CAPTURA;
kpiDefinicionSchema.statics.SENTIDOS = SENTIDOS;
kpiDefinicionSchema.statics.NIVELES_AMBITO = NIVELES_AMBITO;

module.exports = mongoose.model('KpiDefinicion', kpiDefinicionSchema);

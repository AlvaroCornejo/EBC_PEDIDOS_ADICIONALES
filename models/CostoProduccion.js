const mongoose = require('mongoose');

// Costo de producción de planta: una fila por ítem × mes con producción, desde
// EBC COSTO DE PRODUCCION.xlsx (hoja "Datos", operación PLANTA). Cada import reemplaza
// operación + año completos (el Excel trae todos los meses del año juntos, ver
// scripts/importCostoProduccion.js). La desviación no se guarda: se calcula
// como (costoReceta - costoReal) / costoReceta.
const costoProduccionSchema = new mongoose.Schema({
  operacion:   { type: String, required: true },   // código del catálogo Operacion (PLANTA)
  anio:        { type: Number, required: true },
  mes:         { type: Number, required: true, min: 1, max: 12 },
  area:        { type: String, required: true },   // PANADERIA / PREP / REPOSTERIA ...
  item:        { type: String, required: true },
  nombre:      { type: String, default: '' },
  unidad:      { type: String, default: '' },
  costoReceta: { type: Number, default: null },    // null = el Excel no trae costo receta
  cantidad:    { type: Number, default: 0 },
  costoReal:   { type: Number, default: 0 },       // costo unitario real del mes
  cargadoEn:   { type: Date, default: Date.now },
});
costoProduccionSchema.index({ operacion: 1, anio: 1, area: 1 });

module.exports = mongoose.model('CostoProduccion', costoProduccionSchema);

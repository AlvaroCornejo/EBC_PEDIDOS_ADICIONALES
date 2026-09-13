const mongoose = require('mongoose');

// Un Cierre Mensual "congela" las Actividades vigentes de un periodo en instancias
// ActividadCierre, generado manualmente por un ADMIN (routes/cierreContable.js,
// POST /cierres/generar). Único por periodo — no se puede regenerar un mes ya generado.
const cierreMensualSchema = new mongoose.Schema({
  id:                { type: String, required: true, unique: true },
  periodo:           { type: String, required: true, unique: true }, // 'YYYY-MM'
  fechaGeneracion:   { type: String, required: true }, // ISO
  generadoPorId:     { type: String, required: true },
  generadoPorNombre: { type: String, required: true },
});

module.exports = mongoose.model('CierreMensual', cierreMensualSchema);

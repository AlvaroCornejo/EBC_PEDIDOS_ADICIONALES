const mongoose = require('mongoose');

// Catálogo de procesos (RRHH, VENTAS, LOGÍSTICA, etc.), administrable desde
// Admin → Cierre Contable. Usado para clasificar las Actividades del cierre mensual.
const procesoSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, trim: true },
  nombre: { type: String, required: true, trim: true },
});

module.exports = mongoose.model('Proceso', procesoSchema);

const mongoose = require('mongoose');

// Catálogo de sociedades (razones sociales), administrable desde Admin → Sociedades y
// Operaciones. Reemplaza la lista fija ALL_SOCS_COMPRA que existía en public/app.js.
const sociedadSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, trim: true },
  nombre: { type: String, required: true, trim: true },
});

module.exports = mongoose.model('Sociedad', sociedadSchema);

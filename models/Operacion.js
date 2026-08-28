const mongoose = require('mongoose');

// Catálogo de operaciones (tiendas/plantas/corporativos), administrable desde
// Admin → Sociedades y Operaciones. Reemplaza la lista fija ALL_OPS que existía en
// public/app.js. Cada operación pertenece a una sociedad (por código, no ObjectId,
// porque el resto de la app ya usa el código como identificador natural en decenas
// de colecciones — Pedido.operacion, EstadoCuenta.compania, User.operations, etc.).
const operacionSchema = new mongoose.Schema({
  codigo:         { type: String, required: true, unique: true, trim: true },
  nombre:         { type: String, required: true, trim: true },
  sociedadCodigo: { type: String, required: true, index: true, trim: true },
  // % (como fracción, ej. 0.18 = 18%) usados en Pronóstico de Venta para
  // calcular Venta Neta Propuesta = Venta Bruta / (1 + igvPct + rcPct).
  igvPct: { type: Number, default: 0 },
  rcPct:  { type: Number, default: 0 },
});

module.exports = mongoose.model('Operacion', operacionSchema);

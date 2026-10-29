const mongoose = require('mongoose');

// Config por operación del módulo Cierre de Caja: si la operación tiene una
// Oficina central (Tienda → Oficina → Banco) o deposita directo (Tienda → Banco),
// los turnos disponibles en Tienda (1 o 2 al día), y el fondo fijo de referencia
// (monto que siempre debe quedar en caja, no se deposita) de cada "caja" —
// Tienda y Oficina llevan su propio fondo fijo, en soles y dólares.
const cajaEfectivoConfigSchema = new mongoose.Schema({
  operacion:    { type: String, required: true, unique: true, trim: true },
  tieneOficina: { type: Boolean, default: false },
  turnos:       { type: [String], default: [] },
  fondoFijoCaja:    { pen: { type: Number, default: 0 }, usd: { type: Number, default: 0 } },
  fondoFijoOficina: { pen: { type: Number, default: 0 }, usd: { type: Number, default: 0 } },
});

module.exports = mongoose.model('CajaEfectivoConfig', cajaEfectivoConfigSchema);

const mongoose = require('mongoose');

// Config por operación del módulo Cierre de Caja: si la operación tiene una
// Oficina intermedia en la cadena de custodia del efectivo (Caja → Oficina →
// Banco) o el efectivo va directo de Caja al Banco, y los turnos disponibles
// para abrir Caja (ej. "Mañana,Tarde,Noche").
const cajaEfectivoConfigSchema = new mongoose.Schema({
  operacion:    { type: String, required: true, unique: true, trim: true },
  tieneOficina: { type: Boolean, default: false },
  turnos:       { type: [String], default: [] },
});

module.exports = mongoose.model('CajaEfectivoConfig', cajaEfectivoConfigSchema);

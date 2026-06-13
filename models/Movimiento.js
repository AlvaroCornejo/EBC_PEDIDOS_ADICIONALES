const mongoose = require('mongoose');

const movimientoSchema = new mongoose.Schema({
  id:               { type: String, required: true, unique: true },
  flujo:            { type: String, required: true, enum: ['BAJA', 'CONSUMO', 'TRANSFERENCIA', '86'] },
  operacion:        { type: String, required: true },
  operacionDestino: { type: String, default: '' },
  fecha:            { type: Date, required: true },
  item:             { type: Number, required: true },
  itemNombre:       { type: String, default: '' },
  tipo:             { type: String, default: '' },
  cantidad:         { type: Number, default: 0 },
  comentarios:      { type: String, default: '' },
  estado:           { type: String, enum: ['REGISTRADO', 'PROCESADO'], default: 'REGISTRADO' },
  creadoPorId:       String,
  creadoPorNombre:   String,
  procesadoPorId:    { type: String, default: '' },
  procesadoPorNombre: { type: String, default: '' },
  procesadoEn:       { type: Date, default: null },
  createdAt:         { type: Date, default: Date.now },
  updatedAt:         { type: Date, default: Date.now },
});

movimientoSchema.index({ flujo: 1, operacion: 1, fecha: -1 });

module.exports = mongoose.model('Movimiento', movimientoSchema);

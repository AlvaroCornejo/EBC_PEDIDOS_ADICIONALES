const mongoose = require('mongoose');

const lineaSchema = new mongoose.Schema({
  id: String,
  item: String,
  itemNombre: String,
  grupoCompra: String,
  cantidadSolicitada: Number,
  comentarios: { type: String, default: '' },
  semanaAnterior: mongoose.Schema.Types.Mixed,
  semanaActual: mongoose.Schema.Types.Mixed,
  saldo: Number,
  costoUnitario: Number,
  gestion: { type: String, default: 'COMPRAS' },
  estadoLinea: { type: String, default: 'PENDIENTE' },
  comentarioAprobador: { type: String, default: '' },
  estadoAtencion: { type: String, default: 'PENDIENTE' }
}, { _id: false });

const pedidoSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  operacion: { type: String, required: true },
  fechaPedido: String,
  estado: { type: String, default: 'SOLICITADO' },
  solicitadoPorId: String,
  solicitadoPorNombre: String,
  aprobadoPorId: { type: String, default: null },
  aprobadoPorNombre: { type: String, default: null },
  atendidoPorId: { type: String, default: null },
  atendidoPorNombre: { type: String, default: null },
  createdAt: String,
  updatedAt: String,
  lineas: [lineaSchema]
});

module.exports = mongoose.model('Pedido', pedidoSchema);

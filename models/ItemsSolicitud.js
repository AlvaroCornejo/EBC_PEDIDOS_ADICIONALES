const mongoose = require('mongoose');

// Ítem individual dentro de una solicitud
const itemSchema = new mongoose.Schema({
  // Datos del solicitante
  nombre:      { type: String, required: true },
  tipoItem:    String,
  linea:       Number,
  familia:     Number,
  subFamilia:  Number,
  unidad:      String,
  observacion: String,
  itemOrigen:  Number,   // null o id del ítem maestro copiado

  // Datos corregidos/completados por el validador
  nombreVal:    String,
  tipoItemVal:  String,
  lineaVal:     Number,
  familiaVal:   Number,
  subFamiliaVal:Number,
  unidadVal:    String,
  grupoCompra:  Number,  // solo el validador lo asigna
  comentarioItem: String,

  // Registro ERP
  codigoErp:   String,
  registradoEn:Date,
});

const schema = new mongoose.Schema({
  estado: {
    type: String, default: 'borrador',
    enum: ['borrador','pendiente','aprobado','rechazado','completado'],
  },
  observacion:         String,
  creadoPor:           { type: String, required: true },
  creadoEn:            { type: Date, default: Date.now },
  enviadoEn:           Date,
  validadoPor:         String,
  validadoEn:          Date,
  comentarioValidador: String,
  items:               [itemSchema],
});

schema.index({ creadoPor: 1, estado: 1 });
schema.index({ estado: 1 });

module.exports = mongoose.model('ItemsSolicitud', schema);

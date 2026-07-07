const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  compania:          String,  // mapped from CompaniaCodigo
  companiaCodigo:    String,  // raw code from CSV
  proveedor:         String,  // Busqueda field (supplier name)
  proveedorKey:      String,  // trim().toUpperCase() for matching
  numeroDocumento:   String,
  tipoDocumento:     String,
  fechaVencimiento:  Date,
  fechaDocumento:    Date,
  moneda:            String,  // LO / EX
  monto:             Number,  // MontoObligacion
  estadoDoc:         String,  // AP / PP
  responsable:       String,  // NombreCompleto
  // Selection state
  seleccionadoPor:   String,
  seleccionadoEn:    Date,
  comentario:        { type: String, default: '' },
  programacionId:    String,
  pendienteNextProg: { type: Boolean, default: false },
  cargadoEn:         { type: Date, default: Date.now },
});
schema.index({ compania: 1, proveedorKey: 1 });
schema.index({ compania: 1, estadoDoc: 1 });
module.exports = mongoose.model('ObligacionEBC', schema);

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  compania:       { type: String, required: true },
  numeroAdelanto: String,
  proveedor:      String,   // valor crudo de "Busqueda" (col 9)
  proveedorKey:   String,   // trim().toUpperCase(), para matching con pagarA
  persona:        String,   // col "Persona" (código)
  responsable:    String,   // segunda "Busqueda" (col 13)
  montoTotal:     Number,
  saldoAdelanto:  Number,
  moneda:         String,   // LO / EX
  tipoAdelanto:   String,
  estado:         String,   // PA / TR / etc.
  fechaDocumento: Date,
  centroCostos:   String,
  creadoEn:       { type: Date, default: Date.now },
});

schema.index({ compania: 1, proveedorKey: 1 });

module.exports = mongoose.model('PagoAdelanto', schema);

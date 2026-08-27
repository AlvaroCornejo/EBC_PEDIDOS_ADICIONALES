const mongoose = require('mongoose');

// Tabla GRUPO_COMPRA_ESPECIAL (hoja TABLAS de EBC BASE SEGUIMIENTO DE COMPRAS.xlsx) —
// combinaciones operación+grupo de compra que el usuario puede excluir/incluir a
// voluntad en la consulta de Eficiencia de Consumo y Compra.
const schema = new mongoose.Schema({
  operacion:   { type: String, required: true },
  grupoCompra: { type: String, required: true },
});
schema.index({ operacion: 1, grupoCompra: 1 }, { unique: true });

module.exports = mongoose.model('GrupoCompraEspecial', schema);

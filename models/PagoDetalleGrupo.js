const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  nombre:          { type: String, required: true },
  grupoProveedor:  { type: String, required: true },
  activo:          { type: Boolean, default: true },
});
schema.index({ nombre: 1, grupoProveedor: 1 }, { unique: true });
module.exports = mongoose.model('PagoDetalleGrupo', schema);

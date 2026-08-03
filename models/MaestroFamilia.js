const mongoose = require('mongoose');

const maestroFamiliaSchema = new mongoose.Schema({
  linea:   { type: String, required: true, trim: true },
  familia: { type: String, required: true, trim: true },
  nombre:  { type: String, required: true, trim: true },
});
maestroFamiliaSchema.index({ linea: 1, familia: 1 }, { unique: true });

module.exports = mongoose.model('MaestroFamilia', maestroFamiliaSchema);

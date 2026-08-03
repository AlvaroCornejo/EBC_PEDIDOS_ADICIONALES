const mongoose = require('mongoose');

const maestroSubFamiliaSchema = new mongoose.Schema({
  linea:      { type: String, required: true, trim: true },
  familia:    { type: String, required: true, trim: true },
  subFamilia: { type: String, required: true, trim: true },
  nombre:     { type: String, required: true, trim: true },
});
maestroSubFamiliaSchema.index({ linea: 1, familia: 1, subFamilia: 1 }, { unique: true });

module.exports = mongoose.model('MaestroSubFamilia', maestroSubFamiliaSchema);

const mongoose = require('mongoose');

const maestroItemSociedadSchema = new mongoose.Schema({
  item:           { type: Number, required: true },
  sociedadCodigo: { type: String, required: true, trim: true },
});
maestroItemSociedadSchema.index({ item: 1, sociedadCodigo: 1 }, { unique: true });

module.exports = mongoose.model('MaestroItemSociedad', maestroItemSociedadSchema);

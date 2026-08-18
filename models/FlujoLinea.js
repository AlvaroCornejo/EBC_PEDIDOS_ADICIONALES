const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
});

module.exports = mongoose.model('FlujoLinea', schema);

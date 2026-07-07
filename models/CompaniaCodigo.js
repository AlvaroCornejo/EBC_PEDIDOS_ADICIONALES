const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  codigo:   { type: String, required: true, unique: true }, // e.g. "000001"
  compania: { type: String, required: true },               // e.g. "ERSAC"
});
module.exports = mongoose.model('CompaniaCodigo', schema);

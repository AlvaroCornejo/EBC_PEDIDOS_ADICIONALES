const mongoose = require('mongoose');
const comentarioSchema = new mongoose.Schema({
  pedidoId:  { type: String, required: true, index: true },
  fase:      { type: String, default: '' },
  userId:    String,
  username:  String,
  role:      String,
  texto:     { type: String, required: true },
  parentId:  { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Comentario', comentarioSchema);

const mongoose = require('mongoose');

// Historial de archivos subidos a Box para una ActividadCierre. Nunca se eliminan: si
// el ADMIN reabre la actividad y se sube un nuevo archivo, el anterior permanece.
const adjuntoSchema = new mongoose.Schema({
  id:                { type: String, required: true, unique: true },
  actividadCierreId: { type: String, required: true, index: true },
  boxFileId:   { type: String, required: true },
  boxFileName: { type: String, required: true },
  rutaBox:     { type: String, required: true },
  uploadedAt:  { type: String, required: true }, // ISO
  uploadedById:     { type: String, required: true },
  uploadedByNombre: { type: String, required: true },
});

module.exports = mongoose.model('Adjunto', adjuntoSchema);

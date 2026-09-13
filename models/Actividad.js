const mongoose = require('mongoose');

// Plantilla de actividad del cierre contable del mes vigente, administrable desde
// Admin → Cierre Contable. Al generar un nuevo mes (routes/cierreContable.js), cada
// Actividad activa se copia a una instancia ActividadCierre con su fecha ya resuelta.
const actividadSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  nombre:      { type: String, required: true, trim: true },
  descripcion: { type: String, default: '' },
  procesoCodigo: { type: String, required: true },

  nivelAsignacion: { type: String, required: true, enum: ['SOCIEDAD', 'OPERACION'] },
  sociedadCodigo:  { type: String, default: '' },  // requerido si nivelAsignacion=SOCIEDAD
  operacionCodigo: { type: String, default: '' },  // requerido si nivelAsignacion=OPERACION

  reglaVencimiento: {
    tipo:      { type: String, required: true, enum: ['FECHA_FIJA', 'DIA_HABIL'] },
    fecha:     { type: String, default: '' },  // 'YYYY-MM-DD', si tipo=FECHA_FIJA
    diaHabil:  { type: Number, default: null }, // si tipo=DIA_HABIL
  },
  horaLimite: { type: String, default: '18:00' }, // 'HH:mm'

  requiereAdjunto: { type: Boolean, default: false },
  activa:          { type: Boolean, default: true }, // soft-delete para el mes en curso
});

module.exports = mongoose.model('Actividad', actividadSchema);

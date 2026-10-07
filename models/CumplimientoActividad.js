const mongoose = require('mongoose');

const cumplimientoActividadSchema = new mongoose.Schema({
  areaId: { type: String, required: true }, // ref CumplimientoArea
  semana: { type: String, required: true }, // 'YYYYWW' ISO
  nombre: { type: String, required: true },
  descripcion: { type: String, default: '' },
  diaSemana: { type: Number, required: true, min: 1, max: 7 }, // 1=lunes ... 7=domingo
  fecha: { type: Date, required: true },
  estado: { type: String, default: 'ABIERTA', enum: ['ABIERTA', 'CERRADA'] },
  cumplimiento: { type: String, default: '', enum: ['', 'CUMPLIDA', 'NO_CUMPLIDA'] },
  comentarioCierre: { type: String, default: '' },
  cerradoPor: { type: String, default: '' },
  cerradoEn: { type: Date, default: null },
  comentarioAdmin: { type: String, default: '' },
  revisadoPor: { type: String, default: '' },
  revisadoEn: { type: Date, default: null },
});

cumplimientoActividadSchema.index({ areaId: 1, semana: 1 });

module.exports = mongoose.model('CumplimientoActividad', cumplimientoActividadSchema);

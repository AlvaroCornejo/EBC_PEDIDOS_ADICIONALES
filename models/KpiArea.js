const mongoose = require('mongoose');

// Áreas del back office medidas en Indicadores GAF (Compras, Tesorería, ...).
// Catálogo editable por ADMIN; el código es el identificador natural que usan
// User.kpiAreas y, más adelante, los KPIs y sus registros.
const kpiAreaSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true, trim: true, uppercase: true },
  nombre: { type: String, required: true, trim: true },
  orden:  { type: Number, default: 0 },
  activo: { type: Boolean, default: true },
});

kpiAreaSchema.statics.SEED = [
  { codigo: 'COMPRAS',      nombre: 'Compras',             orden: 1 },
  { codigo: 'TESORERIA',    nombre: 'Tesorería',           orden: 2 },
  { codigo: 'CONTABILIDAD', nombre: 'Contabilidad',        orden: 3 },
  { codigo: 'TI',           nombre: 'TI',                  orden: 4 },
  { codigo: 'PROYECTOS',    nombre: 'Proyectos',           orden: 5 },
  { codigo: 'COSTOS',       nombre: 'Costos/Inventarios',  orden: 6 },
];

// Idempotente: solo inserta las áreas que falten, nunca pisa lo editado por ADMIN.
kpiAreaSchema.statics.asegurarSeed = async function () {
  for (const a of this.SEED) {
    await this.updateOne({ codigo: a.codigo }, { $setOnInsert: a }, { upsert: true });
  }
};

module.exports = mongoose.model('KpiArea', kpiAreaSchema);

const mongoose = require('mongoose');

// Rango de fechas (máx. 3 por tipo de ocurrencia, validado en routes/planillas.js).
const rangoSchema = new mongoose.Schema({
  desde: { type: Date, required: true },
  hasta: { type: Date, required: true },
}, { _id: false });

const descuentoBolsaSchema = new mongoose.Schema({
  monto:      { type: Number, required: true },
  comentario: { type: String, default: '' },
}, { _id: true });

const trabajadorSchema = new mongoose.Schema({
  codigo:            { type: String, required: true },
  nombre:            { type: String, required: true },
  fechaIngreso:      { type: Date, required: true },
  fechaCese:         { type: Date, default: null },
  tipoDocumento:     { type: String, default: '' },
  numeroDocumento:   { type: String, default: '' },
  basico:            { type: Number, default: 0 },
  asignacionFamiliar:{ type: Number, default: 0 },
  cargo:             { type: String, default: '' },

  // Paso 2 — Manager: hasta 3 rangos por tipo de ocurrencia.
  feriados:        { type: [rangoSchema], default: [] },
  faltas:          { type: [rangoSchema], default: [] },
  vacaciones:      { type: [rangoSchema], default: [] },
  licenciaSinGoce: { type: [rangoSchema], default: [] },
  licenciaConGoce: { type: [rangoSchema], default: [] },
  descansoMedico:  { type: [rangoSchema], default: [] },
  extraMonto:      { type: Number, default: 0 },
  extraComentario: { type: String, default: '' },
  descuentoMonto:      { type: Number, default: 0 },
  descuentoComentario: { type: String, default: '' },
  observacion:     { type: String, default: '' },

  // Paso 3 — GAF: "esperado" elegido a mano + snapshot de los puntos del
  // catálogo al momento de elegirlo (no se recalcula solo si el catálogo
  // cambia después, para no desincronizar una planilla ya distribuida).
  esperado: { type: String, default: '' },
  puntos:   { type: Number, default: 0 },
}, { _id: true });

const planillaSchema = new mongoose.Schema({
  operacion: { type: String, required: true },
  mes:       { type: Number, required: true, min: 1, max: 12 },
  quincena:  { type: String, required: true, enum: ['1Q', '2Q'] },

  fechaPago:          { type: Date, required: true },
  fechaLimiteRRHH:    { type: Date, required: true },
  fechaLimiteManager: { type: Date, required: true },
  fechaLimiteGAF:     { type: Date, required: true },
  fechaLimiteVoBo:    { type: Date, required: true },

  // 'borrador'        = RRHH todavía cargando trabajadores (Paso 1)
  // 'pendienteManager'= Manager tiene que registrar ocurrencias (Paso 2)
  // 'bloqueada'       = Manager ya dio OK, esperando al GAF (Paso 3)
  // 'pendienteVoBo'   = GAF ya distribuyó la Bolsa, esperando VoBo (Paso 4)
  // 'cerrada'         = Manager dio el VoBo final
  estado: {
    type: String, default: 'borrador',
    enum: ['borrador', 'pendienteManager', 'bloqueada', 'pendienteVoBo', 'cerrada'],
  },

  creadoPor: String, creadoEn: { type: Date, default: Date.now },
  managerOkPor: String, managerOkEn: Date,
  gafPor: String, gafEn: Date,
  voboPor: String, voboEn: Date,

  // Paso 3 — GAF: datos de la Bolsa de esta operación.
  tip:             { type: Number, default: 0 },
  rc:              { type: Number, default: 0 },
  rcPctOperacion:  { type: Number, default: 0 }, // fracción, ej. 0.5 = 50%
  descuentosBolsa: { type: [descuentoBolsaSchema], default: [] },

  trabajadores: { type: [trabajadorSchema], default: [] },
});
planillaSchema.index({ operacion: 1, mes: 1, quincena: 1 }, { unique: true });

module.exports = mongoose.model('Planilla', planillaSchema);

const mongoose = require('mongoose');

// Solicitud de cambio sobre una receta de RecetaCosteo/RecetaCosteoDetalle
// (aprobar NO modifica esas colecciones — son un snapshot diario reemplazado
// por completo desde EBC RECETAS.xlsx — sirve como registro formal de lo que
// hay que corregir en el ERP; el cambio real llega a la app en el siguiente
// sync una vez corregido ahí).
const lineaCambioSchema = new mongoose.Schema({
  accion:            { type: String, required: true, enum: ['MODIFICAR_CANTIDAD', 'AGREGAR_INSUMO'] },
  insumo:            { type: Number },       // código del insumo — vacío si esInsumoNuevo (aún no tiene código en el ERP)
  insumoNombre:      { type: String, default: '' }, // nombre actual (existente) o descripción propuesta (nuevo)
  esInsumoNuevo:      { type: Boolean, default: false },
  cantidadAnterior:  { type: Number },       // snapshot, solo MODIFICAR_CANTIDAD
  cantidadNueva:     { type: Number, required: true },
  sinCosto:          { type: Boolean, default: false }, // true si el insumo (existente) no tiene costo unitario
  costoSolicitado:   { type: Number },       // costo propuesto, cuando sinCosto o esInsumoNuevo
  comentario:        { type: String, default: '' },
}, { _id: false });

const recetaCambioSolicitudSchema = new mongoose.Schema({
  operacion:   { type: String, required: true },
  sociedad:    { type: String, default: '' },
  item:        { type: Number, required: true }, // receta objetivo del cambio
  itemNombre:  { type: String, default: '' },    // cache
  grupo:       { type: String, default: '' },    // cache

  lineas: { type: [lineaCambioSchema], default: [] },

  estado: { type: String, default: 'pendiente', enum: ['pendiente', 'aprobado', 'rechazado'] },

  solicitadoPor: { type: String, required: true },
  solicitadoEn:  { type: Date, default: Date.now },
  aprobadoPor:   { type: String },
  aprobadoEn:    { type: Date },
  comentarioAprobador: { type: String, default: '' },

  // Generada automáticamente al aprobar un cambio en una receta que es
  // insumo de esta (nivel inferior) — no trae líneas propias, solo marca
  // que esta receta debe revisarse.
  automatico:       { type: Boolean, default: false },
  origenSolicitudId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecetaCambioSolicitud' },
  origenItem:        { type: Number }, // ítem de nivel inferior que disparó la cascada
});
recetaCambioSolicitudSchema.index({ operacion: 1, estado: 1 });
recetaCambioSolicitudSchema.index({ operacion: 1, item: 1 });

module.exports = mongoose.model('RecetaCambioSolicitud', recetaCambioSolicitudSchema);

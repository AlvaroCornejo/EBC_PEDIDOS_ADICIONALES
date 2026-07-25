const mongoose = require('mongoose');

// Tabla de equivalencia TC <-> EECC usada para agrupar la Sección 6 (Depósitos de
// Operadores de TC) de Conciliación de Cobranzas. Se importa desde la hoja "PARAMETROS"
// del archivo Q TC.xlsx (u homólogo por sociedad), sección
// "1. EQUIVALENCIA PARA CONCILIACION DEPOSITO TC" — un operador de TC puede mapear a
// más de una categoría de EECC y viceversa (ej. NIUBIZ -> COMPAÑIA PERU y ABONO VISANET).
const tcEquivalenciaSchema = new mongoose.Schema({
  sociedad: { type: String, required: true, index: true },
  tc:       { type: String, required: true },
  eecc:     { type: String, required: true },
});

tcEquivalenciaSchema.index({ sociedad: 1, tc: 1, eecc: 1 }, { unique: true });

module.exports = mongoose.model('TcEquivalencia', tcEquivalenciaSchema);

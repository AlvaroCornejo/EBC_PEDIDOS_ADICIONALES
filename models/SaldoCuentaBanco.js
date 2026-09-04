const mongoose = require('mongoose');

// Catálogo de cuentas bancarias reconocidas por el módulo Saldos Bancarios —
// mapea el identificador de cuenta tal como aparece en el archivo del banco
// (no el código ERP) a sociedad/banco/moneda. Administrable a mano porque no
// hay forma confiable de derivar la sociedad solo del nombre de la empresa
// que trae el archivo (ej. "ETERNO RETORNO S.A.C." no es un nombre de
// sociedad reconocible).
const saldoCuentaBancoSchema = new mongoose.Schema({
  cuenta:       { type: String, required: true, unique: true, trim: true }, // ej. BBVA "00110349860100058233", BCP "194-2192909-0-93", IBK "200-3006323705"
  banco:        { type: String, required: true, enum: ['BBVA', 'BCP', 'BN', 'IBK'] },
  moneda:       { type: String, required: true, enum: ['PEN', 'USD'] },
  sociedad:     { type: String, required: true, trim: true }, // código, ref Sociedad.codigo
  nombreCuenta: { type: String, default: '' }, // referencia (ej. "FACTORIAL K SAC"), no se usa para matchear
});

module.exports = mongoose.model('SaldoCuentaBanco', saldoCuentaBancoSchema);

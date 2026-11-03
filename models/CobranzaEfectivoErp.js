const mongoose = require('mongoose');

// Cobranza en efectivo registrada en el ERP (EBC COBRANZA EFECTIVO.xlsx, hoja
// "EFECTIVO_VENTA") — solo venta en efectivo, sin TIP. Se usa en Cierre de Caja
// (Contabilidad/Gerencia) para comparar contra la VENTA en efectivo (PEN)
// registrada en el módulo. El Excel ya trae el histórico completo desde 2021,
// se reemplaza por completo en cada import (mismo patrón que VentaDiaria/TipDiario).
const cobranzaEfectivoErpSchema = new mongoose.Schema({
  operacion: { type: String, required: true, index: true },
  fecha:     { type: Date, required: true },
  efectivo:  { type: Number, default: 0 },
});
cobranzaEfectivoErpSchema.index({ operacion: 1, fecha: 1 });

module.exports = mongoose.model('CobranzaEfectivoErp', cobranzaEfectivoErpSchema);

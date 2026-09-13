const mongoose = require('mongoose');

// Días no hábiles usados para calcular vencimientos "día hábil N" del cierre contable.
// origen=FERIADO_OFICIAL se sincroniza desde la API de Nager.Date (POST
// /api/cierre-contable/dias-no-laborables/sincronizar-feriados) y nunca se edita a mano;
// origen=ADICIONAL lo carga el ADMIN (puentes u otros días no cubiertos por esa API).
const diaNoLaborableSchema = new mongoose.Schema({
  fecha:       { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  descripcion: { type: String, default: '' },
  origen:      { type: String, required: true, enum: ['FERIADO_OFICIAL', 'ADICIONAL'] },
});

module.exports = mongoose.model('DiaNoLaborable', diaNoLaborableSchema);

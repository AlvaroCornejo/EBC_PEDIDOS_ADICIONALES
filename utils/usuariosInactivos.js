const User = require('../models/User');

// El JWT dura 24h y middleware/auth.js no consulta la base, así que sin esto un
// usuario desactivado seguiría operando hasta que venza su token. Se cachea el
// conjunto de ids inactivos (normalmente vacío o muy chico) para no hacer una
// consulta por request; routes/users.js llama a invalidar() al cambiar `activo`.
const TTL_MS = 30 * 1000;
let cache = null;
let cargadoEn = 0;

async function idsInactivos() {
  if (!cache || Date.now() - cargadoEn > TTL_MS) {
    const docs = await User.find({ activo: false }, { id: 1 }).lean();
    cache = new Set(docs.map(d => d.id));
    cargadoEn = Date.now();
  }
  return cache;
}

async function esInactivo(userId) {
  return (await idsInactivos()).has(userId);
}

function invalidar() { cache = null; }

module.exports = { esInactivo, invalidar };

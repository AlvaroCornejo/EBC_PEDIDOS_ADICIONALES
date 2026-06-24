require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Google DNS — evita bloqueo SRV del router
const mongoose = require('mongoose');
const CierreCaja = require('../models/CierreCaja');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const coll = CierreCaja.collection;

  const indexes = await coll.indexes();
  const viejo = indexes.find(i => JSON.stringify(i.key) === JSON.stringify({ operacion: 1, fecha: 1 }));
  if (viejo) {
    await coll.dropIndex(viejo.name);
    console.log('Índice viejo eliminado:', viejo.name);
  } else {
    console.log('Índice viejo no encontrado (ya migrado o nunca existió)');
  }

  const r = await coll.updateMany({ turno: { $exists: false } }, { $set: { turno: 'Único' } });
  console.log('Documentos actualizados con turno=Único:', r.modifiedCount);

  await CierreCaja.syncIndexes();
  console.log('Índices sincronizados:', (await coll.indexes()).map(i => i.name));

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

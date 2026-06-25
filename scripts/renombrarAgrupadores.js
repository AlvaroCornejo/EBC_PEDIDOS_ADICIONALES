require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Google DNS — evita bloqueo SRV del router
const mongoose = require('mongoose');
const PagoProgramacion = require('../models/PagoProgramacion');
const PagoBeneficiario = require('../models/PagoBeneficiario');

const MAPA = {
  'AGRUPADO 1':  'BBVA PEN',
  'AGRUPADO 2':  'BBVA PEN OB',
  'AGRUPADO 3':  'BCP PEN',
  'AGRUPADO 4':  'BCP PEN OB',
  'AGRUPADO 5':  'IBK PEN',
  'AGRUPADO 6':  'IBK PEN OB',
  'AGRUPADO 7':  'BBVA DOL',
  'AGRUPADO 8':  'BBVA DOL OB',
  'AGRUPADO 9':  'BCP DOL',
  'AGRUPADO 10': 'BCP DOL OB',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  let totalObligaciones = 0;
  for (const [vieja, nueva] of Object.entries(MAPA)) {
    const r = await PagoProgramacion.updateMany(
      { 'obligaciones.agrupadorPago': vieja },
      { $set: { 'obligaciones.$[el].agrupadorPago': nueva } },
      { arrayFilters: [{ 'el.agrupadorPago': vieja }] }
    );
    if (r.modifiedCount) console.log(`PagoProgramacion: ${vieja} -> ${nueva} (${r.modifiedCount} programaciones)`);
    totalObligaciones += r.modifiedCount;
  }

  let totalBenef = 0;
  for (const campo of ['agrupadorDefault', 'agrupadorDefaultSOL', 'agrupadorDefaultUSD']) {
    for (const [vieja, nueva] of Object.entries(MAPA)) {
      const r = await PagoBeneficiario.updateMany({ [campo]: vieja }, { $set: { [campo]: nueva } });
      if (r.modifiedCount) console.log(`PagoBeneficiario.${campo}: ${vieja} -> ${nueva} (${r.modifiedCount})`);
      totalBenef += r.modifiedCount;
    }
  }

  console.log('Listo. Programaciones afectadas:', totalObligaciones, '| Beneficiarios afectados:', totalBenef);
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

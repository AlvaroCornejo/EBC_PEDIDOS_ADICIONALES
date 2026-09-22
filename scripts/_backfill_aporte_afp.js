/**
 * Rellena el Aporte AFP (13% de Básico + Asig. Familiar) de todos los
 * trabajadores de la Planilla 2Q de septiembre 2026 (las 6 operaciones
 * cargadas), campo nuevo que no existía cuando se hizo la carga inicial.
 * Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_backfill_aporte_afp.js
 * Borrar este archivo después de correrlo una vez.
 */
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');

const Planilla = require('../models/Planilla');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado.\n');

  const planillas = await Planilla.find({ mes: 9, quincena: '2Q' });
  for (const p of planillas) {
    let cambiados = 0;
    p.trabajadores.forEach(t => {
      t.aporteAFP = Math.round(((Number(t.basico) || 0) + (Number(t.asignacionFamiliar) || 0)) * 0.13 * 100) / 100;
      cambiados++;
    });
    await p.save();
    console.log(`✓ ${p.operacion}: ${cambiados} trabajadores actualizados.`);
  }

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

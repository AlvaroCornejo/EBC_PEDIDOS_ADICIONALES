/**
 * Multiplica x2 el campo "esperado" de todos los trabajadores de la
 * Planilla 2Q de septiembre 2026 (las 6 operaciones cargadas).
 * Uso, en el servidor (C:\pedidos-app):
 *   node scripts\_update_esperado_x2.js
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
      const actual = Number(t.esperado) || 0;
      t.esperado = String(Math.round(actual * 2 * 100) / 100);
      cambiados++;
    });
    await p.save();
    console.log(`✓ ${p.operacion}: ${cambiados} trabajadores actualizados.`);
  }

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

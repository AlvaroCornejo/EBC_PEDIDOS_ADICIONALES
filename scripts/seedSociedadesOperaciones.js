require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose  = require('mongoose');
const Sociedad  = require('../models/Sociedad');
const Operacion = require('../models/Operacion');

// Carga inicial idempotente: solo inserta si las colecciones están vacías. Para agregar
// sociedades/operaciones nuevas después, usar Admin → Sociedades y Operaciones (no este
// script).
const SOCIEDADES = [
  { codigo: 'GB',           nombre: 'GB' },
  { codigo: 'ERSAC',        nombre: 'ERSAC' },
  { codigo: 'MUVON',        nombre: 'MUVON' },
  { codigo: 'QUIASMO',      nombre: 'QUIASMO' },
  { codigo: 'FACTORIAL K',  nombre: 'FACTORIAL K' },
  { codigo: 'FRQ1',         nombre: 'FRQ1' },
];

const OPERACIONES = [
  // GB
  { codigo: 'GBGOL',    nombre: 'GBGOL',    sociedadCodigo: 'GB' },
  { codigo: 'GBADC',    nombre: 'GBADC',    sociedadCodigo: 'GB' },
  { codigo: 'GBSRQ',    nombre: 'GBSRQ',    sociedadCodigo: 'GB' },
  { codigo: 'GBCFR',    nombre: 'GBCFR',    sociedadCodigo: 'GB' },
  { codigo: 'GBCRP',    nombre: 'GBCRP',    sociedadCodigo: 'GB' },
  { codigo: 'GBPLANTA', nombre: 'GBPLANTA', sociedadCodigo: 'GB' },
  { codigo: 'GBCORP',   nombre: 'GBCORP',   sociedadCodigo: 'GB' },
  // MUVON
  { codigo: 'MUVON',    nombre: 'MUVON',    sociedadCodigo: 'MUVON' },
  // QUIASMO
  { codigo: 'AASI',     nombre: 'AASI',     sociedadCodigo: 'QUIASMO' },
  { codigo: 'CORPQ',    nombre: 'CORPQ',    sociedadCodigo: 'QUIASMO' },
  // FACTORIAL K
  { codigo: 'CDLAO',    nombre: 'CDLAO',    sociedadCodigo: 'FACTORIAL K' },
  { codigo: 'CORPFK',   nombre: 'CORPFK',   sociedadCodigo: 'FACTORIAL K' },
  { codigo: 'PLANTA',   nombre: 'PLANTA',   sociedadCodigo: 'FACTORIAL K' },
  // FRQ1
  { codigo: 'CDL28',    nombre: 'CDL28',    sociedadCodigo: 'FRQ1' },
  // ERSAC: sin operaciones propias
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const [sCount, oCount] = await Promise.all([Sociedad.countDocuments(), Operacion.countDocuments()]);
  if (sCount || oCount) {
    console.log(`Ya hay datos (${sCount} sociedades, ${oCount} operaciones) — no se hace nada. Usa Admin → Sociedades y Operaciones para modificar.`);
  } else {
    await Sociedad.insertMany(SOCIEDADES);
    await Operacion.insertMany(OPERACIONES);
    console.log(`✓ ${SOCIEDADES.length} sociedades y ${OPERACIONES.length} operaciones cargadas`);
  }

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const Proceso  = require('../models/Proceso');

// Carga inicial idempotente: solo inserta si la colección está vacía. Para agregar
// procesos nuevos después, usar Admin → Cierre Contable → Procesos (no este script).
const PROCESOS = [
  { codigo: 'RRHH',        nombre: 'RRHH' },
  { codigo: 'VENTAS',      nombre: 'VENTAS' },
  { codigo: 'LOGISTICA',   nombre: 'LOGÍSTICA' },
  { codigo: 'TESORERIA',   nombre: 'TESORERÍA' },
  { codigo: 'COMPRAS',     nombre: 'COMPRAS' },
  { codigo: 'CONTABILIDAD', nombre: 'CONTABILIDAD' },
  { codigo: 'GERENCIA',    nombre: 'GERENCIA' },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const count = await Proceso.countDocuments();
  if (count) {
    console.log(`Ya hay ${count} procesos — no se hace nada. Usa Admin → Cierre Contable → Procesos para modificar.`);
  } else {
    await Proceso.insertMany(PROCESOS);
    console.log(`✓ ${PROCESOS.length} procesos cargados`);
  }

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });

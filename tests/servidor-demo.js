// Servidor local para probar Indicadores GAF en el navegador SIN tocar Atlas:
// la `app` real de server.js contra una MongoDB en memoria (se pierde al cerrar).
//   node tests/servidor-demo.js   → http://localhost:3100
// Usuarios de prueba (contraseña de todos: demo123):
//   demo.admin    ADMIN de la app
//   demo.captura  Captura en Compras, Lectura en Tesorería
//   demo.lector   Lector global
//   demo.sinkpi   Sin acceso a Indicadores
process.env.JWT_SECRET = 'demo-secret';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = require('../server');

  const User      = require('../models/User');
  const KpiArea   = require('../models/KpiArea');
  const Sociedad  = require('../models/Sociedad');
  const Operacion = require('../models/Operacion');

  await KpiArea.asegurarSeed();
  for (const codigo of ['GB', 'ERSAC', 'MUVON', 'QUIASMO', 'FACTORIAL K', 'FRQ1']) {
    await Sociedad.create({ codigo, nombre: codigo });
  }
  await Operacion.insertMany([
    { codigo: 'GBGOL', nombre: 'GBGOL', sociedadCodigo: 'GB' },
    { codigo: 'GBPLANTA', nombre: 'GBPLANTA', sociedadCodigo: 'GB' },
    { codigo: 'CDLAO', nombre: 'CDLAO', sociedadCodigo: 'FACTORIAL K' },
  ]);
  await require('../utils/kpiSeed').sembrarKpis('SEED');

  const password = await bcrypt.hash('demo123', 4);
  const base = { password, mustChangePassword: false };
  await User.insertMany([
    { ...base, id: 'demo-admin',   username: 'demo.admin',   role: 'ADMIN' },
    { ...base, id: 'demo-captura', username: 'demo.captura', kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }, { area: 'TESORERIA', nivel: 'LECTURA' }] },
    { ...base, id: 'demo-lector',  username: 'demo.lector',  kpiRol: 'lector' },
    { ...base, id: 'demo-sinkpi',  username: 'demo.sinkpi',  role: 'OPERADOR_SOLICITUD', operations: ['GBGOL'] },
  ]);

  const PORT = 3100; // fijo: server.js carga el PORT del .env y no debe chocar con el servidor real
  app.listen(PORT, () => console.log(`Demo Indicadores GAF (base en memoria): http://localhost:${PORT}`));
})();

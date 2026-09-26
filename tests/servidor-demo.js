// Servidor local para probar Indicadores GAF en el navegador SIN tocar Atlas ni Box:
// la `app` real de server.js contra una MongoDB en memoria (se pierde al cerrar), con Box
// simulado en memoria y 12 meses de registros de ejemplo.
//   node tests/servidor-demo.js   → http://localhost:3100
// Usuarios de prueba (contraseña de todos: demo123):
//   demo.admin    ADMIN de la app
//   demo.captura  Captura en Compras, Lectura en Tesorería
//   demo.lector   Lector global
//   demo.sinkpi   Sin acceso a Indicadores
process.env.JWT_SECRET = 'demo-secret';

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

// Box simulado: los archivos quedan en memoria y se sirven en /demo-box/:id.
const box = require('../utils/boxClient');
const archivosBox = new Map();
box.subirArchivo = async ({ buffer, nombreOriginal, segmentos }) => {
  const id = String(archivosBox.size + 1);
  archivosBox.set(id, { buffer, nombreOriginal });
  return { boxFileId: id, nombre: `${Date.now()}_${nombreOriginal}`, ruta: segmentos.join('/') };
};
box.urlDescarga = async (id) => `/demo-box/${id}`;
box.eliminarArchivo = async (id) => { archivosBox.delete(id); };
box.probarConexion = async () => ({ id: '0', nombre: 'Box simulado (demo)' });

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = require('../server');
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));

  const User           = require('../models/User');
  const KpiArea        = require('../models/KpiArea');
  const Sociedad       = require('../models/Sociedad');
  const Operacion      = require('../models/Operacion');
  const KpiDefinicion  = require('../models/KpiDefinicion');
  const KpiMetaVersion = require('../models/KpiMetaVersion');
  const KpiRegistro    = require('../models/KpiRegistro');
  const P = require('../utils/kpiPeriodo');
  const { calcularSemaforo } = require('../utils/kpiSemaforo');
  const { metaVigente, snapshot } = require('../utils/kpiMetas');

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

  // Ámbito y responsables de ejemplo, e historial: los últimos 12 periodos cerrados, salvo
  // el más reciente de algunos KPIs (para que haya pendientes de captura). Valores
  // deterministas alrededor de la meta.
  // creadoEn hacia atrás: si no, ningún periodo pasado sería exigible (no habría grises ni pendientes).
  await KpiDefinicion.updateMany({}, { unidades: ['GB', 'ERSAC'], responsables: ['demo-captura'], creadoEn: new Date('2025-01-01') });
  await KpiDefinicion.updateMany({ areaCodigo: 'TI' }, { responsables: [] }); // para ver el grupo "Sin responsable"
  // Las metas de la carga inicial rigen desde 2026; en la demo se extienden hacia atrás.
  for (const v of await KpiMetaVersion.find().lean()) {
    const { _id, creadoEn, ...resto } = v;
    await KpiMetaVersion.create({ ...resto, vigenteDesde: '2024-01-01', motivo: 'Demo: histórico' });
  }
  const kpis = await KpiDefinicion.find().lean();
  const hoy = P.hoyLima();
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
  const docs = [];
  for (const [i, k] of kpis.entries()) {
    const versiones = await KpiMetaVersion.find({ kpiId: k._id }).lean();
    const ultimo = P.anterior(P.periodoDeFecha(hoy, k.frecuencia));
    for (const periodo of P.ultimos(ultimo, 12)) {
      for (const unidadCodigo of k.unidades) {
        if (periodo === ultimo && i % 4 === 0) continue;
        const { inicio } = P.rango(periodo);
        const meta = snapshot(metaVigente(versiones, unidadCodigo, inicio));
        const ref = meta ? (k.sentido === 'RANGO' ? 0 : meta.meta) : 10;
        const escala = k.sentido === 'RANGO' ? 14 : Math.max(Math.abs(ref) * 0.08, 1.5);
        let valor = ref + (azar() - (k.sentido === 'MENOR' ? 0.35 : 0.65)) * escala * 2;
        if (k.unidad === '%' && k.sentido !== 'RANGO') valor = Math.min(Math.max(valor, 0), 100);
        if (['numero', 'S/'].includes(k.unidad)) valor = Math.max(Math.round(valor), 0);
        valor = Math.round(valor * 100) / 100;
        const semaforo = calcularSemaforo(valor, k.sentido, meta);
        docs.push({
          kpiId: k._id, kpiCodigo: k.codigo, areaCodigo: k.areaCodigo, unidadCodigo, periodo, periodoInicio: inicio,
          frecuencia: k.frecuencia, tipoCaptura: k.tipoCaptura, unidad: k.unidad, sentido: k.sentido,
          valor, meta, semaforo, comentario: semaforo === 'ROJO' ? 'Dato de ejemplo en rojo' : '',
          registradoPor: 'demo-captura', registradoPorNombre: 'demo.captura', registradoEn: new Date(P.vencimiento(periodo, 1)),
        });
      }
    }
  }
  await KpiRegistro.insertMany(docs);

  const outer = express();
  outer.get('/demo-box/:id', (req, res) => {
    const f = archivosBox.get(req.params.id);
    if (!f) return res.status(404).send('No existe');
    res.attachment(f.nombreOriginal).send(f.buffer);
  });
  outer.use(app);
  const PORT = 3100; // fijo: server.js carga el PORT del .env y no debe chocar con el servidor real
  outer.listen(PORT, () => console.log(`Demo Indicadores GAF (base en memoria, ${docs.length} registros): http://localhost:${PORT}`));
})();

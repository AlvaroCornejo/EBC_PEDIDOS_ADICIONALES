const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const h = require('./helpers');
const P = require('../utils/kpiPeriodo');
const push  = require('../utils/sendPush');
const email = require('../utils/sendEmail');
const Config         = require('../models/Config');
const Sociedad       = require('../models/Sociedad');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const { ejecutarDiario } = require('../utils/kpiNotificaciones');

// Envíos simulados: se registran en memoria, nunca salen correos ni push reales.
let pushes = [], correos = [];
push.sendPush   = async (filtro, payload) => { pushes.push({ ids: filtro.userId.$in, payload }); };
email.sendEmail = async (filtro, payload) => { correos.push({ id: filtro.userId, subject: payload.subject, body: payload.body }); };
const esperar = async (cond) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); };

let otif, disp, responsable, adminApp, adminKpi, capturista;
before(h.iniciar);
after(h.detener);
beforeEach(async () => {
  await h.limpiar();
  pushes = []; correos = [];
  await Sociedad.insertMany([{ codigo: 'GB', nombre: 'GB' }]);
  adminApp   = (await h.crearUsuario({ role: 'ADMIN', username: 'gaf' })).user;
  adminKpi   = (await h.crearUsuario({ kpiRol: 'admin', username: 'admin.kpi' })).user;
  responsable = (await h.crearUsuario({ username: 'ana', kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] })).user;
  const base = { frecuencia: 'MENSUAL', unidad: '%', unidades: ['GB'], plazoCapturaDias: 8, sentido: 'MAYOR', creadoEn: new Date('2026-01-01') };
  otif = await KpiDefinicion.create({ ...base, codigo: 'COM-02', nombre: 'OTIF', areaCodigo: 'COMPRAS', responsables: [responsable.id] });
  disp = await KpiDefinicion.create({ ...base, codigo: 'TI-01', nombre: 'Disponibilidad', areaCodigo: 'TI' });
  for (const k of [otif, disp]) await KpiMetaVersion.create({ kpiId: k._id, vigenteDesde: '2020-01-01', meta: 95, umbralAmbar: 90 });
});

const mesPasado = () => P.anterior(P.periodoDeFecha(P.hoyLima(), 'MENSUAL'));

describe('Aviso inmediato de KPI en rojo', () => {
  it('llega a los admins de Indicadores (push + correo), no a quien capturó', async () => {
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
    const r = await u.post('/api/kpis/registros', { kpiId: String(otif._id), periodo: mesPasado(), unidadCodigo: 'GB', valor: 80, comentario: 'Falla proveedor', confirmado: true });
    assert.equal(r.status, 200, r.body.error);
    await esperar(() => correos.length >= 2);
    assert.deepEqual(correos.map(c => c.id).sort(), [adminApp.id, adminKpi.id].sort());
    assert.match(correos[0].subject, /COM-02 en rojo/);
    assert.match(correos[0].body, /Falla proveedor/);
    assert.deepEqual(pushes[0].ids.sort(), [adminApp.id, adminKpi.id].sort());
  });

  it('incluye a los destinatarios configurados (ej. la GAF como lectora) y no avisa si no es rojo', async () => {
    const gaf = (await h.crearUsuario({ kpiRol: 'lector', username: 'gaf.lectora' })).user;
    await Config.create({ key: 'kpiAlertaUsuarios', value: [gaf.id] });
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
    await u.post('/api/kpis/registros', { kpiId: String(otif._id), periodo: mesPasado(), unidadCodigo: 'GB', valor: 96, confirmado: true });
    await new Promise(r => setTimeout(r, 150));
    assert.equal(correos.length, 0);
    await u.post('/api/kpis/registros', { kpiId: String(otif._id), periodo: P.anterior(mesPasado()), unidadCodigo: 'GB', valor: 50, comentario: 'x', confirmado: true });
    await esperar(() => correos.length >= 3);
    assert.ok(correos.some(c => c.id === gaf.id));
  });
});

describe('Tarea diaria', () => {
  const HOY = '2026-10-06'; // Set 2026 vence el 08/10 (por vencer); Ago 2026 venció el 08/09

  it('recordatorio al responsable por lo que vence pronto y resumen de vencidos a los admins', async () => {
    const r = await ejecutarDiario({ hoy: HOY });
    const alResponsable = correos.filter(c => c.id === responsable.id);
    assert.equal(alResponsable.length, 1);
    assert.match(alResponsable[0].subject, /1 captura por vencer/);
    assert.match(alResponsable[0].body, /Set 2026/);
    assert.doesNotMatch(alResponsable[0].body, /Ago 2026/);

    const aAdmins = correos.filter(c => c.id !== responsable.id);
    assert.deepEqual(aAdmins.map(c => c.id).sort(), [adminApp.id, adminKpi.id].sort());
    assert.match(aAdmins[0].body, /COM-02/);
    assert.match(aAdmins[0].body, /TI-01/); // sin responsable, igual se avisa a los admins
    assert.equal(r.recordatorios, 1);
  });

  it('no repite avisos ya enviados', async () => {
    await ejecutarDiario({ hoy: HOY });
    const n = correos.length;
    const r = await ejecutarDiario({ hoy: HOY });
    assert.equal(correos.length, n);
    assert.deepEqual([r.recordatorios, r.vencidos, r.correos], [0, 0, 0]);
  });

  it('respeta los días de aviso previo configurados', async () => {
    await Config.create({ key: 'kpiDiasAviso', value: 1 });
    await ejecutarDiario({ hoy: HOY }); // vence en 2 días > 1
    assert.equal(correos.filter(c => c.id === responsable.id).length, 0);
    await ejecutarDiario({ hoy: '2026-10-07' }); // ahora vence en 1 día
    assert.equal(correos.filter(c => c.id === responsable.id).length, 1);
  });

  it('un destinatario adicional solo recibe lo de las áreas que puede ver', async () => {
    const soloTi = (await h.crearUsuario({ username: 'jefe.ti', kpiAreas: [{ area: 'TI', nivel: 'LECTURA' }] })).user;
    const sinModulo = (await h.crearUsuario({ username: 'sin.modulo' })).user;
    await Config.create({ key: 'kpiAlertaUsuarios', value: [soloTi.id, sinModulo.id] });
    await ejecutarDiario({ hoy: HOY });
    const deTi = correos.filter(c => c.id === soloTi.id);
    assert.equal(deTi.length, 1);
    assert.match(deTi[0].body, /TI-01/);
    assert.doesNotMatch(deTi[0].body, /COM-02/);
    assert.equal(correos.filter(c => c.id === sinModulo.id).length, 0);

    correos = [];
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
    await u.post('/api/kpis/registros', { kpiId: String(otif._id), periodo: mesPasado(), unidadCodigo: 'GB', valor: 50, comentario: 'x', confirmado: true });
    await esperar(() => correos.length >= 2);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(correos.some(c => c.id === soloTi.id), false, 'el rojo de Compras no llega a quien solo ve TI');
  });

  it('no avisa a responsables ni admins desactivados', async () => {
    const User = require('../models/User');
    await User.collection.updateMany({ id: { $in: [responsable.id, adminKpi.id] } }, { $set: { activo: false } });
    await ejecutarDiario({ hoy: HOY });
    assert.deepEqual([...new Set(correos.map(c => c.id))], [adminApp.id]);
  });

  it('solo el admin de Indicadores puede ejecutarla a demanda', async () => {
    const lector = await h.comoUsuario({ kpiRol: 'lector' });
    assert.equal((await lector.post('/api/kpis/notificaciones/ejecutar', {})).status, 403);
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    assert.equal((await admin.post('/api/kpis/notificaciones/ejecutar', {})).status, 200);
  });
});

describe('Exportación a Excel', () => {
  async function leer(res) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    return wb;
  }
  const binario = (req) => req.buffer(true).parse((res, cb) => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  it('exporta lo que el usuario ve y nada de áreas no asignadas', async () => {
    const soloTi = await h.comoUsuario({ kpiAreas: [{ area: 'TI', nivel: 'LECTURA' }] });
    const res = await binario(soloTi.get(`/api/kpis/exportar?mes=${mesPasado()}`));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /Indicadores%20GAF/);
    const wb = await leer(res);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumen', 'Detalle', 'Tendencia 12 periodos', 'Pendientes']);
    const texto = wb.worksheets.map(ws => { const v = []; ws.eachRow(r => v.push(JSON.stringify(r.values))); return v.join('\n'); }).join('\n');
    assert.match(texto, /TI-01/);
    assert.doesNotMatch(texto, /COM-02|Compras/);
  });

  it('el admin exporta todas las áreas; sin acceso al módulo, 403', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const wb = await leer(await binario(admin.get(`/api/kpis/exportar?mes=${mesPasado()}`)));
    const detalle = [];
    wb.getWorksheet('Detalle').eachRow((r, i) => { if (i > 3) detalle.push(r.getCell(2).value); });
    assert.deepEqual(detalle.sort(), ['COM-02', 'TI-01']);
    const sinNada = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    assert.equal((await sinNada.get('/api/kpis/exportar')).status, 403);
  });
});

describe('Configuración de avisos', () => {
  it('valida días de aviso y destinatarios', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    assert.equal((await admin.put('/api/kpis/config', { kpiDiasAviso: 99 })).status, 400);
    assert.equal((await admin.put('/api/kpis/config', { kpiAlertaUsuarios: ['no-existe'] })).status, 400);
    assert.equal((await admin.put('/api/kpis/config', { kpiDiasAviso: 5, kpiAlertaUsuarios: [responsable.id] })).status, 200);
    const cfg = (await admin.get('/api/kpis/config')).body;
    assert.equal(cfg.kpiDiasAviso, 5);
    assert.deepEqual(cfg.kpiAlertaUsuarios, [responsable.id]);
  });
});

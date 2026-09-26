const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const Sociedad       = require('../models/Sociedad');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const { sembrarKpis } = require('../utils/kpiSeed');

before(h.iniciar);
after(h.detener);
beforeEach(async () => {
  await h.limpiar();
  await Sociedad.insertMany([{ codigo: 'GB', nombre: 'GB' }, { codigo: 'ERSAC', nombre: 'ERSAC' }]);
});

const kpiBase = (extra = {}) => ({
  codigo: 'TST-01', nombre: 'KPI de prueba', areaCodigo: 'COMPRAS', unidad: '%',
  frecuencia: 'MENSUAL', sentido: 'MAYOR', unidades: ['GB'], meta: 95, umbralAmbar: 90,
  vigenteDesde: '2026-01-01', ...extra,
});

describe('Carga inicial', () => {
  it('crea los 40 KPIs con sus metas y es idempotente', async () => {
    assert.equal(await sembrarKpis(), 40);
    assert.equal(await sembrarKpis(), 0);
    assert.equal(await KpiDefinicion.countDocuments(), 40);
    // Los 7 informativos (sin meta) no tienen versión.
    assert.equal(await KpiMetaVersion.countDocuments(), 33);
  });
});

describe('Catálogo de KPIs', () => {
  it('solo el admin de Indicadores crea y edita KPIs', async () => {
    const captura = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
    const lector  = await h.comoUsuario({ kpiRol: 'lector' });
    for (const u of [captura, lector]) assert.equal((await u.post('/api/kpis/definiciones', kpiBase())).status, 403);

    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const r = await admin.post('/api/kpis/definiciones', kpiBase());
    assert.equal(r.status, 200, r.body.error);

    for (const u of [captura, lector]) {
      assert.equal((await u.put(`/api/kpis/definiciones/${r.body._id}`, { nombre: 'X' })).status, 403);
      assert.equal((await u.post(`/api/kpis/definiciones/${r.body._id}/metas`, { vigenteDesde: '2026-06-01', meta: 50, motivo: 'x' })).status, 403);
    }
  });

  it('cada usuario solo ve KPIs de sus áreas; los de otra área responden 404', async () => {
    await sembrarKpis();
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'TI', nivel: 'LECTURA' }] });
    const lista = await u.get('/api/kpis/definiciones');
    assert.equal(lista.body.length, 7);
    assert.ok(lista.body.every(k => k.areaCodigo === 'TI'));
    assert.deepEqual((await u.get('/api/kpis/definiciones?area=COMPRAS')).body, []);

    const deCompras = await KpiDefinicion.findOne({ areaCodigo: 'COMPRAS' });
    assert.equal((await u.get(`/api/kpis/definiciones/${deCompras._id}`)).status, 404);
  });

  it('valida área, enums, unidades y umbrales', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const casos = [
      [{ areaCodigo: 'NO_EXISTE' }, /Área/],
      [{ unidad: 'litros' }, /unidad/],
      [{ frecuencia: 'DIARIA' }, /frecuencia/],
      [{ unidades: ['NO_EXISTE'] }, /Unidades inexistentes/],
      [{ nivelAmbito: 'OPERACION', unidades: ['GB'] }, /Unidades inexistentes/],
      [{ meta: 95, umbralAmbar: 99 }, /ámbar/],
      [{ plazoCapturaDias: -1 }, /plazo/],
      [{ responsables: ['no-existe'] }, /responsable/],
    ];
    for (const [extra, error] of casos) {
      const r = await admin.post('/api/kpis/definiciones', kpiBase(extra));
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.match(r.body.error, error);
    }
    await admin.post('/api/kpis/definiciones', kpiBase());
    assert.match((await admin.post('/api/kpis/definiciones', kpiBase({ codigo: 'tst-01' }))).body.error, /Ya existe/);
  });

  it('el código no se cambia y los KPIs no se borran: se desactivan', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const lector = await h.comoUsuario({ kpiRol: 'lector' });
    const { body: kpi } = await admin.post('/api/kpis/definiciones', kpiBase());

    assert.equal((await admin.put(`/api/kpis/definiciones/${kpi._id}`, { codigo: 'OTRO' })).status, 400);
    assert.match((await admin.put(`/api/kpis/definiciones/${kpi._id}`, { sentido: 'MENOR' })).body.error, /sentido/);
    assert.equal((await admin.delete(`/api/kpis/definiciones/${kpi._id}`)).status, 404); // no existe la ruta

    await admin.put(`/api/kpis/definiciones/${kpi._id}`, { activo: false });
    assert.equal((await lector.get('/api/kpis/definiciones')).body.length, 0);
    assert.equal((await lector.get(`/api/kpis/definiciones/${kpi._id}`)).status, 404);
    assert.equal((await admin.get('/api/kpis/definiciones?inactivos=1')).body.length, 1);
    assert.ok(await KpiDefinicion.exists({ _id: kpi._id }));
  });
});

describe('Versionado de metas', () => {
  it('cambiar la meta crea una versión nueva y la anterior queda intacta', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const { body: kpi } = await admin.post('/api/kpis/definiciones', kpiBase());

    const sinMotivo = await admin.post(`/api/kpis/definiciones/${kpi._id}/metas`, { vigenteDesde: '2026-07-01', meta: 97, umbralAmbar: 92 });
    assert.match(sinMotivo.body.error, /motivo/);

    const r = await admin.post(`/api/kpis/definiciones/${kpi._id}/metas`, { vigenteDesde: '2026-07-01', meta: 97, umbralAmbar: 92, motivo: 'Nueva política' });
    assert.equal(r.status, 200, r.body.error);

    const det = (await admin.get(`/api/kpis/definiciones/${kpi._id}`)).body;
    assert.deepEqual(det.versiones.map(v => [v.vigenteDesde, v.meta]), [['2026-07-01', 97], ['2026-01-01', 95]]);
  });

  it('meta por unidad solo para unidades del ámbito del KPI', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const { body: kpi } = await admin.post('/api/kpis/definiciones', kpiBase());
    const url = `/api/kpis/definiciones/${kpi._id}/metas`;
    assert.equal((await admin.post(url, { unidadCodigo: 'ERSAC', vigenteDesde: '2026-01-01', meta: 90, motivo: 'x' })).status, 400);
    assert.equal((await admin.post(url, { unidadCodigo: 'GB', vigenteDesde: '2026-01-01', meta: 90, motivo: 'x' })).status, 200);
  });

  it('las versiones de meta no se pueden editar ni borrar, ni siquiera desde código', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    await admin.post('/api/kpis/definiciones', kpiBase());
    const v = await KpiMetaVersion.findOne();
    await assert.rejects(KpiMetaVersion.updateOne({ _id: v._id }, { meta: 1 }), /no se modifican/);
    await assert.rejects(KpiMetaVersion.findOneAndUpdate({ _id: v._id }, { meta: 1 }), /no se modifican/);
    await assert.rejects(KpiMetaVersion.deleteOne({ _id: v._id }), /no se modifican/);
    await assert.rejects(KpiMetaVersion.deleteMany({}), /no se modifican/);
    v.meta = 1;
    await assert.rejects(v.save(), /no se modifican/);
    await assert.rejects(v.deleteOne(), /no se modifican/);
    assert.equal((await KpiMetaVersion.findById(v._id)).meta, 95);
  });
});

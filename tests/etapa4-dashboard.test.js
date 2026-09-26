const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const P = require('../utils/kpiPeriodo');
const Config         = require('../models/Config');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const KpiRegistro    = require('../models/KpiRegistro');
const { resolverAcceso } = require('../utils/kpiAcceso');
const { construirTablero, pendientesDeCaptura, periodoReferencia } = require('../utils/kpiTablero');
const { calcularSemaforo } = require('../utils/kpiSemaforo');

const HOY = '2026-09-26';
let admin, otif, tiempoOc, disp;

before(h.iniciar);
after(h.detener);
beforeEach(async () => {
  await h.limpiar();
  const { user } = await h.crearUsuario({ role: 'ADMIN' });
  admin = await resolverAcceso(user.id);
  const { user: resp } = await h.crearUsuario({ username: 'ana.compras' });
  const base = { frecuencia: 'MENSUAL', unidad: '%', unidades: ['GB', 'ERSAC'], plazoCapturaDias: 8, creadoEn: new Date('2026-01-01') };
  otif     = await KpiDefinicion.create({ ...base, codigo: 'COM-02', nombre: 'OTIF', areaCodigo: 'COMPRAS', sentido: 'MAYOR', responsables: [resp.id] });
  tiempoOc = await KpiDefinicion.create({ ...base, codigo: 'COM-01', nombre: 'Tiempo OC', areaCodigo: 'COMPRAS', sentido: 'MENOR', unidad: 'horas', unidades: ['GB'] });
  disp     = await KpiDefinicion.create({ ...base, codigo: 'TI-01', nombre: 'Disponibilidad', areaCodigo: 'TI', sentido: 'MAYOR', unidades: ['GB'] });
  await KpiMetaVersion.create({ kpiId: otif._id, vigenteDesde: '2020-01-01', meta: 95, umbralAmbar: 90 });
  await KpiMetaVersion.create({ kpiId: tiempoOc._id, vigenteDesde: '2020-01-01', meta: 24, umbralAmbar: 36 });
  await KpiMetaVersion.create({ kpiId: disp._id, vigenteDesde: '2020-01-01', meta: 99.5, umbralAmbar: 99 });
});

async function registro(kpi, unidadCodigo, periodo, valor) {
  const meta = await KpiMetaVersion.findOne({ kpiId: kpi._id }).lean();
  return KpiRegistro.create({
    kpiId: kpi._id, kpiCodigo: kpi.codigo, areaCodigo: kpi.areaCodigo, unidadCodigo, periodo,
    periodoInicio: P.rango(periodo).inicio, frecuencia: kpi.frecuencia, tipoCaptura: 'DIRECTO',
    unidad: kpi.unidad, sentido: kpi.sentido, valor, meta, semaforo: calcularSemaforo(valor, kpi.sentido, meta),
    registradoPor: 'x', registradoPorNombre: 'x',
  });
}
const fila = (t, codigo, unidad) => t.areas.flatMap(a => a.kpis).find(k => k.codigo === codigo).filas.find(f => f.unidad === unidad);

describe('Periodo de referencia', () => {
  it('mensual = el mes; semanal = la última semana que empieza en el mes, sin pasar de hoy', () => {
    assert.equal(periodoReferencia('MENSUAL', '2026-08', HOY), '2026-08');
    assert.equal(periodoReferencia('SEMANAL', '2026-08', HOY), '2026-W36'); // empieza el 31/08
    assert.equal(periodoReferencia('SEMANAL', '2026-09', HOY), '2026-W39'); // 21/09; la del 28/09 aún no empieza
  });
});

describe('Tablero', () => {
  it('semáforo por KPI y unidad; gris si venció sin registro; en plazo si aún no vence', async () => {
    await registro(otif, 'GB', '2026-08', 96);
    const t = await construirTablero(admin, { mes: '2026-08', hoy: HOY });
    assert.equal(fila(t, 'COM-02', 'GB').estado, 'VERDE');
    assert.equal(fila(t, 'COM-02', 'ERSAC').estado, 'SIN_DATO'); // venció el 08/09
    const sep = await construirTablero(admin, { mes: '2026-09', hoy: HOY });
    assert.equal(fila(sep, 'COM-02', 'GB').estado, 'PENDIENTE'); // vence el 08/10
  });

  it('no exige periodos que vencieron antes de que existiera el KPI', async () => {
    await KpiDefinicion.collection.updateOne({ _id: otif._id }, { $set: { creadoEn: new Date('2026-09-20T12:00:00Z') } });
    const t = await construirTablero(admin, { mes: '2026-08', hoy: HOY });
    assert.equal(fila(t, 'COM-02', 'ERSAC').estado, 'NO_EXIGIBLE');
  });

  it('resumen del área con la regla configurada y conteo por color', async () => {
    await registro(otif, 'GB', '2026-08', 96);      // VERDE
    await registro(otif, 'ERSAC', '2026-08', 97);   // VERDE
    await registro(tiempoOc, 'GB', '2026-08', 40);  // ROJO
    let compras = (await construirTablero(admin, { mes: '2026-08', hoy: HOY })).areas.find(a => a.codigo === 'COMPRAS');
    assert.deepEqual(compras.conteo, { VERDE: 2, AMBAR: 0, ROJO: 1, SIN_DATO: 0 });
    assert.equal(compras.color, 'AMBAR'); // más frecuente verde, pero hay un rojo

    await Config.create({ key: 'kpiReglaResumen', value: 'MAS_FRECUENTE' });
    compras = (await construirTablero(admin, { mes: '2026-08', hoy: HOY })).areas.find(a => a.codigo === 'COMPRAS');
    assert.equal(compras.color, 'VERDE');

    const ti = (await construirTablero(admin, { mes: '2026-08', hoy: HOY })).areas.find(a => a.codigo === 'TI');
    assert.equal(ti.color, 'SIN_DATO');
  });

  it('variación contra el periodo anterior y si es mejora según el sentido', async () => {
    await registro(tiempoOc, 'GB', '2026-07', 30);
    await registro(tiempoOc, 'GB', '2026-08', 26);
    const f = fila(await construirTablero(admin, { mes: '2026-08', hoy: HOY }), 'COM-01', 'GB');
    assert.equal(f.variacion, -4);
    assert.equal(f.mejora, true); // menor es mejor
    assert.equal(f.tendencia.length, 12);
    assert.deepEqual(f.tendencia.slice(-2).map(p => p.valor), [30, 26]);
  });

  it('filtros por área y por unidad', async () => {
    const t = await construirTablero(admin, { mes: '2026-08', hoy: HOY, area: 'TI' });
    assert.deepEqual(t.areas.map(a => a.codigo), ['TI']);
    const u = await construirTablero(admin, { mes: '2026-08', hoy: HOY, unidad: 'ERSAC' });
    assert.deepEqual(u.areas.flatMap(a => a.kpis.map(k => k.codigo)), ['COM-02']);
    assert.deepEqual(u.unidades, ['ERSAC', 'GB']);
  });
});

describe('Pendientes de captura', () => {
  it('vencidos sin registro, agrupados por responsable, con días de atraso', async () => {
    for (const p of P.ultimos('2026-08', 12)) {
      await registro(otif, 'GB', p, 96);
      await registro(tiempoOc, 'GB', p, 20);
      await registro(disp, 'GB', p, 99.9);
    }
    const r = await pendientesDeCaptura(admin, { hoy: HOY });
    // Solo falta OTIF de ERSAC; su responsable es ana.compras. El KPI existe desde el
    // 01/01/2026: Set–Nov 2025 vencieron antes y no se exigen → Dic 2025 a Ago 2026 = 9.
    assert.deepEqual(r.grupos.map(g => g.responsable), ['ana.compras']);
    assert.equal(r.grupos[0].items.length, 9);
    const agosto = r.grupos[0].items.find(i => i.periodo === '2026-08');
    assert.equal(agosto.diasAtraso, 18); // venció el 08/09
    assert.equal(r.grupos[0].items[0].periodo, '2025-12'); // el más atrasado primero
  });

  it('los KPIs sin responsable van a su propio grupo, al final', async () => {
    const r = await pendientesDeCaptura(admin, { hoy: HOY, area: 'TI' });
    assert.deepEqual(r.grupos.map(g => g.responsable), ['Sin responsable']);
  });
});

describe('Visibilidad del dashboard', () => {
  it('un usuario solo ve sus áreas en el tablero, los pendientes y el histórico', async () => {
    await registro(otif, 'GB', '2026-08', 96);
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'TI', nivel: 'LECTURA' }] });
    const t = (await u.get('/api/kpis/dashboard?mes=2026-08')).body;
    assert.deepEqual(t.areas.map(a => a.codigo), ['TI']);
    assert.deepEqual(t.unidades, ['GB']);
    assert.deepEqual((await u.get('/api/kpis/dashboard?mes=2026-08&area=COMPRAS')).body.areas, []);

    const p = (await u.get('/api/kpis/pendientes')).body;
    assert.ok(p.grupos.flatMap(g => g.items).every(i => i.areaCodigo === 'TI'));

    assert.equal((await u.get(`/api/kpis/definiciones/${otif._id}/historico`)).status, 404);
    assert.equal((await u.get(`/api/kpis/definiciones/${disp._id}/historico`)).status, 200);

    const sinNada = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    assert.equal((await sinNada.get('/api/kpis/dashboard')).status, 403);
  });
});

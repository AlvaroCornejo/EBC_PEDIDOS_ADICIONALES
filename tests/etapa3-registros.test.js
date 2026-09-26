const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const P = require('../utils/kpiPeriodo');
const box = require('../utils/boxClient');
const Sociedad       = require('../models/Sociedad');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const KpiRegistro    = require('../models/KpiRegistro');
const KpiAuditoria   = require('../models/KpiAuditoria');

// Box simulado: nunca se llama a la API real en las pruebas.
const subidas = [];
const eliminados = [];
box.subirArchivo  = async (o) => { subidas.push(o); return { boxFileId: `f${subidas.length}`, nombre: `x_${o.nombreOriginal}`, ruta: o.segmentos.join('/') }; };
box.eliminarArchivo = async (id) => { eliminados.push(id); };
box.urlDescarga   = async (id) => `https://dl.box.test/${id}`;

const MES_PASADO = P.anterior(P.periodoDeFecha(P.hoyLima(), 'MENSUAL'));
const MES_FUTURO = P.desplazar(P.periodoDeFecha(P.hoyLima(), 'MENSUAL'), 2);

let kpi, kpiRatio, kpiTi;
before(h.iniciar);
after(h.detener);
beforeEach(async () => {
  await h.limpiar();
  subidas.length = 0; eliminados.length = 0;
  await Sociedad.insertMany([{ codigo: 'GB', nombre: 'GB' }, { codigo: 'ERSAC', nombre: 'ERSAC' }]);
  const base = { areaCodigo: 'COMPRAS', frecuencia: 'MENSUAL', sentido: 'MAYOR', unidad: '%', unidades: ['GB', 'ERSAC'] };
  kpi      = await KpiDefinicion.create({ ...base, codigo: 'COM-02', nombre: 'OTIF' });
  kpiRatio = await KpiDefinicion.create({ ...base, codigo: 'COM-07', nombre: 'Match', tipoCaptura: 'RATIO' });
  kpiTi    = await KpiDefinicion.create({ ...base, codigo: 'TI-01', nombre: 'Disponibilidad', areaCodigo: 'TI' });
  for (const k of [kpi, kpiRatio, kpiTi]) {
    await KpiMetaVersion.create({ kpiId: k._id, vigenteDesde: '2020-01-01', meta: 95, umbralAmbar: 90 });
  }
});

const capturista = () => h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
const registrar = (u, extra = {}) => u.post('/api/kpis/registros', {
  kpiId: String(kpi._id), periodo: MES_PASADO, unidadCodigo: 'GB', valor: 96, confirmado: true, ...extra,
});

describe('Captura', () => {
  it('guarda el valor con su semáforo, la meta congelada y la auditoría de creación', async () => {
    const u = await capturista();
    const r = await registrar(u);
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.semaforo, 'VERDE');
    assert.equal(r.body.meta.meta, 95);
    assert.equal(r.body.registradoPorNombre, u.user.username);
    const aud = await KpiAuditoria.find({ registroId: r.body._id });
    assert.deepEqual(aud.map(a => a.accion), ['CREACION']);
  });

  it('solo un registro por KPI + periodo + unidad', async () => {
    const u = await capturista();
    assert.equal((await registrar(u)).status, 200);
    assert.equal((await registrar(u, { valor: 50, comentario: 'otro' })).status, 409);
    assert.equal((await registrar(u, { unidadCodigo: 'ERSAC' })).status, 200); // otra unidad sí
    assert.equal(await KpiRegistro.countDocuments(), 2);
  });

  it('exige la confirmación de que el valor no podrá modificarse', async () => {
    const u = await capturista();
    assert.match((await registrar(u, { confirmado: false })).body.error, /confirmar/);
  });

  it('el comentario es obligatorio si el resultado queda en rojo', async () => {
    const u = await capturista();
    const ev = await u.post('/api/kpis/registros/evaluar', { kpiId: String(kpi._id), periodo: MES_PASADO, unidadCodigo: 'GB', valor: 80 });
    assert.equal(ev.body.semaforo, 'ROJO');
    assert.equal(ev.body.comentarioObligatorio, true);
    assert.match((await registrar(u, { valor: 80 })).body.error, /comentario/);
    assert.equal((await registrar(u, { valor: 80, comentario: 'Proveedor X falló' })).status, 200);
  });

  it('numerador/denominador: la app calcula el resultado (× 100 en %)', async () => {
    const u = await capturista();
    const r = await registrar(u, { kpiId: String(kpiRatio._id), valor: undefined, numerador: 19, denominador: 20 });
    assert.equal(r.body.valor, 95);
    assert.equal(r.body.semaforo, 'VERDE');
    assert.match((await registrar(u, { kpiId: String(kpiRatio._id), unidadCodigo: 'ERSAC', numerador: 1, denominador: 0 })).body.error, /cero/);
  });

  it('valida permisos, unidad y periodo', async () => {
    const lectura = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'LECTURA' }] });
    assert.equal((await registrar(lectura)).status, 403);
    const otraArea = await h.comoUsuario({ kpiAreas: [{ area: 'TI', nivel: 'CAPTURA' }] });
    assert.equal((await registrar(otraArea)).status, 404);
    const u = await capturista();
    assert.match((await registrar(u, { unidadCodigo: 'MUVON' })).body.error, /unidad/);
    assert.match((await registrar(u, { periodo: MES_FUTURO })).body.error, /aún no empieza/);
    assert.match((await registrar(u, { periodo: '2026-W10' })).body.error, /inválido/);
    assert.match((await registrar(u, { valor: 'abc' })).body.error, /numérico/);
  });

  it('una meta nueva no altera los registros ya guardados', async () => {
    const u = await capturista();
    const { body: reg } = await registrar(u, { valor: 96 });
    await KpiMetaVersion.create({ kpiId: kpi._id, vigenteDesde: '2020-01-02', meta: 99, umbralAmbar: 98 });
    const det = await u.get(`/api/kpis/registros/${reg._id}`);
    assert.equal(det.body.semaforo, 'VERDE');
    assert.equal(det.body.meta.meta, 95);
  });

  it('sube la evidencia a Box por API en la carpeta del KPI', async () => {
    const u = await capturista();
    const r = await u.post('/api/kpis/registros')
      .field('datos', JSON.stringify({ kpiId: String(kpi._id), periodo: MES_PASADO, unidadCodigo: 'GB', valor: 96, confirmado: true }))
      .attach('archivos', Buffer.from('evidencia'), 'reporte.pdf');
    assert.equal(r.status, 200, r.body.error);
    assert.deepEqual(subidas[0].segmentos, ['COMPRAS', 'COM-02', MES_PASADO, 'GB']);
    assert.equal(r.body.adjuntos[0].nombreOriginal, 'reporte.pdf');

    const dl = await u.get(`/api/kpis/registros/${r.body._id}/adjuntos/${r.body.adjuntos[0].boxFileId}`);
    assert.equal(dl.body.url, 'https://dl.box.test/f1');
  });

  it('si el registro no se guarda, la evidencia subida a Box se elimina', async () => {
    const u = await capturista();
    await registrar(u);
    const r = await u.post('/api/kpis/registros')
      .field('datos', JSON.stringify({ kpiId: String(kpi._id), periodo: MES_PASADO, unidadCodigo: 'GB', valor: 96, confirmado: true }))
      .attach('archivos', Buffer.from('x'), 'a.pdf');
    assert.equal(r.status, 409);
    assert.equal(subidas.length, 0, 'el duplicado se detecta antes de subir');
  });
});

describe('Inmutabilidad: un no-ADMIN no puede modificar un registro guardado', () => {
  it('ni el que lo registró, ni otro capturista, ni el lector — por ninguna ruta de la API', async () => {
    const autor = await capturista();
    const { body: reg } = await registrar(autor);
    const otros = [autor, await capturista(), await h.comoUsuario({ kpiRol: 'lector' })];
    const url = `/api/kpis/registros/${reg._id}`;

    for (const u of otros) {
      assert.equal((await u.put(`${url}/corregir`, { valor: 10, comentario: 'x', motivo: 'x' })).status, 403);
      assert.equal((await u.put(url, { valor: 10 })).status, 404);
      assert.equal((await u.delete(url)).status, 404);
      assert.equal((await h.request().patch(url).set('Authorization', `Bearer ${u.token}`).send({ valor: 10 })).status, 404);
      assert.equal((await registrar(u, { valor: 10, comentario: 'pisar' })).status === 200, false);
      assert.equal((await u.post(`${url}/adjuntos`, { motivo: 'x' })).status, 403);
    }
    const enBase = await KpiRegistro.findById(reg._id).lean();
    assert.equal(enBase.valor, 96);
    assert.equal(enBase.corregido, false);
    assert.equal(await KpiAuditoria.countDocuments({ accion: 'CORRECCION' }), 0);
  });

  it('el modelo rechaza cualquier edición o borrado que no sea una corrección autorizada', async () => {
    const { body: reg } = await registrar(await capturista());
    await assert.rejects(KpiRegistro.updateOne({ _id: reg._id }, { valor: 1 }), /no se modifican/);
    await assert.rejects(KpiRegistro.findOneAndUpdate({ _id: reg._id }, { valor: 1 }), /no se modifican/);
    await assert.rejects(KpiRegistro.deleteOne({ _id: reg._id }), /no se modifican/);
    await assert.rejects(KpiRegistro.deleteMany({}), /no se modifican/);
    const doc = await KpiRegistro.findById(reg._id);
    doc.valor = 1;
    await assert.rejects(doc.save(), /no se modifican/);
    assert.equal((await KpiRegistro.findById(reg._id)).valor, 96);
  });
});

describe('Corrección del ADMIN con auditoría', () => {
  it('exige motivo, recalcula con la meta del periodo y deja la bitácora', async () => {
    const { body: reg } = await registrar(await capturista(), { valor: 96 });
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const url = `/api/kpis/registros/${reg._id}/corregir`;

    assert.match((await admin.put(url, { valor: 91 })).body.error, /motivo/);
    assert.match((await admin.put(url, { valor: 80, motivo: 'Error de digitación' })).body.error, /comentario/);
    assert.match((await admin.put(url, { valor: 96, motivo: 'Nada' })).body.error, /no cambia/);

    const r = await admin.put(url, { valor: 91, motivo: 'Error de digitación' });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.semaforo, 'AMBAR');
    assert.equal(r.body.corregido, true);

    const det = await admin.get(`/api/kpis/registros/${reg._id}`);
    const corr = det.body.auditoria.find(a => a.accion === 'CORRECCION');
    assert.equal(corr.antes.valor, 96);
    assert.equal(corr.despues.valor, 91);
    assert.equal(corr.motivo, 'Error de digitación');
    assert.equal(corr.usuarioNombre, admin.user.username);
    assert.ok(corr.fechaHora);
  });

  it('la bitácora de auditoría no se puede editar ni borrar', async () => {
    await registrar(await capturista());
    const a = await KpiAuditoria.findOne();
    await assert.rejects(KpiAuditoria.updateOne({ _id: a._id }, { motivo: 'x' }), /no se modifica/);
    await assert.rejects(KpiAuditoria.deleteMany({}), /no se modifica/);
    a.motivo = 'x';
    await assert.rejects(a.save(), /no se modifica/);
  });

  it('con registros, el KPI ya no puede cambiar de frecuencia, unidad ni área', async () => {
    await registrar(await capturista());
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    for (const cambio of [{ frecuencia: 'SEMANAL' }, { unidad: 'numero' }, { areaCodigo: 'TI' }]) {
      assert.match((await admin.put(`/api/kpis/definiciones/${kpi._id}`, cambio)).body.error, /ya tiene registros/);
    }
    assert.equal((await admin.put(`/api/kpis/definiciones/${kpi._id}`, { nombre: 'OTIF (nuevo nombre)' })).status, 200);
  });
});

describe('Visibilidad: un usuario no ve áreas que no tiene asignadas', () => {
  it('ni en la lista, ni en el detalle, ni en la auditoría, ni en los adjuntos', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const { body: regCompras } = await admin.post('/api/kpis/registros')
      .field('datos', JSON.stringify({ kpiId: String(kpi._id), periodo: MES_PASADO, unidadCodigo: 'GB', valor: 96, confirmado: true }))
      .attach('archivos', Buffer.from('x'), 'a.pdf');
    await registrar(admin, { kpiId: String(kpiTi._id) });

    const soloTi = await h.comoUsuario({ kpiAreas: [{ area: 'TI', nivel: 'LECTURA' }] });
    const lista = await soloTi.get('/api/kpis/registros');
    assert.deepEqual(lista.body.map(r => r.areaCodigo), ['TI']);
    assert.deepEqual((await soloTi.get('/api/kpis/registros?area=COMPRAS')).body, []);
    assert.deepEqual((await soloTi.get(`/api/kpis/registros?kpiId=${kpi._id}`)).body, []);
    assert.equal((await soloTi.get(`/api/kpis/registros/${regCompras._id}`)).status, 404);
    assert.equal((await soloTi.get(`/api/kpis/registros/${regCompras._id}/adjuntos/f1`)).status, 404);

    const sinNada = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    assert.equal((await sinNada.get('/api/kpis/registros')).status, 403);
    assert.equal((await sinNada.get('/api/kpis/captura/opciones')).status, 403);
  });

  it('el filtro por fechas mezcla bien periodos semanales y mensuales', async () => {
    const semanal = await KpiDefinicion.create({ codigo: 'TES-01', nombre: 'Corrida', areaCodigo: 'COMPRAS', frecuencia: 'SEMANAL', sentido: 'MAYOR', unidad: '%', unidades: ['GB'] });
    const u = await capturista();
    const semana = P.periodoDeFecha(P.rango(MES_PASADO).inicio, 'SEMANAL'); // semana que contiene el día 1
    await registrar(u);
    await registrar(u, { kpiId: String(semanal._id), periodo: P.desplazar(semana, 1) }); // ya dentro del mes pasado
    const mes = MES_PASADO;
    const r = await u.get(`/api/kpis/registros?desde=${mes}&hasta=${mes}`);
    assert.deepEqual(r.body.map(x => x.kpiCodigo).sort(), ['COM-02', 'TES-01']);
    const siguiente = P.desplazar(mes, 1);
    assert.deepEqual((await u.get(`/api/kpis/registros?desde=${siguiente}`)).body, []);
  });

  it('las opciones de captura solo incluyen áreas con nivel Captura', async () => {
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }, { area: 'TI', nivel: 'LECTURA' }] });
    const r = await u.get('/api/kpis/captura/opciones');
    assert.deepEqual(r.body.map(k => k.codigo).sort(), ['COM-02', 'COM-07']);
    assert.equal(r.body[0].periodoSugerido, MES_PASADO);
  });
});

describe('Credenciales (Box / SMTP)', () => {
  it('ni /api/config ni /api/kpis/config devuelven secretos a quien no es ADMIN de la app', async () => {
    const Config = require('../models/Config');
    await Config.insertMany([{ key: 'boxClientSecret', value: 'SECRETO' }, { key: 'smtpPass', value: 'CLAVE' }, { key: 'boxClientId', value: 'cid' }]);
    const op = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    const cfg = (await op.get('/api/config')).body;
    assert.equal(cfg.boxClientSecret, undefined);
    assert.equal(cfg.smtpPass, undefined);

    const kpiAdmin = await h.comoUsuario({ kpiRol: 'admin' });
    const k = (await kpiAdmin.get('/api/kpis/config')).body;
    assert.equal(JSON.stringify(k).includes('SECRETO'), false);
    assert.equal(k.box.secretConfigurado, true);
    assert.equal((await kpiAdmin.put('/api/kpis/config', { box: { clientSecret: 'otro' } })).status, 403);
    assert.equal((await kpiAdmin.put('/api/kpis/config', { kpiBoxCarpetaId: '12345' })).status, 200);
    assert.equal((await op.get('/api/kpis/config')).status, 403);
  });
});

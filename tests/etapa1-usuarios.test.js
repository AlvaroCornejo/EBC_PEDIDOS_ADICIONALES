const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const User = require('../models/User');

before(h.iniciar);
after(h.detener);
beforeEach(h.limpiar);

describe('Desactivación de usuarios (toda EBC)', () => {
  it('un usuario desactivado no puede iniciar sesión', async () => {
    const { user } = await h.crearUsuario({ activo: false });
    const r = await h.request().post('/api/auth/login').send({ username: user.username, password: 'clave123' });
    assert.equal(r.status, 403);
    assert.equal(r.body.token, undefined);
  });

  it('al desactivar, el token que ya tenía deja de servir de inmediato', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const op    = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    assert.equal((await op.get('/api/auth/refresh')).status, 200);

    assert.equal((await admin.delete(`/api/users/${op.user.id}`)).status, 200);

    assert.equal((await op.get('/api/auth/refresh')).status, 401);
    assert.equal((await op.get('/api/sociedades')).status, 401);
  });

  it('desactivar no borra físicamente y se puede reactivar', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const { user } = await h.crearUsuario();
    await admin.delete(`/api/users/${user.id}`);

    const enBase = await User.findOne({ id: user.id }).lean();
    assert.ok(enBase, 'el usuario debe seguir existiendo');
    assert.equal(enBase.activo, false);

    assert.equal((await admin.put(`/api/users/${user.id}`, { activo: true })).status, 200);
    assert.ok(await h.login(user), 'reactivado debe poder iniciar sesión');
  });

  it('un admin no puede desactivarse a sí mismo', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    assert.equal((await admin.delete(`/api/users/${admin.user.id}`)).status, 400);
    assert.equal((await admin.put(`/api/users/${admin.user.id}`, { activo: false })).status, 400);
  });

  it('un no-ADMIN no puede desactivar ni editar usuarios', async () => {
    const op = await h.comoUsuario({ kpiRol: 'admin' }); // admin de Indicadores, no de la app
    const { user } = await h.crearUsuario();
    assert.equal((await op.delete(`/api/users/${user.id}`)).status, 403);
    assert.equal((await op.put(`/api/users/${user.id}`, { activo: false })).status, 403);
  });
});

describe('Accesos por área en Indicadores GAF', () => {
  it('un usuario solo ve las áreas asignadas, con su nivel', async () => {
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }, { area: 'TI', nivel: 'LECTURA' }] });
    const r = await u.get('/api/kpis/mi-acceso');
    assert.equal(r.body.acceso, true);
    assert.deepEqual(r.body.areas.map(a => [a.codigo, a.nivel]), [['COMPRAS', 'CAPTURA'], ['TI', 'LECTURA']]);

    const areas = await u.get('/api/kpis/areas');
    assert.deepEqual(areas.body.map(a => a.codigo).sort(), ['COMPRAS', 'TI']);
  });

  it('sin áreas asignadas no tiene acceso al módulo', async () => {
    const u = await h.comoUsuario({ role: 'OPERADOR_SOLICITUD' });
    assert.deepEqual((await u.get('/api/kpis/mi-acceso')).body, { acceso: false });
    assert.equal((await u.get('/api/kpis/areas')).status, 403);
  });

  it('el lector global ve todas las áreas pero no captura en ninguna', async () => {
    const u = await h.comoUsuario({ kpiRol: 'lector' });
    const r = await u.get('/api/kpis/mi-acceso');
    assert.equal(r.body.areas.length, 6);
    assert.ok(r.body.areas.every(a => a.nivel === 'LECTURA'));
  });

  it('ADMIN de la app y admin de Indicadores ven y capturan todo', async () => {
    for (const campos of [{ role: 'ADMIN' }, { kpiRol: 'admin' }]) {
      const u = await h.comoUsuario(campos);
      const r = await u.get('/api/kpis/mi-acceso');
      assert.equal(r.body.esAdmin, true);
      assert.ok(r.body.areas.every(a => a.nivel === 'CAPTURA'));
    }
  });

  it('el cambio de áreas aplica de inmediato, sin volver a iniciar sesión', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'LECTURA' }] });
    await admin.put(`/api/users/${u.user.id}`, { kpiAreas: [{ area: 'TESORERIA', nivel: 'LECTURA' }] });
    const r = await u.get('/api/kpis/areas');
    assert.deepEqual(r.body.map(a => a.codigo), ['TESORERIA']);
  });

  it('un área desactivada desaparece del acceso de sus usuarios', async () => {
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    const u = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }, { area: 'TI', nivel: 'LECTURA' }] });
    assert.equal((await admin.put('/api/kpis/areas/TI', { activo: false })).status, 200);
    const r = await u.get('/api/kpis/mi-acceso');
    assert.deepEqual(r.body.areas.map(a => a.codigo), ['COMPRAS']);
  });

  it('se descartan áreas inexistentes, niveles inválidos y duplicados al guardar', async () => {
    const admin = await h.comoUsuario({ role: 'ADMIN' });
    const { user } = await h.crearUsuario();
    const r = await admin.put(`/api/users/${user.id}`, {
      kpiRol: 'lector',
      kpiAreas: [
        { area: 'COMPRAS', nivel: 'LECTURA' }, { area: 'COMPRAS', nivel: 'CAPTURA' },
        { area: 'NO_EXISTE', nivel: 'CAPTURA' }, { area: 'TI', nivel: 'SUPERADMIN' },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.kpiAreas, [{ area: 'COMPRAS', nivel: 'CAPTURA' }]);
    assert.equal((await admin.put(`/api/users/${user.id}`, { kpiRol: 'dios' })).status, 400);
  });

  it('solo un admin de Indicadores administra las áreas', async () => {
    const captura = await h.comoUsuario({ kpiAreas: [{ area: 'COMPRAS', nivel: 'CAPTURA' }] });
    const lector  = await h.comoUsuario({ kpiRol: 'lector' });
    for (const u of [captura, lector]) {
      assert.equal((await u.post('/api/kpis/areas', { codigo: 'RRHH', nombre: 'RRHH' })).status, 403);
      assert.equal((await u.put('/api/kpis/areas/COMPRAS', { nombre: 'X' })).status, 403);
    }
    const admin = await h.comoUsuario({ kpiRol: 'admin' });
    assert.equal((await admin.post('/api/kpis/areas', { codigo: 'rrhh', nombre: 'RRHH' })).status, 200);
    assert.equal((await admin.post('/api/kpis/areas', { codigo: 'RRHH', nombre: 'Otra' })).status, 400);
  });
});

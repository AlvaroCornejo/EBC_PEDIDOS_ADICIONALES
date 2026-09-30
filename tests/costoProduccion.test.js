const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const h = require('./helpers');
const CostoProduccion = require('../models/CostoProduccion');
const User = require('../models/User');
const { leerCostoProduccion, numero } = require('../utils/costoProduccionExcel');

before(h.iniciar);
after(h.detener);
beforeEach(h.limpiar);

// Arma la hoja "Datos" con la misma forma que EBC COSTO DE PRODUCCION.xlsx: leyenda arriba,
// fila de meses (combinada sobre 3 columnas) y fila de cabecera con COD.
function libro(meses, filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  ws.getCell('J1').value = 'menor que  0';
  const sup = [null, null, null, null, null, null, 'COSTO RECETA'];
  const cab = [null, 'ITEMS1', 'AREA', 'COD', 'DescripcionLocal', 'UND', null];
  meses.forEach(m => { sup.push(m, null, null); cab.push('CANTIDAD', 'COSTO S/', 'DESVIACIÓN'); });
  ws.getRow(4).values = sup;
  ws.getRow(5).values = cab;
  meses.forEach((m, i) => ws.mergeCells(4, 8 + i * 3, 4, 10 + i * 3));
  filas.forEach((f, i) => { ws.getRow(6 + i).values = [null, i + 1, ...f]; });
  return wb;
}

describe('Lectura del Excel de costo de producción', () => {
  it('detecta los meses por nombre, incluidos setiembre a diciembre', () => {
    const wb = libro(['ENERO', 'SETIEMBRE', 'DICIEMBRE'], [
      ['PANADERIA', 1187, 'RH PAN FRANCES X UND', 'UND', 'S/ 0.18', 100, 0.16, 0.1, 50, 0.2, -0.1, 10, 0.18, 0],
    ]);
    const r = leerCostoProduccion(wb, 2026);
    assert.deepEqual(r.meses, [1, 9, 12]);
    assert.deepEqual(r.docs.map(d => [d.mes, d.cantidad, d.costoReal]), [[1, 100, 0.16], [9, 50, 0.2], [12, 10, 0.18]]);
    assert.equal(r.docs[0].costoReceta, 0.18);
    assert.equal(r.docs[0].item, '1187');
    assert.equal(r.docs[0].operacion, 'PLANTA');
  });

  it('no guarda meses sin producción y marca ítems sin costo receta', () => {
    const wb = libro(['ENERO', 'FEBRERO'], [
      ['PREP', 1204, 'CGRH ADEREZO BASE', 'UND', 'S/ 13.11', 0, 0, 1, 2, 14.39, -0.1],
      ['REPOSTERIA', 14116, 'RH COCO CARAMELIZADO', 'KGR', 0, 5, 16.3, null, 0, 0, null],
    ]);
    const r = leerCostoProduccion(wb, 2026);
    assert.equal(r.docs.length, 2);
    assert.equal(r.sinReceta, 1);
    assert.equal(r.docs.find(d => d.item === '14116').costoReceta, null);
  });

  it('convierte montos en texto y descarta errores de Excel', () => {
    assert.equal(numero('S/ 1,234.50'), 1234.5);
    assert.equal(numero({ formula: 'X', result: { error: '#N/A' } }), null);
    assert.equal(numero({ formula: 'X', result: 3.5 }), 3.5);
    assert.equal(numero(''), null);
  });

  it('falla con un mensaje claro si falta la cabecera', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Datos').getCell('A1').value = 'otra cosa';
    assert.throws(() => leerCostoProduccion(wb, 2026), /COD/);
  });
});

describe('Accesos a Costo de Producción', () => {
  beforeEach(async () => {
    const base = { operacion: 'PLANTA', anio: 2026, mes: 1, cantidad: 10, costoReal: 1, costoReceta: 1.1, unidad: 'UND' };
    await CostoProduccion.insertMany([
      { ...base, area: 'PANADERIA', item: '1', nombre: 'PAN' },
      { ...base, area: 'PREP', item: '2', nombre: 'SALSA' },
      { ...base, area: 'PREP', item: '2', nombre: 'SALSA', mes: 2 },
      { ...base, area: 'REPOSTERIA', item: '3', nombre: 'TORTA', anio: 2025 },
      { ...base, operacion: 'GBPLANTA', area: 'PREP', item: '9', nombre: 'OTRA PLANTA' },
    ]);
  });

  it('sin el permiso responde 403', async () => {
    const u = await h.comoUsuario({ role: 'OPERADOR_CONSULTA' });
    assert.equal((await u.get('/api/costo-produccion/datos')).status, 403);
  });

  it('ADMIN ve todas las operaciones y áreas, y el año más reciente por defecto', async () => {
    const a = await h.comoUsuario({ role: 'ADMIN' });
    const r = await a.get('/api/costo-produccion/datos?operacion=PLANTA');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.operaciones, ['GBPLANTA', 'PLANTA']);
    assert.equal(r.body.operacion, 'PLANTA');
    assert.equal(r.body.anio, 2026);
    assert.deepEqual(r.body.anios, [2026, 2025]);
    assert.deepEqual(r.body.areas, ['PANADERIA', 'PREP']);
    assert.deepEqual(r.body.meses, [1, 2]);
    assert.deepEqual(r.body.items.find(i => i.item === '2').meses['2'], { cantidad: 10, costoReal: 1 });
  });

  it('con áreas asignadas solo ve esas áreas', async () => {
    const u = await h.comoUsuario({ accesoCostoProduccion: true, operations: ['PLANTA'], areasCostoProduccion: ['PREP'] });
    const r = await u.get('/api/costo-produccion/datos');
    assert.deepEqual(r.body.areas, ['PREP']);
    assert.ok(r.body.items.every(i => i.area === 'PREP'));
    assert.deepEqual(r.body.anios, [2026]); // el año de REPOSTERIA no se revela
    assert.equal((await u.get('/api/costo-produccion/datos?anio=2025')).body.items.length, 0);
  });

  it('el permiso se aplica al instante, sin volver a iniciar sesión', async () => {
    const u = await h.comoUsuario({ accesoCostoProduccion: true, operations: ['PLANTA'] });
    assert.equal((await u.get('/api/costo-produccion/datos')).status, 200);
    await User.updateOne({ id: u.user.id }, { accesoCostoProduccion: false });
    assert.equal((await u.get('/api/costo-produccion/datos')).status, 403);
  });

  it('solo ve las operaciones que tiene asignadas', async () => {
    const u = await h.comoUsuario({ accesoCostoProduccion: true, operations: ['PLANTA', 'GBGOL'] });
    const r = await u.get('/api/costo-produccion/datos');
    assert.deepEqual(r.body.operaciones, ['PLANTA']);
    assert.equal(r.body.operacion, 'PLANTA');
    assert.ok(r.body.items.every(i => i.item !== '9'));
    assert.equal((await u.get('/api/costo-produccion/datos?operacion=GBPLANTA')).status, 403);
  });

  it('con el permiso pero sin la operación PLANTA no ve datos', async () => {
    const u = await h.comoUsuario({ accesoCostoProduccion: true, operations: ['GBGOL'] });
    const r = await u.get('/api/costo-produccion/datos');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.operaciones, []);
    assert.deepEqual(r.body.items, []);
  });

  it('el catálogo de áreas es solo para ADMIN', async () => {
    const u = await h.comoUsuario({ accesoCostoProduccion: true });
    assert.equal((await u.get('/api/costo-produccion/areas')).status, 403);
    const a = await h.comoUsuario({ role: 'ADMIN' });
    assert.deepEqual((await a.get('/api/costo-produccion/areas')).body, ['PANADERIA', 'PREP', 'REPOSTERIA']);
  });

  it('Admin → Usuarios guarda el permiso y las áreas', async () => {
    const a = await h.comoUsuario({ role: 'ADMIN' });
    const { user } = await h.crearUsuario();
    const r = await a.put(`/api/users/${user.id}`, { accesoCostoProduccion: true, areasCostoProduccion: ['prep', 'PREP', ' Panaderia '] });
    assert.equal(r.status, 200);
    const u = await User.findOne({ id: user.id }).lean();
    assert.equal(u.accesoCostoProduccion, true);
    assert.deepEqual(u.areasCostoProduccion, ['PREP', 'PANADERIA']);
    const login = await h.request().post('/api/auth/login').send({ username: user.username, password: 'clave123' });
    assert.equal(login.body.user.accesoCostoProduccion, true);
  });
});

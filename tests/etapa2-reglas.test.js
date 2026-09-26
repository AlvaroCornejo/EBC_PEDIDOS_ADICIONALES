// Reglas puras: semáforo, resumen de área, periodos y resolución de metas.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcularSemaforo, validarMeta, resumenArea } = require('../utils/kpiSemaforo');
const P = require('../utils/kpiPeriodo');
const { metaVigente } = require('../utils/kpiMetas');

describe('Semáforo', () => {
  it('mayor es mejor: ≥ meta verde, ≥ ámbar ámbar, si no rojo', () => {
    const m = { meta: 95, umbralAmbar: 90 };
    assert.equal(calcularSemaforo(95, 'MAYOR', m), 'VERDE');
    assert.equal(calcularSemaforo(99, 'MAYOR', m), 'VERDE');
    assert.equal(calcularSemaforo(90, 'MAYOR', m), 'AMBAR');
    assert.equal(calcularSemaforo(89.9, 'MAYOR', m), 'ROJO');
  });

  it('menor es mejor: lógica inversa', () => {
    const m = { meta: 24, umbralAmbar: 36 };
    assert.equal(calcularSemaforo(24, 'MENOR', m), 'VERDE');
    assert.equal(calcularSemaforo(30, 'MENOR', m), 'AMBAR');
    assert.equal(calcularSemaforo(36.1, 'MENOR', m), 'ROJO');
  });

  it('meta 0 sin franja ámbar: cualquier valor > 0 es rojo', () => {
    const m = { meta: 0, umbralAmbar: 0 };
    assert.equal(calcularSemaforo(0, 'MENOR', m), 'VERDE');
    assert.equal(calcularSemaforo(1, 'MENOR', m), 'ROJO');
  });

  it('dentro de rango: verde en el rango, ámbar en la tolerancia, rojo fuera', () => {
    const m = { rangoMin: -10, rangoMax: 10, tolerancia: 5 };
    assert.equal(calcularSemaforo(0, 'RANGO', m), 'VERDE');
    assert.equal(calcularSemaforo(-10, 'RANGO', m), 'VERDE');
    assert.equal(calcularSemaforo(12, 'RANGO', m), 'AMBAR');
    assert.equal(calcularSemaforo(-15, 'RANGO', m), 'AMBAR');
    assert.equal(calcularSemaforo(15.5, 'RANGO', m), 'ROJO');
  });

  it('un ratio con error de redondeo no cambia de color', () => {
    assert.equal(calcularSemaforo((19 / 20) * 100, 'MAYOR', { meta: 95, umbralAmbar: 90 }), 'VERDE');
  });

  it('sin meta es informativo (null)', () => {
    assert.equal(calcularSemaforo(5, 'MENOR', null), null);
    assert.equal(calcularSemaforo(5, 'MENOR', { meta: null }), null);
    assert.equal(calcularSemaforo(5, 'RANGO', { rangoMin: null, rangoMax: null }), null);
  });

  it('valida umbrales incoherentes con el sentido', () => {
    assert.match(validarMeta('MAYOR', { meta: 95, umbralAmbar: 97 }), /menor o igual/);
    assert.match(validarMeta('MENOR', { meta: 24, umbralAmbar: 12 }), /mayor o igual/);
    assert.match(validarMeta('RANGO', { rangoMin: 10, rangoMax: -10 }), /mínimo/);
    assert.match(validarMeta('RANGO', { rangoMin: -10, rangoMax: 10, tolerancia: -1 }), /negativa/);
    assert.equal(validarMeta('MAYOR', { meta: 95, umbralAmbar: 90 }), null);
    assert.equal(validarMeta('MAYOR', {}), null); // informativo
  });
});

describe('Resumen del área', () => {
  it('regla por defecto: más frecuente, pero con algún rojo queda al menos ámbar', () => {
    assert.equal(resumenArea(['VERDE', 'VERDE', 'VERDE', 'ROJO']).color, 'AMBAR');
    assert.equal(resumenArea(['VERDE', 'VERDE', 'AMBAR']).color, 'VERDE');
    assert.equal(resumenArea(['ROJO', 'ROJO', 'VERDE']).color, 'ROJO');
  });

  it('las reglas alternativas son configurables', () => {
    assert.equal(resumenArea(['VERDE', 'VERDE', 'VERDE', 'ROJO'], 'MAS_FRECUENTE').color, 'VERDE');
    assert.equal(resumenArea(['VERDE', 'VERDE', 'AMBAR'], 'PEOR').color, 'AMBAR');
  });

  it('empates van al color más grave; informativos se ignoran; todo sin dato = gris', () => {
    assert.equal(resumenArea(['VERDE', 'AMBAR']).color, 'AMBAR');
    assert.equal(resumenArea([null, null, 'VERDE']).color, 'VERDE');
    assert.equal(resumenArea(['SIN_DATO', 'SIN_DATO']).color, 'SIN_DATO');
    assert.deepEqual(resumenArea(['VERDE', 'SIN_DATO', null]).conteo, { VERDE: 1, AMBAR: 0, ROJO: 0, SIN_DATO: 1 });
  });
});

describe('Periodos', () => {
  it('semanas ISO, incluidos los cruces de año', () => {
    assert.equal(P.periodoDeFecha('2026-09-26', 'SEMANAL'), '2026-W39');
    assert.equal(P.periodoDeFecha('2027-01-01', 'SEMANAL'), '2026-W53'); // 2026 tiene 53 semanas ISO
    assert.equal(P.periodoDeFecha('2025-12-29', 'SEMANAL'), '2026-W01');
    assert.deepEqual(P.rango('2026-W39'), { inicio: '2026-09-21', fin: '2026-09-27' });
    assert.equal(P.esValido('2026-W53', 'SEMANAL'), true);
    assert.equal(P.esValido('2025-W53', 'SEMANAL'), false);
  });

  it('meses, vencimiento y navegación', () => {
    assert.deepEqual(P.rango('2026-02'), { inicio: '2026-02-01', fin: '2026-02-28' });
    assert.equal(P.vencimiento('2026-09', 8), '2026-10-08');
    assert.equal(P.vencimiento('2026-W39', 2), '2026-09-29');
    assert.equal(P.anterior('2026-01'), '2025-12');
    assert.equal(P.anterior('2026-W01'), '2025-W52');
    assert.deepEqual(P.ultimos('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
    assert.equal(P.etiqueta('2026-09'), 'Set 2026');
    assert.equal(P.etiqueta('2026-W05'), 'S5 2026');
    assert.equal(P.esValido('2026-13', 'MENSUAL'), false);
  });
});

describe('Meta vigente', () => {
  const v = (vigenteDesde, meta, unidadCodigo = '', creadoEn = new Date(0)) => ({ vigenteDesde, meta, unidadCodigo, creadoEn });
  const versiones = [v('2026-01-01', 95), v('2026-07-01', 97), v('2026-04-01', 90, 'GB')];

  it('usa la versión vigente al inicio del periodo, no la actual', () => {
    assert.equal(metaVigente(versiones, 'ERSAC', '2026-03-01').meta, 95);
    assert.equal(metaVigente(versiones, 'ERSAC', '2026-08-01').meta, 97);
    assert.equal(metaVigente(versiones, 'ERSAC', '2025-12-01'), null);
  });

  it('la meta específica de una unidad gana sobre la general', () => {
    assert.equal(metaVigente(versiones, 'GB', '2026-03-01').meta, 95); // la de GB aún no regía
    assert.equal(metaVigente(versiones, 'GB', '2026-08-01').meta, 90);
  });

  it('a igual fecha de vigencia, manda la creada después', () => {
    const vs = [v('2026-01-01', 95, '', new Date(1)), v('2026-01-01', 96, '', new Date(2))];
    assert.equal(metaVigente(vs, '', '2026-02-01').meta, 96);
  });
});

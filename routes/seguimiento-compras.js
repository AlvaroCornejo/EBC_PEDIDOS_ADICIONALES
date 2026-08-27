const express = require('express');
const auth = require('../middleware/auth');

const SeguimientoCompraMovimiento = require('../models/SeguimientoCompraMovimiento');
const VentaCanalDiaria = require('../models/VentaCanalDiaria');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolSeguimientoCompras) return next();
  return res.status(403).json({ error: 'Sin acceso a Aprobación y Seguimiento de Compras' });
}
router.use(requireAccess);

/** Operaciones autorizadas del usuario (null = todas) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

// ── Semanas ISO (mismo criterio usado en routes/pronostico-venta.js) ──────────
function isoYear(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}
function mondayOfIsoWeek(año, semana) {
  const jan4 = new Date(Date.UTC(año, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(monday1);
  monday.setUTCDate(monday1.getUTCDate() + (semana - 1) * 7);
  return monday;
}
/** Suma/resta N semanas a un (año,semana) ISO, manejando el cruce de año */
function addSemanas(año, semana, delta) {
  const d = mondayOfIsoWeek(año, semana);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return { año: isoYear(d), semana: isoWeek(d) };
}
function claveSemana(año, semana) { return año * 100 + semana; }

// ── GET /operaciones ────────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const ops = opsFilter(req.user);
    const filter = ops === null ? {} : { operacion: { $in: ops } };
    const disponibles = await SeguimientoCompraMovimiento.distinct('operacion', filter);
    res.json(disponibles.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cálculo por semana: desglose de movimientos del kardex ──────────────────
// Ingresos al Almacén = COMPRA + TRANSFERENCIA (con signo).
// FC Teórico = |VENTA| (magnitud, la venta ya viene negativa en la fuente).
// Otros movimientos = todo lo demás EXCEPTO COMPRA/TRANSFERENCIA/VENTA/INICIAL
// (INICIAL son ajustes de apertura, no actividad de la semana — igual suman
// al saldo corrido pero no se listan como "movimiento").
function calcularSemanaEficiencia(docs) {
  const porTipo = {};
  docs.forEach(d => { porTipo[d.movimiento] = (porTipo[d.movimiento] || 0) + d.importe; });
  const totalTodos = docs.reduce((s, d) => s + d.importe, 0);

  const compra = porTipo['COMPRA'] || 0;
  const transferencia = porTipo['TRANSFERENCIA'] || 0;
  const ingresosAlmacen = compra + transferencia;
  const fcTeorico = Math.abs(porTipo['VENTA'] || 0);

  const otrosDetalle = {};
  let otrosTotal = 0;
  Object.entries(porTipo).forEach(([mov, importe]) => {
    if (['COMPRA', 'TRANSFERENCIA', 'VENTA', 'INICIAL'].includes(mov)) return;
    otrosDetalle[mov] = importe;
    otrosTotal += importe;
  });

  return { totalTodos, compra, transferencia, ingresosAlmacen, fcTeorico, otrosTotal, otrosDetalle };
}

function pct(num, den) { return den ? num / den : null; }

// ── GET /eficiencia?operacion=&semanaObjetivo=YYYYWW&nSemanas= ──────────────
// Eficiencia de consumo y compra de materiales: compara la compra/consumo
// teórico y real contra la Venta Neta AyB, semana a semana.
router.get('/eficiencia', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const nSem = Math.min(Math.max(parseInt(req.query.nSemanas) || 8, 1), 104);

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else { const hoy = new Date(); objetivo = { año: isoYear(hoy), semana: isoWeek(hoy) }; }

    const rango = [];
    for (let i = nSem - 1; i >= 0; i--) rango.push(addSemanas(objetivo.año, objetivo.semana, -i));

    const primeraSemana = rango[0];
    const claveInicio = claveSemana(primeraSemana.año, primeraSemana.semana);

    // Venta (VentaCanalDiaria) — todos los canales suman como AyB.
    const rangoDesde = mondayOfIsoWeek(primeraSemana.año, primeraSemana.semana);
    const ultimaSemana = rango[rango.length - 1];
    const rangoHasta = new Date(mondayOfIsoWeek(ultimaSemana.año, ultimaSemana.semana));
    rangoHasta.setUTCDate(rangoHasta.getUTCDate() + 6);
    rangoHasta.setUTCHours(23, 59, 59, 999);

    const ventaDocs = await VentaCanalDiaria.find({
      operacion, fecha: { $gte: rangoDesde, $lte: rangoHasta },
    }).lean();
    const ventaPorSemana = {};
    ventaDocs.forEach(d => {
      const k = claveSemana(isoYear(d.fecha), isoWeek(d.fecha));
      if (!ventaPorSemana[k]) ventaPorSemana[k] = { ventaBruta: 0, ventaNeta: 0 };
      ventaPorSemana[k].ventaBruta += d.ventaBrutaMasRedencion || 0;
      ventaPorSemana[k].ventaNeta += d.ventaNetaMasRedencion || 0;
    });

    // Movimientos: todo lo anterior a la primera semana del rango (para el
    // Saldo Inicial base) + las semanas del rango.
    const [previosDocs, semanaDocs] = await Promise.all([
      SeguimientoCompraMovimiento.find({
        operacion,
        $expr: { $lt: [{ $add: [{ $multiply: ['$año', 100] }, '$semana'] }, claveInicio] },
      }).lean(),
      SeguimientoCompraMovimiento.find({
        operacion,
        $or: rango.map(h => ({ año: h.año, semana: h.semana })),
      }).lean(),
    ]);

    const saldoInicialBase = previosDocs.reduce((s, d) => s + d.importe, 0);

    const movPorSemana = {};
    semanaDocs.forEach(d => {
      const k = claveSemana(d.año, d.semana);
      if (!movPorSemana[k]) movPorSemana[k] = [];
      movPorSemana[k].push(d);
    });

    let saldoInicial = saldoInicialBase;
    const filas = rango.map(h => {
      const k = claveSemana(h.año, h.semana);
      const docs = movPorSemana[k] || [];
      const calc = calcularSemanaEficiencia(docs);

      const saldoInicialSemana = saldoInicial;
      const inventarioFinal = saldoInicialSemana + calc.totalTodos;
      const consumoTotal = saldoInicialSemana + calc.ingresosAlmacen - inventarioFinal;
      saldoInicial = inventarioFinal;

      const venta = ventaPorSemana[k] || { ventaBruta: 0, ventaNeta: 0 };
      const ventaNetaAyB = venta.ventaNeta;

      return {
        año: h.año, semana: h.semana,
        ventaBruta: venta.ventaBruta,
        ventaNeta: venta.ventaNeta,
        ventaNetaAyB,
        saldoInicial: saldoInicialSemana,
        compra: calc.compra,
        transferencia: calc.transferencia,
        ingresosAlmacen: calc.ingresosAlmacen,
        pctIngresosAlmacen: pct(calc.ingresosAlmacen, ventaNetaAyB),
        fcTeorico: calc.fcTeorico,
        pctFcTeorico: pct(calc.fcTeorico, ventaNetaAyB),
        otrosTotal: calc.otrosTotal,
        otrosDetalle: calc.otrosDetalle,
        inventarioFinal,
        consumoTotal,
        pctConsumoTotal: pct(consumoTotal, ventaNetaAyB),
      };
    });

    res.json({ operacion, objetivo, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const auth = require('../middleware/auth');

const VentaDiaria = require('../models/VentaDiaria');
const TipDiario = require('../models/TipDiario');
const { rangoDia, rangoSemana, rangoMes, rangoAnio, lunesDeLaSemana, aMedianoche, finDeDia, sumarDias } = require('../utils/ventasRangos');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.accesoVentas) return next();
  return res.status(403).json({ error: 'Sin acceso a Ventas' });
}
router.use(requireAccess);

function opsFilter(user) { return user.role === 'ADMIN' ? null : (user.operations || []); }
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}
/** Lee `operacion=A,B,C` del query y valida que el usuario tenga acceso a todas. */
function operacionesFromQuery(req) {
  return String(req.query.operacion || '').split(',').map(s => s.trim()).filter(Boolean);
}
function checkOpsAccess(user, operaciones) {
  return operaciones.every(o => checkOpAccess(user, o));
}

// Canales que usan PAX como divisor (ticket promedio / permanencia promedio);
// todos los demás (incluido OTROS) usan TICKETS.
const CANALES_PAX = new Set(['EN EL LOCAL', 'HABERES']);
const divisorDe = d => CANALES_PAX.has(d.canal) ? d.pax : d.tickets;

const TURNO_LABEL = { DE: 'DESAYUNO', AL: 'ALMUERZO', LO: 'LONCHE', CE: 'CENA' };

function enRango(fecha, rango) {
  if (!rango) return false;
  return fecha >= rango[0] && fecha <= rango[1];
}

/**
 * Agrega un conjunto de filas VentaDiaria ya filtradas por rango de fecha,
 * separando por canal. Devuelve { [canal]: {venta, divisor, permanencia},
 * TOTAL: {...} (sin OTROS ni CORTESIAS), CORTESIAS: {...} }.
 */
function agregarPorCanal(docs, canalesOrden) {
  const porCanal = {};
  const vacio = () => ({ venta: 0, divisor: 0, permanencia: 0 });
  canalesOrden.forEach(c => { porCanal[c] = vacio(); });
  porCanal.TOTAL = vacio();
  porCanal.CORTESIAS = vacio();

  docs.forEach(d => {
    const div = divisorDe(d);
    if (d.tipoDocumento === 'CORTESIA') {
      porCanal.CORTESIAS.venta += d.venta;
      porCanal.CORTESIAS.divisor += div;
      porCanal.CORTESIAS.permanencia += d.permanencia;
      return;
    }
    if (!porCanal[d.canal]) porCanal[d.canal] = vacio(); // canal no previsto en el orden fijo
    porCanal[d.canal].venta += d.venta;
    porCanal[d.canal].divisor += div;
    porCanal[d.canal].permanencia += d.permanencia;
    if (d.canal !== 'OTROS') {
      porCanal.TOTAL.venta += d.venta;
      porCanal.TOTAL.divisor += div;
      porCanal.TOTAL.permanencia += d.permanencia;
    }
  });
  return porCanal;
}

function conDerivados(agregado) {
  const out = {};
  Object.entries(agregado).forEach(([canal, v]) => {
    out[canal] = {
      venta: v.venta,
      cantidad: v.divisor,
      ticketProm: v.divisor > 0 ? v.venta / v.divisor : 0,
      permanenciaProm: v.divisor > 0 ? v.permanencia / v.divisor : 0, // fracción de día
    };
  });
  return out;
}

/** Arma {actual, anterior, anioAnterior} con los 4 derivados, para un rango {actual,anterior,anioAnterior}. */
function bloquePeriodo(docs, rango, canalesOrden) {
  const out = {};
  ['actual', 'anterior', 'anioAnterior'].forEach(k => {
    if (!rango[k]) { out[k] = null; return; }
    const sub = docs.filter(d => enRango(d.fecha, rango[k]));
    out[k] = conDerivados(agregarPorCanal(sub, canalesOrden));
  });
  return out;
}

function variacion(actual, anterior) {
  if (!actual || !anterior) return null;
  return actual === 0 && anterior === 0 ? 0 : (anterior === 0 ? null : actual / anterior - 1);
}

// ── GET /operaciones ─────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const disponibles = await VentaDiaria.distinct('operacion');
    const ops = opsFilter(req.user);
    const filtradas = ops === null ? disponibles : disponibles.filter(o => ops.includes(o));
    res.json(filtradas.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /dia?operacion=&fecha= — secciones 1-8 ──────────────────────────
router.get('/dia', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    const { fecha } = req.query;
    if (!operaciones.length || !fecha) return res.status(400).json({ error: 'Operación y fecha son requeridas' });
    if (!checkOpsAccess(req.user, operaciones)) return res.status(403).json({ error: 'Operación no autorizada' });

    const fechaRef = aMedianoche(new Date(fecha));
    const rDia = rangoDia(fechaRef), rSemana = rangoSemana(fechaRef), rMes = rangoMes(fechaRef), rAnio = rangoAnio(fechaRef);

    // Rango más amplio necesario para cubrir todos los comparativos (hasta ~13 meses atrás).
    const desdeTodo = sumarDias(fechaRef, -400);
    const [ventaDocs, canalesDistintos, tipDocs] = await Promise.all([
      VentaDiaria.find({ operacion: { $in: operaciones }, fecha: { $gte: desdeTodo, $lte: finDeDia(fechaRef) } }).lean(),
      VentaDiaria.distinct('canal', { operacion: { $in: operaciones } }),
      TipDiario.find({ operacion: { $in: operaciones }, fecha: { $gte: desdeTodo, $lte: finDeDia(fechaRef) } }).lean(),
    ]);

    const canalesOrden = canalesDistintos.filter(c => c !== 'OTROS').sort();
    if (canalesDistintos.includes('OTROS')) canalesOrden.push('OTROS');

    const venta = {}, cantidad = {}, ticketProm = {}, permanencia = {};
    [['dia', rDia], ['semana', rSemana], ['mes', rMes], ['anio', rAnio]].forEach(([periodo, rango]) => {
      const bloque = bloquePeriodo(ventaDocs, rango, canalesOrden);
      ['actual', 'anterior', 'anioAnterior'].forEach(k => {
        if (!bloque[k]) return;
        Object.entries(bloque[k]).forEach(([canal, d]) => {
          venta[canal] = venta[canal] || {}; venta[canal][periodo] = venta[canal][periodo] || {};
          cantidad[canal] = cantidad[canal] || {}; cantidad[canal][periodo] = cantidad[canal][periodo] || {};
          ticketProm[canal] = ticketProm[canal] || {}; ticketProm[canal][periodo] = ticketProm[canal][periodo] || {};
          permanencia[canal] = permanencia[canal] || {}; permanencia[canal][periodo] = permanencia[canal][periodo] || {};
          venta[canal][periodo][k] = d.venta;
          cantidad[canal][periodo][k] = d.cantidad;
          ticketProm[canal][periodo][k] = d.ticketProm;
          permanencia[canal][periodo][k] = d.permanenciaProm;
        });
      });
      // % variación
      [venta, cantidad, ticketProm, permanencia].forEach(metric => {
        Object.keys(metric).forEach(canal => {
          const p = metric[canal][periodo];
          if (!p) return;
          p.varAnterior = variacion(p.actual, p.anterior);
          p.varAnioAnterior = variacion(p.actual, p.anioAnterior);
        });
      });
    });

    // TIP / Tasa TIP (sin canal)
    const tip = {}, tasaTip = {};
    [['dia', rDia], ['semana', rSemana], ['mes', rMes], ['anio', rAnio]].forEach(([periodo, rango]) => {
      tip[periodo] = {}; tasaTip[periodo] = {};
      ['actual', 'anterior', 'anioAnterior'].forEach(k => {
        if (!rango[k]) return;
        const sub = tipDocs.filter(d => enRango(d.fecha, rango[k]));
        const efectivo = sub.reduce((s, d) => s + d.tipEfeSol, 0);
        const tc = sub.reduce((s, d) => s + d.tipTcSol, 0);
        tip[periodo][k] = { total: efectivo + tc, efectivo, tc };
        const ventaTotal = venta.TOTAL?.[periodo]?.[k] || 0;
        tasaTip[periodo][k] = {
          total: ventaTotal > 0 ? (efectivo + tc) / ventaTotal : 0,
          efectivo: ventaTotal > 0 ? efectivo / ventaTotal : 0,
          tc: ventaTotal > 0 ? tc / ventaTotal : 0,
        };
      });
      tip[periodo].varAnterior = variacion(tip[periodo].actual?.total, tip[periodo].anterior?.total);
      tip[periodo].varAnioAnterior = variacion(tip[periodo].actual?.total, tip[periodo].anioAnterior?.total);
    });

    // Venta por Turno — solo el día seleccionado
    const docsHoy = ventaDocs.filter(d => enRango(d.fecha, rDia.actual) && d.tipoDocumento === 'VENTA');
    const turno = { DESAYUNO: 0, ALMUERZO: 0, LONCHE: 0, CENA: 0 };
    docsHoy.forEach(d => { const l = TURNO_LABEL[d.turno]; if (l) turno[l] += d.venta; });
    const turnoTotal = Object.values(turno).reduce((s, v) => s + v, 0);
    const turnoPct = {};
    Object.entries(turno).forEach(([k, v]) => { turnoPct[k] = turnoTotal > 0 ? v / turnoTotal : 0; });

    res.json({ canales: canalesOrden, venta, cantidad, ticketProm, permanencia, tip, tasaTip, turno, turnoTotal, turnoPct });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /semanas?operacion=&semanas= — últimas N semanas por canal ──────
router.get('/semanas', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    const nSemanas = Math.max(1, Math.min(52, Number(req.query.semanas) || 12));
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpsAccess(req.user, operaciones)) return res.status(403).json({ error: 'Operación no autorizada' });

    const hoy = aMedianoche(new Date());
    const lunesActual = lunesDeLaSemana(hoy);
    const desde = sumarDias(lunesActual, -(nSemanas - 1) * 7);

    const [docs, canalesDistintos] = await Promise.all([
      VentaDiaria.find({ operacion: { $in: operaciones }, fecha: { $gte: desde, $lte: finDeDia(hoy) }, tipoDocumento: 'VENTA' }).lean(),
      VentaDiaria.distinct('canal', { operacion: { $in: operaciones } }),
    ]);
    const canalesOrden = canalesDistintos.filter(c => c !== 'OTROS').sort();
    if (canalesDistintos.includes('OTROS')) canalesOrden.push('OTROS');

    const semanas = [];
    for (let i = nSemanas - 1; i >= 0; i--) {
      const lunes = sumarDias(lunesActual, -i * 7);
      const domingo = sumarDias(lunes, 6);
      semanas.push({ lunes, domingo });
    }

    const filas = semanas.map(({ lunes, domingo }) => {
      const sub = docs.filter(d => d.fecha >= lunes && d.fecha <= finDeDia(domingo));
      const agregado = conDerivados(agregarPorCanal(sub, canalesOrden));
      const porCanal = {};
      Object.entries(agregado).forEach(([canal, d]) => { porCanal[canal] = d.venta; });
      return { lunes, domingo, porCanal };
    });

    res.json({ canales: canalesOrden, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /semanal-comparativo?operacion=&fecha= — semana vs. misma semana año anterior ──
router.get('/semanal-comparativo', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    const { fecha } = req.query;
    if (!operaciones.length || !fecha) return res.status(400).json({ error: 'Operación y fecha son requeridas' });
    if (!checkOpsAccess(req.user, operaciones)) return res.status(403).json({ error: 'Operación no autorizada' });

    const fechaRef = aMedianoche(new Date(fecha));
    const lunesActual = lunesDeLaSemana(fechaRef);
    const domingoActual = sumarDias(lunesActual, 6);
    // Año anterior: mismo mes/día calendario, un año antes (igual criterio que Mes/Año).
    const lunesAnioAnt = new Date(lunesActual.getFullYear() - 1, lunesActual.getMonth(), lunesActual.getDate());
    const domingoAnioAnt = sumarDias(lunesAnioAnt, 6);

    const [docsActual, docsAnioAnt, canalesDistintos] = await Promise.all([
      VentaDiaria.find({ operacion: { $in: operaciones }, fecha: { $gte: lunesActual, $lte: finDeDia(domingoActual) }, tipoDocumento: 'VENTA' }).lean(),
      VentaDiaria.find({ operacion: { $in: operaciones }, fecha: { $gte: lunesAnioAnt, $lte: finDeDia(domingoAnioAnt) }, tipoDocumento: 'VENTA' }).lean(),
      VentaDiaria.distinct('canal', { operacion: { $in: operaciones } }),
    ]);
    const canalesOrden = canalesDistintos.filter(c => c !== 'OTROS').sort();
    if (canalesDistintos.includes('OTROS')) canalesOrden.push('OTROS');

    const actual = conDerivados(agregarPorCanal(docsActual, canalesOrden));
    const anioAnterior = conDerivados(agregarPorCanal(docsAnioAnt, canalesOrden));
    const filas = canalesOrden.concat(['TOTAL']).map(canal => ({
      canal, actual: actual[canal]?.venta || 0, anioAnterior: anioAnterior[canal]?.venta || 0,
      variacion: variacion(actual[canal]?.venta, anioAnterior[canal]?.venta),
    }));

    res.json({ lunesActual, domingoActual, lunesAnioAnt, domingoAnioAnt, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /mensual?operacion= — histórico mensual por canal, todos los años ──
router.get('/mensual', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpsAccess(req.user, operaciones)) return res.status(403).json({ error: 'Operación no autorizada' });

    const [docs, canalesDistintos] = await Promise.all([
      VentaDiaria.find({ operacion: { $in: operaciones }, tipoDocumento: 'VENTA' }, 'canal fecha venta').lean(),
      VentaDiaria.distinct('canal', { operacion: { $in: operaciones } }),
    ]);
    const canalesOrden = canalesDistintos.filter(c => c !== 'OTROS').sort();
    if (canalesDistintos.includes('OTROS')) canalesOrden.push('OTROS');

    // { canal: { año: { mes(1-12): monto, total: monto } } }
    const datos = {};
    canalesOrden.concat(['TOTAL']).forEach(c => { datos[c] = {}; });
    docs.forEach(d => {
      const anio = d.fecha.getFullYear(), mes = d.fecha.getMonth() + 1;
      const agregar = (canal) => {
        if (!datos[canal][anio]) datos[canal][anio] = { total: 0 };
        datos[canal][anio][mes] = (datos[canal][anio][mes] || 0) + d.venta;
        datos[canal][anio].total += d.venta;
      };
      if (datos[d.canal]) agregar(d.canal);
      if (d.canal !== 'OTROS') agregar('TOTAL');
    });

    res.json({ canales: canalesOrden, datos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

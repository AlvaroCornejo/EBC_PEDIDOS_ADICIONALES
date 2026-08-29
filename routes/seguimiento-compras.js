const express = require('express');
const auth = require('../middleware/auth');

const SeguimientoCompraMovimiento = require('../models/SeguimientoCompraMovimiento');
const SeguimientoCompraOC = require('../models/SeguimientoCompraOC');
const VentaCanalDiaria = require('../models/VentaCanalDiaria');
const VentaForecast = require('../models/VentaForecast');
const GrupoCompraEspecial = require('../models/GrupoCompraEspecial');
const Operacion = require('../models/Operacion');
const Item = require('../models/Item');

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

/** Lee `operaciones=A,B,C` (vista por Sociedad, una o más operaciones) o el
 * `operacion=A` de siempre (vista por Operación individual) — siempre
 * devuelve un array. */
function operacionesFromQuery(req) {
  if (req.query.operaciones) return req.query.operaciones.split(',').map(s => s.trim()).filter(Boolean);
  return req.query.operacion ? [req.query.operacion] : [];
}
/** Devuelve la primera operación sin acceso autorizado, o null si todas están OK. */
function operacionNoAutorizada(user, operaciones) {
  return operaciones.find(op => !checkOpAccess(user, op)) || null;
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

// ── GET /grupos-especiales?operacion= — qué GRUPO COMPRA aplican para el
// checkbox de incluir/excluir de esa operación ───────────────────────────────
router.get('/grupos-especiales', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    const noAutorizada = operacionNoAutorizada(req.user, operaciones);
    if (noAutorizada) return res.status(403).json({ error: `Operación no autorizada: ${noAutorizada}` });
    const grupos = await GrupoCompraEspecial.distinct('grupoCompra', { operacion: { $in: operaciones } });
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cálculo por semana: desglose de movimientos del kardex ──────────────────
// El Excel origen usa códigos cortos de movimiento (columna "MOVIMIENTO" de
// la hoja MOVIMIENTOS): COMPRA, TRANSF, VENTA, INICIAL, CONSUM, CONS PRD,
// INGR PRD, BAJA, MERMA, SOBRA, FALTA.
// Ingresos al Almacén = COMPRA + TRANSF (con signo).
// FC Teórico = VENTA tal cual viene en la fuente (con signo, sin invertir —
// a pedido del usuario no se cambia el signo de ningún movimiento).
// Otros movimientos = todo lo demás EXCEPTO COMPRA/TRANSF/VENTA/INICIAL
// (INICIAL son ajustes de apertura, no actividad de la semana — igual suman
// al saldo corrido pero no se listan como "movimiento").
// Para SD (a diferencia de FC) no se separa Transferencia ni FC Teórico —
// solo se aparta la Compra, todo lo demás (incluida VENTA y TRANSF) va junto
// a Otros Movimientos.
function calcularSemanaEficiencia(docs, esSD) {
  const porTipo = {};
  docs.forEach(d => { porTipo[d.movimiento] = (porTipo[d.movimiento] || 0) + d.importe; });
  const totalTodos = docs.reduce((s, d) => s + d.importe, 0);

  const compra = porTipo['COMPRA'] || 0;
  const excluidosOtros = esSD ? ['COMPRA', 'INICIAL'] : ['COMPRA', 'TRANSF', 'VENTA', 'INICIAL'];

  const otrosDetalle = {};
  let otrosTotal = 0;
  Object.entries(porTipo).forEach(([mov, importe]) => {
    if (excluidosOtros.includes(mov)) return;
    otrosDetalle[mov] = importe;
    otrosTotal += importe;
  });

  // Neteo de presentación SOBRA vs FALTA — la comparación es POR ÍTEM (o por
  // Grupo Compra si esa semana el Excel no trae ítem, semanas antiguas), no
  // sobre el total agregado de la semana: dentro de cada ítem, el mayor en
  // valor absoluto se queda con la suma de ambos, el otro pasa a cero (si son
  // iguales, ambos quedan en cero); luego se suman los resultados netos de
  // todos los ítems. La suma SOBRA+FALTA de cada ítem se preserva, así que
  // el total (otrosTotal/totalTodos/Inventario Final) no cambia.
  if ('SOBRA' in otrosDetalle || 'FALTA' in otrosDetalle) {
    const porClave = new Map(); // item (o "G|grupoCompra") -> { SOBRA, FALTA }
    docs.forEach(d => {
      if (d.movimiento !== 'SOBRA' && d.movimiento !== 'FALTA') return;
      const clave = d.item ? `${d.operacion}|${d.item}` : `G|${d.operacion}|${d.grupoCompra}`;
      if (!porClave.has(clave)) porClave.set(clave, { SOBRA: 0, FALTA: 0 });
      porClave.get(clave)[d.movimiento] += d.importe;
    });
    let netSobra = 0, netFalta = 0;
    porClave.forEach(({ SOBRA: sobra, FALTA: falta }) => {
      const absSobra = Math.abs(sobra), absFalta = Math.abs(falta);
      if (absSobra > absFalta) netSobra += sobra + falta;
      else if (absFalta > absSobra) netFalta += sobra + falta;
      // si son iguales, ese ítem no aporta nada a ninguna de las dos columnas
    });
    if ('SOBRA' in otrosDetalle) otrosDetalle['SOBRA'] = netSobra;
    if ('FALTA' in otrosDetalle) otrosDetalle['FALTA'] = netFalta;
  }

  if (esSD) {
    return { totalTodos, compra, ingresosAlmacen: compra, otrosTotal, otrosDetalle };
  }

  const transferencia = porTipo['TRANSF'] || 0;
  const ingresosAlmacen = compra + transferencia;
  const fcTeorico = porTipo['VENTA'] || 0;
  return { totalTodos, compra, transferencia, ingresosAlmacen, fcTeorico, otrosTotal, otrosDetalle };
}

function pct(num, den) { return den ? num / den : null; }

// ── GET /eficiencia?operacion=&semanaObjetivo=YYYYWW&nSemanas= ──────────────
// Eficiencia de consumo y compra de materiales: compara la compra/consumo
// teórico y real contra la Venta Neta AyB, semana a semana.
router.get('/eficiencia', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    const noAutorizada = operacionNoAutorizada(req.user, operaciones);
    if (noAutorizada) return res.status(403).json({ error: `Operación no autorizada: ${noAutorizada}` });

    const nSem = Math.min(Math.max(parseInt(req.query.nSemanas) || 8, 1), 104);
    // Nº de semanas para el % acumulado (variable) — se muestra junto al % semanal.
    const nSemPct = Math.min(Math.max(parseInt(req.query.nSemanasPct) || 4, 1), 52);
    // Por omisión se incluyen (comportamiento actual); "0"/"false" los excluye.
    const incluirEspeciales = req.query.incluirEspeciales !== '0' && req.query.incluirEspeciales !== 'false';
    const grupoParam = req.query.grupo === 'SD' ? 'SD' : 'FC';
    const esSD = grupoParam === 'SD';

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else { const hoy = new Date(); objetivo = { año: isoYear(hoy), semana: isoWeek(hoy) }; }

    // Rango extendido: nSem semanas a mostrar + (nSemPct-1) semanas previas
    // extra, para que la primera fila mostrada también tenga su ventana de
    // %-acumulado completa (mismo patrón que el Cuadro 2 anterior, pero con
    // nSemPct variable en vez de fijo en 4).
    const EXTRA = nSemPct - 1;
    const rango = [];
    for (let i = nSem - 1 + EXTRA; i >= 0; i--) rango.push(addSemanas(objetivo.año, objetivo.semana, -i));

    const primeraSemana = rango[0];
    const claveInicio = claveSemana(primeraSemana.año, primeraSemana.semana);

    // Venta (VentaCanalDiaria) — todos los canales suman como AyB.
    const rangoDesde = mondayOfIsoWeek(primeraSemana.año, primeraSemana.semana);
    const ultimaSemana = rango[rango.length - 1];
    const rangoHasta = new Date(mondayOfIsoWeek(ultimaSemana.año, ultimaSemana.semana));
    rangoHasta.setUTCDate(rangoHasta.getUTCDate() + 6);
    rangoHasta.setUTCHours(23, 59, 59, 999);

    const ventaDocs = await VentaCanalDiaria.find({
      operacion: { $in: operaciones }, fecha: { $gte: rangoDesde, $lte: rangoHasta },
    }).lean();
    const ventaPorSemana = {};
    ventaDocs.forEach(d => {
      const k = claveSemana(isoYear(d.fecha), isoWeek(d.fecha));
      if (!ventaPorSemana[k]) ventaPorSemana[k] = { ventaBruta: 0, ventaNeta: 0 };
      ventaPorSemana[k].ventaBruta += d.ventaBrutaMasRedencion || 0;
      ventaPorSemana[k].ventaNeta += d.ventaNetaMasRedencion || 0;
    });

    // Grupos especiales a excluir (checkbox "incluir" apagado) — la exclusión
    // es por (operación, grupoCompra), así que con varias operaciones (vista
    // por Sociedad) no se puede filtrar con un simple $nin de grupoCompra
    // (excluiría ese grupo en TODAS las operaciones aunque solo aplique a
    // una) — se resuelve como un Set de pares y se filtra en JS. Se aplica
    // tanto al Saldo Inicial base (histórico) como a las semanas mostradas,
    // para que el saldo corrido siga siendo consistente.
    let exclusionSet = null;
    if (!incluirEspeciales) {
      const excluidos = await GrupoCompraEspecial.find({ operacion: { $in: operaciones } }).lean();
      if (excluidos.length) exclusionSet = new Set(excluidos.map(e => `${e.operacion}|${e.grupoCompra}`));
    }
    const sinExcluidos = docs => exclusionSet ? docs.filter(d => !exclusionSet.has(`${d.operacion}|${d.grupoCompra}`)) : docs;

    // Movimientos: todo lo anterior a la primera semana del rango (para el
    // Saldo Inicial base) + las semanas del rango.
    const [previosDocsRaw, semanaDocsRaw] = await Promise.all([
      SeguimientoCompraMovimiento.find({
        operacion: { $in: operaciones }, grupo: grupoParam,
        $expr: { $lt: [{ $add: [{ $multiply: ['$año', 100] }, '$semana'] }, claveInicio] },
      }).lean(),
      SeguimientoCompraMovimiento.find({
        operacion: { $in: operaciones }, grupo: grupoParam,
        $or: rango.map(h => ({ año: h.año, semana: h.semana })),
      }).lean(),
    ]);
    const previosDocs = sinExcluidos(previosDocsRaw);
    const semanaDocs = sinExcluidos(semanaDocsRaw);

    const saldoInicialBase = previosDocs.reduce((s, d) => s + d.importe, 0);

    const movPorSemana = {};
    semanaDocs.forEach(d => {
      const k = claveSemana(d.año, d.semana);
      if (!movPorSemana[k]) movPorSemana[k] = [];
      movPorSemana[k].push(d);
    });

    let saldoInicial = saldoInicialBase;
    const filasExtendidas = rango.map(h => {
      const k = claveSemana(h.año, h.semana);
      const docs = movPorSemana[k] || [];
      const calc = calcularSemanaEficiencia(docs, esSD);

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
        ...(esSD ? {} : { transferencia: calc.transferencia }),
        ingresosAlmacen: calc.ingresosAlmacen,
        pctIngresosAlmacen: pct(calc.ingresosAlmacen, ventaNetaAyB),
        // Diferencia = Ingreso Real + FC Teórico (se suman, no se restan: FC
        // Teórico ya viene negativo en la fuente — sumarlo equivale a restar
        // su magnitud). El % se deriva del mismo importe (equivale a restar
        // el % de FC Teórico, ya que su signo también es negativo).
        ...(esSD ? {} : {
          fcTeorico: calc.fcTeorico,
          pctFcTeorico: pct(calc.fcTeorico, ventaNetaAyB),
          diferencia: calc.ingresosAlmacen + calc.fcTeorico,
          pctDiferencia: pct(calc.ingresosAlmacen + calc.fcTeorico, ventaNetaAyB),
        }),
        otrosTotal: calc.otrosTotal,
        otrosDetalle: calc.otrosDetalle,
        inventarioFinal,
        consumoTotal,
        pctConsumoTotal: pct(consumoTotal, ventaNetaAyB),
      };
    });

    // % acumulado de nSemPct semanas (semana actual + las nSemPct-1 anteriores),
    // sumando numerador y denominador antes de dividir (no promedio de %) —
    // calculado sobre el rango extendido para que las primeras filas mostradas
    // también tengan su ventana completa, aunque esas semanas previas no se
    // devuelvan como fila propia.
    filasExtendidas.forEach((fila, idx) => {
      const desde = Math.max(0, idx - (nSemPct - 1));
      const grupo = filasExtendidas.slice(desde, idx + 1);
      const denAcum = grupo.reduce((s, f) => s + f.ventaNetaAyB, 0);
      fila.pctIngresosAlmacenNSem = pct(grupo.reduce((s, f) => s + f.ingresosAlmacen, 0), denAcum);
      if (!esSD) {
        fila.pctFcTeoricoNSem = pct(grupo.reduce((s, f) => s + (f.fcTeorico || 0), 0), denAcum);
        const difAcum = grupo.reduce((s, f) => s + (f.diferencia || 0), 0);
        fila.diferenciaNSem = difAcum;
        fila.pctDiferenciaNSem = pct(difAcum, denAcum);
      }
      fila.pctConsumoTotalNSem = pct(grupo.reduce((s, f) => s + f.consumoTotal, 0), denAcum);
    });

    const filas = filasExtendidas.slice(EXTRA);

    res.json({ operaciones, objetivo, nSemPct, grupo: grupoParam, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /oc?operacion=&semanaObjetivo=YYYYWW — OC por Grupo de Compra ───────
// 3 semanas: la seleccionada, la anterior y la siguiente (la última columna
// es siempre la semana siguiente a semanaObjetivo) — una fila por
// grupoCompra, y por cada semana el importe de OC Normal, Adicional, Otra
// y el Total de las 3 (de la hoja OC del Excel).
router.get('/oc', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    const noAutorizada = operacionNoAutorizada(req.user, operaciones);
    if (noAutorizada) return res.status(403).json({ error: `Operación no autorizada: ${noAutorizada}` });
    const grupoParam = req.query.grupo === 'SD' ? 'SD' : 'FC';

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else { const hoy = new Date(); objetivo = { año: isoYear(hoy), semana: isoWeek(hoy) }; }

    const semanas = [-1, 0, 1].map(i => addSemanas(objetivo.año, objetivo.semana, i));

    // Venta Neta por semana (para la fila de % debajo de los totales) —
    // mismo criterio que /eficiencia: todos los canales suman como AyB.
    const primeraSemana = semanas[0], ultimaSemana = semanas[semanas.length - 1];
    const rangoDesde = mondayOfIsoWeek(primeraSemana.año, primeraSemana.semana);
    const rangoHasta = new Date(mondayOfIsoWeek(ultimaSemana.año, ultimaSemana.semana));
    rangoHasta.setUTCDate(rangoHasta.getUTCDate() + 6);
    rangoHasta.setUTCHours(23, 59, 59, 999);

    const [docs, ventaDocs, forecasts, operacionDocs] = await Promise.all([
      SeguimientoCompraOC.find({
        operacion: { $in: operaciones }, grupo: grupoParam,
        $or: semanas.map(h => ({ año: h.año, semana: h.semana })),
      }).lean(),
      VentaCanalDiaria.find({ operacion: { $in: operaciones }, fecha: { $gte: rangoDesde, $lte: rangoHasta } }).lean(),
      VentaForecast.find({ operacion: { $in: operaciones }, $or: semanas.map(h => ({ año: h.año, semana: h.semana })) }).lean(),
      Operacion.find({ codigo: { $in: operaciones } }).lean(),
    ]);

    const ventaNetaPorSemana = {};
    ventaDocs.forEach(d => {
      const k = claveSemana(isoYear(d.fecha), isoWeek(d.fecha));
      ventaNetaPorSemana[k] = (ventaNetaPorSemana[k] || 0) + (d.ventaNetaMasRedencion || 0);
    });

    // Pronóstico de Venta (monto): Venta Neta Propuesta total de todos los
    // canales (histórico + manual) — mismo criterio que "Pronóstico de Venta":
    // Venta Bruta = suma por canal de (cantidad de todos los días) × ticket
    // propuesto, más el importe de los canales manuales (ej. COMERCIAL); y
    // Venta Neta = Venta Bruta / (1 + IGV% + RC%) de CADA operación — el IGV%/
    // RC% se define por operación, así que con varias (vista por Sociedad) se
    // neta cada una con su propio divisor antes de sumar.
    const igvRcPorOp = Object.fromEntries(operacionDocs.map(o => [o.codigo, { igvPct: o.igvPct || 0, rcPct: o.rcPct || 0 }]));
    const pronosticoPorSemana = {};
    forecasts.forEach(fc => {
      const k = claveSemana(fc.año, fc.semana);
      const bruta = (fc.canales || []).reduce((s, c) => {
        if (c.esManual) return s + (c.montoManual || 0);
        const sumaDias = (c.dias || []).reduce((a, d) => a + (d.cantidad || 0), 0);
        return s + sumaDias * (c.ticketPropuesto || 0);
      }, 0);
      const { igvPct = 0, rcPct = 0 } = igvRcPorOp[fc.operacion] || {};
      const divisorNeta = 1 + igvPct + rcPct;
      const neta = divisorNeta ? bruta / divisorNeta : bruta;
      pronosticoPorSemana[k] = (pronosticoPorSemana[k] || 0) + neta;
    });

    const grupos = new Map(); // grupoCompra -> { claveSemana: { NORMAL, ADICIONAL, OTRA } }
    docs.forEach(d => {
      if (!grupos.has(d.grupoCompra)) grupos.set(d.grupoCompra, {});
      const k = claveSemana(d.año, d.semana);
      if (!grupos.get(d.grupoCompra)[k]) grupos.get(d.grupoCompra)[k] = { NORMAL: 0, ADICIONAL: 0, OTRA: 0 };
      grupos.get(d.grupoCompra)[k][d.claseOC] = (grupos.get(d.grupoCompra)[k][d.claseOC] || 0) + d.importeOC;
    });

    const filas = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([grupoCompra, porSemana]) => ({
      grupoCompra,
      porSemana: Object.fromEntries(semanas.map(h => {
        const k = claveSemana(h.año, h.semana);
        const v = porSemana[k] || { NORMAL: 0, ADICIONAL: 0, OTRA: 0 };
        return [k, v];
      })),
    }));

    const ventaNeta = Object.fromEntries(semanas.map(h => {
      const k = claveSemana(h.año, h.semana);
      return [k, ventaNetaPorSemana[k] || 0];
    }));
    const pronosticoVenta = Object.fromEntries(semanas.map(h => {
      const k = claveSemana(h.año, h.semana);
      return [k, pronosticoPorSemana[k] || 0];
    }));

    res.json({ operaciones, grupo: grupoParam, semanas, filas, ventaNeta, pronosticoVenta });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /detalle-semana?operacion=&semanaObjetivo=YYYYWW&grupo=FC|SD ────────
// Detalle del movimiento logístico de una sola semana, columnas = cada tipo
// de MOVIMIENTO presente esa semana. Filas: la fuente solo trae el código de
// Item (campo "item") en las semanas más recientes — cuando viene poblado se
// agrupa por Item (con su descripción resuelta contra el catálogo Item de
// esa operación); para semanas antiguas sin ese dato se agrupa por
// grupoCompra (Familia), como antes.
router.get('/detalle-semana', async (req, res) => {
  try {
    const operaciones = operacionesFromQuery(req);
    if (!operaciones.length) return res.status(400).json({ error: 'Operación requerida' });
    const noAutorizada = operacionNoAutorizada(req.user, operaciones);
    if (noAutorizada) return res.status(403).json({ error: `Operación no autorizada: ${noAutorizada}` });
    const grupoParam = req.query.grupo === 'SD' ? 'SD' : 'FC';
    const multiOp = operaciones.length > 1;

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else { const hoy = new Date(); objetivo = { año: isoYear(hoy), semana: isoWeek(hoy) }; }

    const docs = await SeguimientoCompraMovimiento.find({
      operacion: { $in: operaciones }, grupo: grupoParam, año: objetivo.año, semana: objetivo.semana,
    }).lean();

    // La clave siempre incluye la operación — el código de Item (y también
    // Grupo Compra, en teoría) está scoped por operación, así que con varias
    // operaciones (vista por Sociedad) un mismo código en 2 operaciones
    // distintas NO debe mezclarse en la misma fila.
    const porFila = new Map(); // key (op+ITEM|codigo o op+GRUPO|grupoCompra) -> { tipo, operacion, item, grupoCompra, porMov }
    const movimientosSet = new Set();
    const itemCodesPorOp = new Map(); // operacion -> Set(item)
    docs.forEach(d => {
      movimientosSet.add(d.movimiento);
      const usaItem = !!d.item;
      if (usaItem) {
        if (!itemCodesPorOp.has(d.operacion)) itemCodesPorOp.set(d.operacion, new Set());
        itemCodesPorOp.get(d.operacion).add(d.item);
      }
      const key = usaItem ? `${d.operacion}|ITEM|${d.item}` : `${d.operacion}|GRUPO|${d.grupoCompra}`;
      if (!porFila.has(key)) porFila.set(key, { tipo: usaItem ? 'item' : 'grupo', operacion: d.operacion, item: d.item, grupoCompra: d.grupoCompra, porMov: {} });
      const fila = porFila.get(key);
      fila.porMov[d.movimiento] = (fila.porMov[d.movimiento] || 0) + d.importe;
    });

    const nombresPorOpItem = {}; // "operacion|item" -> nombre
    if (itemCodesPorOp.size) {
      const or = [...itemCodesPorOp.entries()].map(([operacion, codigos]) => ({ operacion, item: { $in: [...codigos] } }));
      const itemsDb = await Item.find({ $or: or }).lean();
      itemsDb.forEach(i => { nombresPorOpItem[`${i.operacion}|${i.item}`] = i.nombre; });
    }

    const prefijoOp = f => multiOp ? `${f.operacion} · ` : '';
    const movimientos = [...movimientosSet].sort();
    const filas = [...porFila.values()]
      .map(f => {
        const nombre = f.tipo === 'item' ? (nombresPorOpItem[`${f.operacion}|${f.item}`] || '') : null;
        return {
          operacion: f.operacion,
          item: f.tipo === 'item' ? f.item : null,
          grupoCompra: f.tipo === 'item' ? null : f.grupoCompra,
          descripcion: nombre,
          label: f.tipo === 'item' ? `${prefijoOp(f)}${f.item} - ${nombre || 'Sin descripción'}` : `${prefijoOp(f)}${f.grupoCompra}`,
          porMovimiento: Object.fromEntries(movimientos.map(m => [m, f.porMov[m] || 0])),
          total: movimientos.reduce((s, m) => s + (f.porMov[m] || 0), 0),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    res.json({ operaciones, grupo: grupoParam, objetivo, movimientos, filas, porItem: filas.some(f => f.item !== null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

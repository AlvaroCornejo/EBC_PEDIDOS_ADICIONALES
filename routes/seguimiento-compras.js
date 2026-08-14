const express = require('express');
const auth = require('../middleware/auth');

const SeguimientoCompraMovimiento = require('../models/SeguimientoCompraMovimiento');
const SeguimientoCompraOC         = require('../models/SeguimientoCompraOC');
const SeguimientoCompraPedidoTienda = require('../models/SeguimientoCompraPedidoTienda');
const SeguimientoCompraAprobacion   = require('../models/SeguimientoCompraAprobacion');
const VentaCanalDiaria = require('../models/VentaCanalDiaria');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolSeguimientoCompras) return next();
  return res.status(403).json({ error: 'Sin acceso a Aprobación y Seguimiento de Compras' });
}
router.use(requireAccess);

function puedeCargar(user) {
  return user.role === 'ADMIN' || user.rolSeguimientoCompras === 'carga' || user.rolSeguimientoCompras === 'admin';
}
function puedeAprobar(user) {
  return user.role === 'ADMIN' || user.rolSeguimientoCompras === 'aprobacion' || user.rolSeguimientoCompras === 'admin';
}

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

// ── GET /familias?operacion= ───────────────────────────────────────────────────
router.get('/familias', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const familias = await SeguimientoCompraOC.distinct('grupoCompra', { operacion });
    res.json(familias.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /compras?operacion=&año=&semana= — Cuadro 1: Compras/OC por Familia ──
router.get('/compras', async (req, res) => {
  try {
    const { operacion } = req.query;
    const año = parseInt(req.query.año), semana = parseInt(req.query.semana);
    if (!operacion || !año || !semana) return res.status(400).json({ error: 'Operación, año y semana requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const semAnt = addSemanas(año, semana, -1);

    const [ocSel, ocAnt, movAnt, pedidosSel, aprobAnt] = await Promise.all([
      SeguimientoCompraOC.find({ operacion, año, semana }).lean(),
      SeguimientoCompraOC.find({ operacion, año: semAnt.año, semana: semAnt.semana }).lean(),
      SeguimientoCompraMovimiento.find({
        operacion, año: semAnt.año, semana: semAnt.semana,
        movimiento: { $in: ['COMPRA', 'TRANSFERENCIA'] },
      }).lean(),
      SeguimientoCompraPedidoTienda.find({ operacion, año, semana }).lean(),
      SeguimientoCompraAprobacion.find({ operacion, año: semAnt.año, semana: semAnt.semana }).lean(),
    ]);

    const familias = new Set([
      ...ocSel.map(d => d.grupoCompra),
      ...ocAnt.map(d => d.grupoCompra),
      ...movAnt.map(d => d.grupoCompra),
      ...pedidosSel.map(d => d.grupoCompra),
    ]);

    const pedidoPorFamilia = Object.fromEntries(pedidosSel.map(p => [p.grupoCompra, p.monto]));
    const aprobPorFamilia = Object.fromEntries(aprobAnt.map(a => [a.grupoCompra, a.montoAprobado]));

    const filas = [...familias].sort().map(familia => {
      const ocSelFam = ocSel.filter(d => d.grupoCompra === familia);
      const ocAntFam = ocAnt.filter(d => d.grupoCompra === familia);
      const movAntFam = movAnt.filter(d => d.grupoCompra === familia);

      const pedidoTienda = pedidoPorFamilia[familia] || 0;
      const ocAprobadaSel = ocSelFam.reduce((s, d) => s + d.importeOC, 0);
      const ocPedido = ocAprobadaSel - pedidoTienda;

      const ocNormal   = ocAntFam.filter(d => d.claseOC === 'NORMAL').reduce((s, d) => s + d.importeOC, 0);
      const ocAdicional = ocAntFam.filter(d => d.claseOC === 'ADICIONAL').reduce((s, d) => s + d.importeOC, 0);
      const ocOtros     = ocAntFam.filter(d => d.claseOC === 'OTRA').reduce((s, d) => s + d.importeOC, 0);
      const ocTotal = ocNormal + ocAdicional + ocOtros;
      const compraReal = movAntFam.reduce((s, d) => s + d.importe, 0);
      const diferencia = compraReal - ocTotal;

      return {
        grupoCompra: familia,
        semanaSeleccionada: { año, semana, pedidoTienda, ocAprobada: ocAprobadaSel, ocPedido },
        semanaAnterior: {
          año: semAnt.año, semana: semAnt.semana,
          ocAprobada: familia in aprobPorFamilia ? aprobPorFamilia[familia] : null,
          ocNormal, ocAdicional, ocOtros, ocTotal, compraReal, diferencia,
        },
      };
    });

    res.json({ operacion, semanaSeleccionada: { año, semana }, semanaAnterior: semAnt, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /pedido-tienda — registro manual (upsert) ─────────────────────────────
router.put('/pedido-tienda', async (req, res) => {
  try {
    if (!puedeCargar(req.user)) return res.status(403).json({ error: 'Sin permiso para registrar Pedido Tienda' });
    const { operacion, grupoCompra, año, semana, monto } = req.body;
    if (!operacion || !grupoCompra || !año || !semana) {
      return res.status(400).json({ error: 'Operación, familia, año y semana requeridos' });
    }
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const doc = await SeguimientoCompraPedidoTienda.findOneAndUpdate(
      { operacion, grupoCompra, año, semana },
      { operacion, grupoCompra, año, semana, monto: Number(monto) || 0, registradoPor: req.user.username, registradoEn: new Date() },
      { upsert: true, new: true }
    );
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /aprobar {operacion, año, semana} — congela TODAS las familias ──────
router.post('/aprobar', async (req, res) => {
  try {
    if (!puedeAprobar(req.user)) return res.status(403).json({ error: 'Sin permiso para aprobar' });
    const { operacion } = req.body;
    const año = parseInt(req.body.año), semana = parseInt(req.body.semana);
    if (!operacion || !año || !semana) return res.status(400).json({ error: 'Operación, año y semana requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const ocDocs = await SeguimientoCompraOC.find({ operacion, año, semana }).lean();
    const porFamilia = {};
    ocDocs.forEach(d => { porFamilia[d.grupoCompra] = (porFamilia[d.grupoCompra] || 0) + d.importeOC; });

    const familias = Object.keys(porFamilia);
    if (!familias.length) return res.status(400).json({ error: 'No hay datos de OC para esa operación/semana' });

    await Promise.all(familias.map(grupoCompra => SeguimientoCompraAprobacion.findOneAndUpdate(
      { operacion, grupoCompra, año, semana },
      { operacion, grupoCompra, año, semana, montoAprobado: porFamilia[grupoCompra], aprobadoPor: req.user.username, aprobadoEn: new Date() },
      { upsert: true, new: true }
    )));

    res.json({ ok: true, familiasAprobadas: familias.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers de cálculo del Cuadro 2 ─────────────────────────────────────────

const MOV_VENTA = 'VENTA', MOV_CONSUMOS = 'CONSUMOS', MOV_FALTANTE = 'FALTANTE',
      MOV_SOBRANTE = 'SOBRANTE', MOV_COMPRA = 'COMPRA', MOV_TRANSFERENCIA = 'TRANSFERENCIA',
      MOV_BAJA = 'BAJA', MOV_MERMA = 'MERMA', MOV_INICIAL = 'INICIAL';
const MOV_PROD_TRANSFER = ['PRODUCCION', 'TRANSFORMACION', 'CONSUMO PRODUCCION', 'CONSUMO TRANSFORMACION'];

function calcularSemanaMovimientos(docs) {
  const sum = (pred) => docs.filter(pred).reduce((s, d) => s + d.importe, 0);
  const totalTodos = docs.reduce((s, d) => s + d.importe, 0);
  const totalNoInicial = sum(d => d.movimiento !== MOV_INICIAL);

  const compra = sum(d => d.movimiento === MOV_COMPRA);
  const transferencias = sum(d => d.movimiento === MOV_TRANSFERENCIA);
  const compraTotal = compra + transferencias;
  const ventaSigned = sum(d => d.movimiento === MOV_VENTA);
  const consumosSigned = sum(d => d.movimiento === MOV_CONSUMOS);
  const faltanteSigned = sum(d => d.movimiento === MOV_FALTANTE);
  const sobrante = sum(d => d.movimiento === MOV_SOBRANTE);
  const bajasYMermasSigned = sum(d => d.movimiento === MOV_BAJA || d.movimiento === MOV_MERMA);
  const prodYTransfer = sum(d => MOV_PROD_TRANSFER.includes(d.movimiento));

  const fcTeorico = Math.abs(ventaSigned);
  const consumos = Math.abs(consumosSigned);
  const faltantes = Math.abs(faltanteSigned);
  const bajasYMermas = Math.abs(bajasYMermasSigned);

  const otrosMovim = totalNoInicial - (compra + transferencias + ventaSigned + consumosSigned + faltanteSigned + sobrante + bajasYMermasSigned + prodYTransfer);

  return { totalTodos, compra, transferencias, compraTotal, fcTeorico, consumos, faltantes, sobrante, bajasYMermas, prodYTransfer, otrosMovim };
}

function pct(num, den) { return den ? num / den : null; }

// ── GET /resumen-semanal?operacion=&semanaObjetivo=YYYYWW&nSemanas= — Cuadro 2 ──
router.get('/resumen-semanal', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const nSem = Math.min(Math.max(parseInt(req.query.nSemanas) || 8, 1), 104);

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else { const hoy = new Date(); objetivo = { año: isoYear(hoy), semana: isoWeek(hoy) }; }

    // Semanas a mostrar + 3 previas extra (para el acumulado de "4 semanas" de la primera fila mostrada)
    const EXTRA = 3;
    const rango = []; // extendido: incluye las EXTRA semanas previas + las nSem a mostrar
    for (let i = nSem - 1 + EXTRA; i >= 0; i--) rango.push(addSemanas(objetivo.año, objetivo.semana, -i));

    const primeraSemana = rango[0];
    const claveInicio = claveSemana(primeraSemana.año, primeraSemana.semana);

    // Venta (VentaCanalDiaria)
    const rangoDesde = mondayOfIsoWeek(primeraSemana.año, primeraSemana.semana);
    const ultimaSemana = rango[rango.length - 1];
    const rangoHasta = new Date(mondayOfIsoWeek(ultimaSemana.año, ultimaSemana.semana));
    rangoHasta.setUTCDate(rangoHasta.getUTCDate() + 6);
    rangoHasta.setUTCHours(23, 59, 59, 999);

    const ventaDocs = await VentaCanalDiaria.find({
      operacion, fecha: { $gte: rangoDesde, $lte: rangoHasta },
    }).lean();
    const ventaPorSemana = {}; // claveSemana -> { ventaBrutaMasRedencion, ventaNetaMasRedencion }
    ventaDocs.forEach(d => {
      const iy = isoYear(d.fecha), iw = isoWeek(d.fecha);
      const k = claveSemana(iy, iw);
      if (!ventaPorSemana[k]) ventaPorSemana[k] = { ventaBrutaMasRedencion: 0, ventaNetaMasRedencion: 0 };
      ventaPorSemana[k].ventaBrutaMasRedencion += d.ventaBrutaMasRedencion || 0;
      ventaPorSemana[k].ventaNetaMasRedencion += d.ventaNetaMasRedencion || 0;
    });

    // Movimientos: todo lo anterior a la primera semana del rango extendido (para Inv. Inicial base) + semanas del rango
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

    const invInicialBase = previosDocs.reduce((s, d) => s + d.importe, 0);

    const movPorSemana = {}; // claveSemana -> docs[]
    semanaDocs.forEach(d => {
      const k = claveSemana(d.año, d.semana);
      if (!movPorSemana[k]) movPorSemana[k] = [];
      movPorSemana[k].push(d);
    });

    let invInicial = invInicialBase;
    const filasExtendidas = rango.map(h => {
      const k = claveSemana(h.año, h.semana);
      const docs = movPorSemana[k] || [];
      const calc = calcularSemanaMovimientos(docs);

      const invInicialSemana = invInicial;
      const invFinal = invInicialSemana + calc.totalTodos;
      const varInv = invFinal - invInicialSemana;
      const costoDeVenta = invInicialSemana + calc.compraTotal - invFinal;
      invInicial = invFinal;

      const venta = ventaPorSemana[k] || { ventaBrutaMasRedencion: 0, ventaNetaMasRedencion: 0 };
      const ventaNeta = venta.ventaNetaMasRedencion;

      return {
        año: h.año, semana: h.semana,
        ventaBruta: venta.ventaBrutaMasRedencion,
        ventaNeta,
        vnAyB: ventaNeta,
        compra: calc.compra,
        transferencias: calc.transferencias,
        compraTotal: calc.compraTotal,
        fcTeorico: calc.fcTeorico,
        consumos: calc.consumos,
        faltantes: calc.faltantes,
        sobrante: calc.sobrante,
        bajasYMermas: calc.bajasYMermas,
        prodYTransfer: calc.prodYTransfer,
        otrosMovim: calc.otrosMovim,
        invInicial: invInicialSemana,
        invFinal,
        varInv,
        costoDeVenta,
      };
    });

    // % acumulado 4 semanas (semana actual + 3 anteriores), sumando numerador y denominador —
    // calculado sobre el rango extendido para que las primeras filas mostradas también tengan
    // sus 3 semanas previas disponibles, aunque no se muestren como fila propia.
    filasExtendidas.forEach((fila, idx) => {
      const desde = Math.max(0, idx - 3);
      const grupo = filasExtendidas.slice(desde, idx + 1);
      const denAcum = grupo.reduce((s, f) => s + f.ventaNeta, 0);
      fila.pctIngresoAlmacenSemana = pct(fila.compraTotal, fila.ventaNeta);
      fila.pctFcTeoricoSemana = pct(fila.fcTeorico, fila.ventaNeta);
      fila.pctCvRealSemana = pct(fila.costoDeVenta, fila.ventaNeta);
      fila.pctIngresoAlmacen4Sem = pct(grupo.reduce((s, f) => s + f.compraTotal, 0), denAcum);
      fila.pctFcTeorico4Sem = pct(grupo.reduce((s, f) => s + f.fcTeorico, 0), denAcum);
      fila.pctCvReal4Sem = pct(grupo.reduce((s, f) => s + f.costoDeVenta, 0), denAcum);
    });

    const filas = filasExtendidas.slice(EXTRA);

    res.json({ operacion, objetivo, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const authMiddleware   = require('../middleware/auth');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria         = require('../models/CajaDiaria');

const router = express.Router();
router.use(authMiddleware);

const TOL = 0.5;
const MAX_LOOKBACK = 20;   // dias maximos hacia atras al buscar un deposito
const MAX_DIAS_BANCO = 6;  // dias maximos desde el deposito hasta que aparezca en el EECC

function canAccess(user) {
  return user.role === 'ADMIN' || !!user.accesoConciliacion;
}

function sociedadesAutorizadas(user) {
  return user.role === 'ADMIN' ? null : (user.sociedadesConciliacion || []);
}

function checkSociedad(user, sociedad) {
  const auth = sociedadesAutorizadas(user);
  if (auth === null) return true; // admin
  return auth.includes(sociedad);
}

const ymd = d => d.toISOString().slice(0, 10);

// ─── GET /config — lista de configuraciones (solo ADMIN) ─────────────────
router.get('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const configs = await ConciliacionConfig.find({}).sort({ sociedad: 1 });
    res.json(configs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /config/:sociedad — crear/actualizar ruta de archivos (solo ADMIN) ──
router.put('/config/:sociedad', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { sociedad } = req.params;
    const { rutaEECC, rutaCobranza, rutaTC } = req.body;
    const cfg = await ConciliacionConfig.findOneAndUpdate(
      { sociedad },
      { $set: {
          ...(rutaEECC     !== undefined && { rutaEECC }),
          ...(rutaCobranza !== undefined && { rutaCobranza }),
          ...(rutaTC       !== undefined && { rutaTC }),
        } },
      { new: true, upsert: true }
    );
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /sociedades — sociedades disponibles para el usuario ────────────
router.get('/sociedades', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const todas = (await ConciliacionConfig.distinct('sociedad')).sort();
    const auth = sociedadesAutorizadas(req.user);
    res.json(auth === null ? todas : todas.filter(s => auth.includes(s)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Helpers de conciliación ───────────────────────────────────────────

// Empareja depositos (CAJA) contra la suma de dias consecutivos de efectivo+tip(+vuelto)
function matchDeposits(cajaRows, { efField, tipField, vueltoField, depField }) {
  const sorted = [...cajaRows].sort((a, b) => a.fecha - b.fecha);
  let unconsumed = []; // { fecha, monto }
  const resultados = [];

  function tryMatch(queue, target, includeLast) {
    const startIdx = includeLast ? queue.length - 1 : queue.length - 2;
    if (startIdx < 0) return null;
    let cum = 0;
    const dias = [];
    for (let idx = startIdx; idx >= 0 && dias.length < MAX_LOOKBACK; idx--) {
      cum += queue[idx].monto;
      dias.unshift(queue[idx].fecha);
      if (Math.abs(cum - target) < TOL) {
        const remaining = queue.slice(0, idx).concat(queue.slice(startIdx + 1));
        return { dias, remaining, total: cum };
      }
    }
    return null;
  }

  sorted.forEach(row => {
    const montoDia = (row[efField] || 0) + (row[tipField] || 0) + (vueltoField ? (row[vueltoField] || 0) : 0);
    unconsumed.push({ fecha: row.fecha, monto: montoDia });

    const dep = row[depField];
    if (dep === null || dep === undefined) return;
    const target = Math.abs(dep);

    let m = tryMatch(unconsumed, target, true) || tryMatch(unconsumed, target, false);
    if (m) {
      resultados.push({ fecha: row.fecha, deposito: dep, dias: m.dias, ok: true, diferencia: 0, sumaDias: m.total });
      unconsumed = m.remaining;
    } else {
      resultados.push({ fecha: row.fecha, deposito: dep, dias: null, ok: false, diferencia: null, sumaDias: null });
    }
  });

  return resultados;
}

// Busca el deposito (monto absoluto) en el EECC del banco, dentro de una ventana de dias posteriores
function matchEnBanco(depositos, eeccRows) {
  return depositos.map(d => {
    const target = Math.abs(d.deposito);
    const candidatos = eeccRows.filter(e =>
      e.importe > 0 &&
      Math.abs(e.importe - target) < TOL &&
      e.fechaOperacion >= d.fecha &&
      (e.fechaOperacion - d.fecha) / 86400000 <= MAX_DIAS_BANCO
    );
    const match = candidatos[0] || null;
    return {
      ...d,
      banco: match ? { fecha: match.fechaOperacion, importe: match.importe, concepto: match.concepto, banco: match.banco } : null,
      okBanco: !!match,
    };
  });
}

// ─── GET /check1 — COBRANZA ERP (Efectivo) vs CAJA.COBRANZA_EFECTIVO(_USD), por dia ──
router.get('/check1', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    const erpRows = await CobranzaErp.find({
      sociedad, medioPago: 'Efectivo', fecha: { $gte: fechaDesde, $lte: fechaHasta },
    });
    const cajaRows = await CajaDiaria.find({
      sociedad, fecha: { $gte: fechaDesde, $lte: fechaHasta },
    });

    const erpPorDia = {}; // ymd -> { sol, usd }
    const tcPorDia = {};  // ymd -> { suma, count } tipo de cambio del dia (COBRANZA ERP)
    erpRows.forEach(r => {
      const k = ymd(r.fecha);
      if (!erpPorDia[k]) erpPorDia[k] = { sol: 0, usd: 0 };
      if (r.moneda === 'Soles') erpPorDia[k].sol += r.cobranzaMoneda;
      else erpPorDia[k].usd += r.cobranzaMoneda;
      if (r.tipoCambio) {
        if (!tcPorDia[k]) tcPorDia[k] = { suma: 0, count: 0 };
        tcPorDia[k].suma += r.tipoCambio;
        tcPorDia[k].count++;
      }
    });

    const dias = cajaRows
      .sort((a, b) => a.fecha - b.fecha)
      .map(c => {
        const k = ymd(c.fecha);
        const erp = erpPorDia[k] || { sol: 0, usd: 0 };
        const tcInfo = tcPorDia[k];
        const tc = tcInfo ? tcInfo.suma / tcInfo.count : null;
        const vueltoUsd = (c.vueltoSoles && tc) ? c.vueltoSoles / tc : 0;
        const difSol = (c.cobranzaEfectivo || 0) - erp.sol;
        const difUsd = (c.cobranzaEfectivoUsd || 0) - erp.usd + vueltoUsd;
        return {
          fecha: k,
          cajaSol: c.cobranzaEfectivo || 0, erpSol: erp.sol, difSol, okSol: Math.abs(difSol) < TOL,
          cajaUsd: c.cobranzaEfectivoUsd || 0, erpUsd: erp.usd, vueltoUsd, difUsd, okUsd: Math.abs(difUsd) < TOL,
        };
      });

    res.json({ dias });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /check2 — DEPOSITO_PEN/USD vs suma de dias de efectivo+tip(+vuelto) ──
router.get('/check2', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    // Traer un margen de dias previos (MAX_LOOKBACK) para poder sumar hacia atras
    const fechaConMargen = new Date(fechaDesde.getTime() - MAX_LOOKBACK * 86400000);
    const cajaRows = await CajaDiaria.find({
      sociedad, fecha: { $gte: fechaConMargen, $lte: fechaHasta },
    });

    const pen = matchDeposits(cajaRows, { efField: 'cobranzaEfectivo', tipField: 'tipEfectivo', vueltoField: 'vueltoSoles', depField: 'depositoPen' })
      .filter(d => d.fecha >= fechaDesde);
    const usd = matchDeposits(cajaRows, { efField: 'cobranzaEfectivoUsd', tipField: 'tipUsd', vueltoField: null, depField: 'depositoUsd' })
      .filter(d => d.fecha >= fechaDesde);

    const fmt = arr => arr.map(d => ({
      fecha: ymd(d.fecha), deposito: d.deposito,
      dias: d.dias ? d.dias.map(ymd) : null,
      ok: d.ok, diferencia: d.diferencia, sumaDias: d.sumaDias,
    }));

    res.json({ pen: fmt(pen), usd: fmt(usd) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /check3 — Deposito (CAJA) vs movimiento bancario (EECC) ─────────
router.get('/check3', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);
    const fechaConMargen = new Date(fechaDesde.getTime() - MAX_LOOKBACK * 86400000);
    const fechaHastaMargen = new Date(fechaHasta.getTime() + MAX_DIAS_BANCO * 86400000);

    const cajaRows = await CajaDiaria.find({
      sociedad, fecha: { $gte: fechaConMargen, $lte: fechaHasta },
    });
    const eeccSol = await EeccMovimiento.find({ sociedad, moneda: 'SOL', fechaOperacion: { $gte: fechaConMargen, $lte: fechaHastaMargen } });
    const eeccUsd = await EeccMovimiento.find({ sociedad, moneda: 'USD', fechaOperacion: { $gte: fechaConMargen, $lte: fechaHastaMargen } });

    const depPen = cajaRows.filter(c => c.depositoPen !== null && c.depositoPen !== undefined && c.fecha >= fechaDesde)
      .map(c => ({ fecha: c.fecha, deposito: c.depositoPen }));
    const depUsd = cajaRows.filter(c => c.depositoUsd !== null && c.depositoUsd !== undefined && c.fecha >= fechaDesde)
      .map(c => ({ fecha: c.fecha, deposito: c.depositoUsd }));

    const fmt = arr => arr.map(d => ({
      fecha: ymd(d.fecha), deposito: d.deposito, okBanco: d.okBanco,
      banco: d.banco ? { fecha: ymd(d.banco.fecha), importe: d.banco.importe, concepto: d.banco.concepto, banco: d.banco.banco } : null,
    }));

    res.json({ pen: fmt(matchEnBanco(depPen, eeccSol)), usd: fmt(matchEnBanco(depUsd, eeccUsd)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

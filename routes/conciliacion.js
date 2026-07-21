const express = require('express');
const authMiddleware   = require('../middleware/auth');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria         = require('../models/CajaDiaria');

const router = express.Router();
router.use(authMiddleware);

const TOL = 0.5;
const TOL_DEP_PEN = 10;    // tolerancia para conciliar depositos en soles
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
function matchDeposits(cajaRows, { efField, tipField, vueltoField, depField, tol = TOL }) {
  const sorted = [...cajaRows].sort((a, b) => a.fecha - b.fecha);
  // unconsumed guarda, por dia, el desglose (ef/tip/vuelto) ademas del monto total
  let unconsumed = []; // { fecha, monto, ef, tip, vuelto }
  const resultados = [];      // resultado final, en orden (placeholders para los no emparejados)
  const sinMatch = [];        // depositos que no encontraron match, para la 2da pasada

  // skip=0: incluye el dia del deposito; skip=1: desde el dia anterior; skip=2: desde 2 dias antes
  function tryMatch(queue, target, skip) {
    const startIdx = queue.length - 1 - skip;
    if (startIdx < 0) return null;
    let cum = 0, sumEf = 0, sumTip = 0, sumVuelto = 0;
    const dias = [];
    for (let idx = startIdx; idx >= 0 && dias.length < MAX_LOOKBACK; idx--) {
      cum += queue[idx].monto;
      sumEf += queue[idx].ef; sumTip += queue[idx].tip; sumVuelto += queue[idx].vuelto;
      dias.unshift(queue[idx].fecha);
      if (Math.abs(cum - target) < tol) {
        const remaining = queue.slice(0, idx).concat(queue.slice(startIdx + 1));
        return { dias, remaining, total: cum, sumEf, sumTip, sumVuelto };
      }
    }
    return null;
  }

  // 1ra pasada: solo matching real (los depositos que no matchean NO consumen dias,
  // para que un deposito futuro los pueda usar).
  sorted.forEach(row => {
    const ef = row[efField] || 0;
    const tip = row[tipField] || 0;
    const vuelto = vueltoField ? (row[vueltoField] || 0) : 0;
    unconsumed.push({ fecha: row.fecha, monto: ef + tip + vuelto, ef, tip, vuelto });

    const dep = row[depField];
    if (dep === null || dep === undefined) return;
    const target = Math.abs(dep);

    let m = tryMatch(unconsumed, target, 0) || tryMatch(unconsumed, target, 1) || tryMatch(unconsumed, target, 2);
    if (m) {
      resultados.push({
        fecha: row.fecha, deposito: dep, dias: m.dias, ok: true, diferencia: target - m.total, sumaDias: m.total,
        sumEf: m.sumEf, sumTip: m.sumTip, sumVuelto: vueltoField ? m.sumVuelto : null,
      });
      unconsumed = m.remaining;
    } else {
      const placeholder = { fecha: row.fecha, deposito: dep, target };
      resultados.push(placeholder);
      sinMatch.push(placeholder);
    }
  });

  // 2da pasada: reparte los dias que quedaron SIN consumir por ningun match real
  // (`unconsumed` final, ya sin los dias que un deposito futuro sí logró usar) entre
  // los depositos sin match, en orden cronologico, para que cada dia aparezca una sola vez.
  let ptr = 0;
  sinMatch.forEach(placeholder => {
    let sumEf = 0, sumTip = 0, sumVuelto = 0, total = 0;
    const dias = [];
    while (ptr < unconsumed.length && unconsumed[ptr].fecha <= placeholder.fecha) {
      const e = unconsumed[ptr];
      sumEf += e.ef; sumTip += e.tip; sumVuelto += e.vuelto; total += e.monto;
      dias.push(e.fecha);
      ptr++;
    }
    placeholder.dias = dias;
    placeholder.ok = false;
    placeholder.sumaDias = total;
    placeholder.diferencia = placeholder.target - total;
    placeholder.sumEf = sumEf; placeholder.sumTip = sumTip;
    placeholder.sumVuelto = vueltoField ? sumVuelto : null;
    delete placeholder.target;
  });

  return resultados;
}

// Busca un monto especifico (importe positivo) en el EECC, desde `fecha` hacia adelante,
// excluyendo movimientos ya usados (`excluir`) para no reutilizar el mismo movimiento dos veces.
function buscarEnBanco(target, fecha, eeccRows, excluir) {
  if (Math.abs(target) < TOL) return { movimiento: null, ok: true, na: true }; // nada que buscar
  const candidato = eeccRows.find(e =>
    e !== excluir &&
    e.importe > 0 &&
    Math.abs(e.importe - target) < TOL &&
    e.fechaOperacion >= fecha &&
    (e.fechaOperacion - fecha) / 86400000 <= MAX_DIAS_BANCO
  );
  return { movimiento: candidato || null, ok: !!candidato, na: false };
}

// El deposito de CAJA (sumEf+sumTip+sumVuelto) puede llegar al banco como DOS movimientos
// separados (Efectivo y TIP); se busca cada uno por su lado, siempre en la misma fila por fecha.
function matchEnBanco(depositos, eeccRows) {
  return depositos.map(d => {
    const targetEf  = (d.sumEf || 0) + (d.sumVuelto || 0);
    const targetTip = d.sumTip || 0;
    const bEf  = buscarEnBanco(targetEf, d.fecha, eeccRows);
    const bTip = buscarEnBanco(targetTip, d.fecha, eeccRows, bEf.movimiento);
    const fmtMov = m => m ? { fecha: m.fechaOperacion, importe: m.importe, concepto: m.concepto, banco: m.banco } : null;
    return {
      ...d,
      targetEf, targetTip,
      bancoEf: fmtMov(bEf.movimiento), okEf: bEf.ok,
      bancoTip: fmtMov(bTip.movimiento), okTip: bTip.ok,
      okBanco: bEf.ok && bTip.ok,
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

    const pen = matchDeposits(cajaRows, { efField: 'cobranzaEfectivo', tipField: 'tipEfectivo', vueltoField: 'vueltoSoles', depField: 'depositoPen', tol: TOL_DEP_PEN })
      .filter(d => d.fecha >= fechaDesde);
    const usd = matchDeposits(cajaRows, { efField: 'cobranzaEfectivoUsd', tipField: 'tipUsd', vueltoField: null, depField: 'depositoUsd' })
      .filter(d => d.fecha >= fechaDesde);

    const fmt = arr => arr.map(d => ({
      fecha: ymd(d.fecha), deposito: d.deposito,
      dias: d.dias ? d.dias.map(ymd) : null,
      ok: d.ok, diferencia: d.diferencia, sumaDias: d.sumaDias,
      sumEf: d.sumEf, sumTip: d.sumTip, sumVuelto: d.sumVuelto,
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

    // Reutiliza el mismo desglose (Efectivo/Tip/Vuelto) que check2 para poder
    // buscar cada componente por separado en el EECC.
    const depPen = matchDeposits(cajaRows, { efField: 'cobranzaEfectivo', tipField: 'tipEfectivo', vueltoField: 'vueltoSoles', depField: 'depositoPen', tol: TOL_DEP_PEN })
      .filter(d => d.fecha >= fechaDesde);
    const depUsd = matchDeposits(cajaRows, { efField: 'cobranzaEfectivoUsd', tipField: 'tipUsd', vueltoField: null, depField: 'depositoUsd' })
      .filter(d => d.fecha >= fechaDesde);

    const fmtMov = m => m ? { fecha: ymd(m.fecha), importe: m.importe, concepto: m.concepto, banco: m.banco } : null;
    const fmt = arr => arr.map(d => ({
      fecha: ymd(d.fecha), deposito: d.deposito,
      targetEf: d.targetEf, targetTip: d.targetTip,
      bancoEf: fmtMov(d.bancoEf), okEf: d.okEf,
      bancoTip: fmtMov(d.bancoTip), okTip: d.okTip,
      okBanco: d.okBanco,
    }));

    res.json({ pen: fmt(matchEnBanco(depPen, eeccSol)), usd: fmt(matchEnBanco(depUsd, eeccUsd)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

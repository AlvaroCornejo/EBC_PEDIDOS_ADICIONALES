const express = require('express');
const authMiddleware   = require('../middleware/auth');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria         = require('../models/CajaDiaria');
const TcMovimiento       = require('../models/TcMovimiento');

const router = express.Router();
router.use(authMiddleware);

const TOL = 0.5;
const TOL_DEP_PEN = 10;    // tolerancia para conciliar depositos en soles
const MAX_LOOKBACK = 20;   // dias maximos hacia atras al buscar un deposito
const MAX_DIAS_BANCO = 6;  // dias maximos desde el deposito hasta que aparezca en el EECC
const MAX_DIAS_EVENTO = 15; // cheques/transferencias de eventos: puede aparecer en banco unos dias antes o despues

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
    // .lean() evita que Mongoose intente castear documentos antiguos (rutaEECC/etc. guardados
    // como String antes de pasar a [String]) al leerlos; se normalizan a mano abajo.
    const configs = await ConciliacionConfig.find({}).sort({ sociedad: 1 }).lean();
    const asArray = v => Array.isArray(v) ? v : (v ? [v] : []);
    configs.forEach(c => {
      c.rutaEECC = asArray(c.rutaEECC);
      c.rutaCobranza = asArray(c.rutaCobranza);
      c.rutaTC = asArray(c.rutaTC);
    });
    res.json(configs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /config/:sociedad — crear/actualizar ruta de archivos (solo ADMIN) ──
router.put('/config/:sociedad', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { sociedad } = req.params;
    const { rutaEECC, rutaCobranza, rutaTC } = req.body;
    const asArray = v => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : [];
    const cfg = await ConciliacionConfig.findOneAndUpdate(
      { sociedad },
      { $set: {
          ...(rutaEECC     !== undefined && { rutaEECC: asArray(rutaEECC) }),
          ...(rutaCobranza !== undefined && { rutaCobranza: asArray(rutaCobranza) }),
          ...(rutaTC       !== undefined && { rutaTC: asArray(rutaTC) }),
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

const CONCEPTO_DEPOSITO_EFECTIVO = 'INGRESO EN EFECTIVO';

// Busca un monto especifico (importe positivo) en el EECC, desde `fecha` hacia adelante,
// solo entre movimientos con concepto "INGRESO EN EFECTIVO". Excluye movimientos ya
// reservados en `usados` (compartido entre TODAS las busquedas de esta conciliacion,
// para que un mismo movimiento del banco jamas se use en mas de una conciliacion) y,
// opcionalmente, uno adicional (`excluirTambien`) para no reutilizarlo dentro del mismo
// deposito (ej. el match de Efectivo no puede volver a usarse para el de TIP).
function buscarEnBanco(target, fecha, eeccRows, usados, excluirTambien) {
  if (Math.abs(target) < TOL) return { movimiento: null, ok: true, na: true }; // nada que buscar
  const candidato = eeccRows.find(e =>
    !usados.has(e) &&
    e !== excluirTambien &&
    e.importe > 0 &&
    (e.concepto || '').trim().toUpperCase() === CONCEPTO_DEPOSITO_EFECTIVO &&
    Math.abs(e.importe - target) < TOL &&
    e.fechaOperacion >= fecha &&
    (e.fechaOperacion - fecha) / 86400000 <= MAX_DIAS_BANCO
  );
  return { movimiento: candidato || null, ok: !!candidato, na: false };
}

// El deposito de CAJA (sumEf+sumTip+sumVuelto) puede llegar al banco como DOS movimientos
// separados (Efectivo y TIP) — 1ra conciliacion — o como UN solo movimiento combinado
// por la suma de ambos — 2da conciliacion, si la primera no encuentra ambos componentes.
// Ademas, se listan los movimientos "INGRESO EN EFECTIVO" del EECC que no calzaron con
// ningun deposito de CAJA (posible ingreso bancario sin registrar en caja).
//
// INVARIANTE: un movimiento del EECC solo puede formar parte de UNA conciliacion. El Set
// `usados` se comparte entre TODAS las busquedas (no solo se llena despues del match, sino
// que se consulta EN cada busqueda) para que el deposito de un dia no pueda reclamar un
// movimiento que un deposito anterior ya reservo. Cuando se agregue la conciliacion de
// tarjetas/transferencias, debe seguir el mismo patron (recibir/actualizar este mismo Set,
// o uno equivalente) para no reutilizar un movimiento ya conciliado por otra conciliacion.
function matchEnBanco(depositos, eeccRows, usados = new Set()) {
  const fmtMov = m => m ? { fecha: m.fechaOperacion, importe: m.importe, concepto: m.concepto, banco: m.banco, nroDoc: m.nroDoc } : null;

  const filas = depositos.map(d => {
    const targetEf  = (d.sumEf || 0) + (d.sumVuelto || 0);
    const targetTip = d.sumTip || 0;
    const bEf  = buscarEnBanco(targetEf, d.fecha, eeccRows, usados);
    if (bEf.movimiento) usados.add(bEf.movimiento);
    const bTip = buscarEnBanco(targetTip, d.fecha, eeccRows, usados, bEf.movimiento);
    if (bTip.movimiento) usados.add(bTip.movimiento);

    let combinado = null;
    if (!(bEf.ok && bTip.ok)) {
      const targetCombo = targetEf + targetTip;
      const bCombo = buscarEnBanco(targetCombo, d.fecha, eeccRows, usados);
      if (bCombo.ok && !bCombo.na) { combinado = fmtMov(bCombo.movimiento); usados.add(bCombo.movimiento); }
    }

    return {
      ...d,
      targetEf, targetTip,
      bancoEf: fmtMov(bEf.movimiento), okEf: bEf.ok,
      bancoTip: fmtMov(bTip.movimiento), okTip: bTip.ok,
      combinado,
      extras: [],
      okBanco: (bEf.ok && bTip.ok) || !!combinado,
    };
  });

  // Movimientos "INGRESO EN EFECTIVO" del EECC que no se usaron en ningun match
  const sinCajaMovs = eeccRows.filter(e => (e.concepto || '').trim().toUpperCase() === CONCEPTO_DEPOSITO_EFECTIVO && !usados.has(e));

  // Una sola fila por dia: si ya existe una fila de deposito en esa fecha, los movimientos
  // sin CAJA se agregan como `extras` en la MISMA fila; si no hay deposito ese dia, se crea
  // una fila propia (deposito:null) agrupando todos los extras de esa fecha.
  const filasPorFecha = {};
  filas.forEach(f => { filasPorFecha[ymd(f.fecha)] = f; });
  const extrasPorFechaNueva = {};
  sinCajaMovs.forEach(e => {
    const k = ymd(e.fechaOperacion);
    const fila = filasPorFecha[k];
    if (fila) { fila.extras.push(fmtMov(e)); return; }
    if (!extrasPorFechaNueva[k]) extrasPorFechaNueva[k] = { fecha: e.fechaOperacion, deposito: null, targetEf: null, targetTip: null, bancoEf: null, okEf: false, bancoTip: null, okTip: false, combinado: null, extras: [], okBanco: false };
    extrasPorFechaNueva[k].extras.push(fmtMov(e));
  });

  const resultado = [...filas, ...Object.values(extrasPorFechaNueva)];

  // Diferencia total del dia: deposito CAJA vs lo encontrado en el banco (matches + extras sin CAJA)
  resultado.forEach(f => {
    const encontradoMatch = f.combinado ? f.combinado.importe : (f.bancoEf?.importe || 0) + (f.bancoTip?.importe || 0);
    const encontradoExtras = f.extras.reduce((s, e) => s + e.importe, 0);
    f.diferencia = (f.deposito !== null ? Math.abs(f.deposito) : 0) - encontradoMatch - encontradoExtras;
  });

  return resultado.sort((a, b) => a.fecha - b.fecha);
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

// Calcula la conciliacion de check3 (deposito CAJA vs EECC) y devuelve, ademas de los
// resultados, los `Set` de movimientos EECC ya reservados (`usadosSol`/`usadosUsd`) y las
// listas de movimientos EECC consultadas — para que otra conciliacion en la MISMA request
// (ej. check4, eventos comerciales) pueda excluir esos movimientos y no reutilizarlos.
async function calcularCheck3(sociedad, fechaDesde, fechaHasta) {
  const fechaConMargen = new Date(fechaDesde.getTime() - MAX_LOOKBACK * 86400000);
  // El margen hacia adelante debe cubrir el mayor de los dos usos de eeccSol/eeccUsd:
  // check3 (MAX_DIAS_BANCO) y check4 - eventos comerciales (MAX_DIAS_EVENTO, mas amplio).
  const fechaHastaMargen = new Date(fechaHasta.getTime() + Math.max(MAX_DIAS_BANCO, MAX_DIAS_EVENTO) * 86400000);

  const cajaRows = await CajaDiaria.find({
    sociedad, fecha: { $gte: fechaConMargen, $lte: fechaHasta },
  });
  const eeccSol = await EeccMovimiento.find({ sociedad, moneda: 'SOL', fechaOperacion: { $gte: fechaConMargen, $lte: fechaHastaMargen } });
  const eeccUsd = await EeccMovimiento.find({ sociedad, moneda: 'USD', fechaOperacion: { $gte: fechaConMargen, $lte: fechaHastaMargen } });

  const depPen = matchDeposits(cajaRows, { efField: 'cobranzaEfectivo', tipField: 'tipEfectivo', vueltoField: 'vueltoSoles', depField: 'depositoPen', tol: TOL_DEP_PEN })
    .filter(d => d.fecha >= fechaDesde);
  const depUsd = matchDeposits(cajaRows, { efField: 'cobranzaEfectivoUsd', tipField: 'tipUsd', vueltoField: null, depField: 'depositoUsd' })
    .filter(d => d.fecha >= fechaDesde);

  const usadosSol = new Set();
  const usadosUsd = new Set();
  const pen = matchEnBanco(depPen, eeccSol, usadosSol);
  const usd = matchEnBanco(depUsd, eeccUsd, usadosUsd);

  return { pen, usd, eeccSol, eeccUsd, usadosSol, usadosUsd };
}

function fmtCheck3(arr) {
  const fmtMov = m => m ? { fecha: ymd(m.fecha), importe: m.importe, concepto: m.concepto, banco: m.banco, nroDoc: m.nroDoc } : null;
  return arr.map(d => ({
    fecha: ymd(d.fecha), deposito: d.deposito,
    targetEf: d.targetEf, targetTip: d.targetTip,
    bancoEf: fmtMov(d.bancoEf), okEf: d.okEf,
    bancoTip: fmtMov(d.bancoTip), okTip: d.okTip,
    combinado: fmtMov(d.combinado),
    extras: (d.extras || []).map(fmtMov),
    diferencia: d.diferencia,
    okBanco: d.okBanco,
  }));
}

// ─── GET /check3 — Deposito (CAJA) vs movimiento bancario (EECC) ─────────
router.get('/check3', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    const { pen, usd } = await calcularCheck3(sociedad, fechaDesde, fechaHasta);
    // matchEnBanco usa margenes mas amplios (dias antes/despues) para el matching interno;
    // aqui se recorta la salida al rango exacto que el usuario seleccionó, para que las filas
    // "sin CAJA" (extras) tambien respeten el rango y no queden fijas al cambiar las fechas.
    const enRango = f => f.fecha >= fechaDesde && f.fecha <= fechaHasta;
    res.json({ pen: fmtCheck3(pen.filter(enRango)), usd: fmtCheck3(usd.filter(enRango)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eventos comerciales (COBRANZA ERP con MEDIO PAGO = "Cheque") no pasan por CAJA: se
// buscan directamente en el EECC por importe (se asume que dos eventos no comparten
// exactamente el mismo monto), dentro de MAX_DIAS_EVENTO días antes O después de la fecha
// del evento (el pago puede registrarse en el banco unos días antes o después). Excluye
// "INGRESO EN EFECTIVO" (reservado para caja) y cualquier movimiento ya usado por otra
// conciliacion (`usados`, compartido con check3).
function matchEventosComerciales(cobranzas, eeccRows, usados) {
  return cobranzas.map(c => {
    const target = Math.abs(c.cobranzaMoneda);
    const candidato = eeccRows.find(e =>
      !usados.has(e) &&
      e.importe > 0 &&
      (e.concepto || '').trim().toUpperCase() !== CONCEPTO_DEPOSITO_EFECTIVO &&
      Math.abs(e.importe - target) < TOL &&
      Math.abs(e.fechaOperacion - c.fecha) / 86400000 <= MAX_DIAS_EVENTO
    );
    if (candidato) usados.add(candidato);
    return {
      documento: c.documento, fecha: c.fecha, monto: c.cobranzaMoneda,
      canal: c.canal, fechaDocumento: c.fechaDocumento, fechaPedido: c.fechaPedido,
      facturado: c.facturado, estado: c.estado,
      banco: candidato ? { fecha: candidato.fechaOperacion, importe: candidato.importe, concepto: candidato.concepto, banco: candidato.banco, nroDoc: candidato.nroDoc } : null,
      ok: !!candidato,
    };
  });
}

// ─── GET /check4 — Eventos comerciales (Cheque) vs movimiento bancario (EECC) ──
router.get('/check4', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    // Recalcula check3 para obtener los mismos Sets de movimientos ya reservados y no
    // reutilizar en eventos comerciales un movimiento ya asignado a la caja en efectivo.
    const { eeccSol, eeccUsd, usadosSol, usadosUsd } = await calcularCheck3(sociedad, fechaDesde, fechaHasta);

    const chequeSol = await CobranzaErp.find({ sociedad, medioPago: 'Cheque', moneda: 'Soles', fecha: { $gte: fechaDesde, $lte: fechaHasta } });
    const chequeUsd = await CobranzaErp.find({ sociedad, medioPago: 'Cheque', moneda: 'Dolares', fecha: { $gte: fechaDesde, $lte: fechaHasta } });

    const pen = matchEventosComerciales(chequeSol, eeccSol, usadosSol);
    const usd = matchEventosComerciales(chequeUsd, eeccUsd, usadosUsd);

    const fmt = arr => arr.map(e => ({
      documento: e.documento, fecha: ymd(e.fecha), monto: e.monto, ok: e.ok,
      canal: e.canal, fechaDocumento: e.fechaDocumento ? ymd(e.fechaDocumento) : null,
      fechaPedido: e.fechaPedido ? ymd(e.fechaPedido) : null,
      facturado: e.facturado, estado: e.estado,
      banco: e.banco ? { fecha: ymd(e.banco.fecha), importe: e.banco.importe, concepto: e.banco.concepto, banco: e.banco.banco, nroDoc: e.banco.nroDoc } : null,
    }));

    res.json({ pen: fmt(pen), usd: fmt(usd) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const TC_OPERADORES = ['IZIPAY', 'NIUBIZ', 'AMEX', 'DINERS'];

// COBRANZA ERP (Tarjeta de Credito, TC en TC_OPERADORES) vs Q TC: se concilia por
// TARJETA (4 digitos en COBRANZA) == ultimos 4 digitos de TARJETA en Q TC, + misma fecha
// de venta + mismo monto (con tolerancia) — la combinacion evita cruzar dos ventas
// distintas que por coincidencia compartan los mismos 4 digitos de tarjeta.
function matchTC(cobranzas, tcRows) {
  const usados = new Set();
  return cobranzas.map(c => {
    // Q TC.VENTA incluye la propina (equivale a COBRANZA.COBRANZA = VENTA+TIP), no a
    // COBRANZA_MONEDA (que excluye el TIP) — confirmado con datos reales.
    const target = Math.abs(c.cobranza);
    const candidato = tcRows.find(t =>
      !usados.has(t) &&
      t.tarjetaUlt4 === c.tarjeta &&
      ymd(t.fechaVenta) === ymd(c.fecha) &&
      Math.abs(t.venta - target) < TOL
    );
    if (candidato) usados.add(candidato);
    return {
      documento: c.documento, fecha: c.fecha, tarjeta: c.tarjeta, tcOperador: c.tc, monto: c.cobranza,
      cliente: c.cliente,
      tcMov: candidato ? {
        establecimiento: candidato.establecimiento, venta: candidato.venta, estado: candidato.estado,
        deposito: candidato.deposito, fechaDeposito: candidato.fechaDeposito,
        comisionTotal: candidato.comisionTotal, tc: candidato.tc, autorizacion: candidato.autorizacion,
      } : null,
      ok: !!candidato,
    };
  });
}

// ─── GET /check5 — Tarjeta de Credito: COBRANZA ERP vs Q TC ──────────────
router.get('/check5', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    const cobranzas = await CobranzaErp.find({
      sociedad, medioPago: 'Tarjeta de Crédito',
      tc: { $in: TC_OPERADORES.map(o => new RegExp(`^${o}$`, 'i')) },
      fecha: { $gte: fechaDesde, $lte: fechaHasta },
    });
    const tcRows = await TcMovimiento.find({ sociedad, fechaVenta: { $gte: fechaDesde, $lte: fechaHasta } });

    const resultado = matchTC(cobranzas, tcRows);

    const fmt = arr => arr.map(e => ({
      documento: e.documento, fecha: ymd(e.fecha), tarjeta: e.tarjeta, tcOperador: e.tcOperador, monto: e.monto, ok: e.ok,
      cliente: e.cliente,
      tcMov: e.tcMov ? {
        establecimiento: e.tcMov.establecimiento, venta: e.tcMov.venta, estado: e.tcMov.estado,
        deposito: e.tcMov.deposito, fechaDeposito: e.tcMov.fechaDeposito ? ymd(e.tcMov.fechaDeposito) : null,
        comisionTotal: e.tcMov.comisionTotal, tc: e.tcMov.tc, autorizacion: e.tcMov.autorizacion,
      } : null,
    }));

    res.json({ resultado: fmt(resultado) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

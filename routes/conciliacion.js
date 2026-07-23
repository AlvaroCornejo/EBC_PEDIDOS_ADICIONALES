const express = require('express');
const authMiddleware   = require('../middleware/auth');
const ConciliacionConfig = require('../models/ConciliacionConfig');
const EeccMovimiento     = require('../models/EeccMovimiento');
const CobranzaErp        = require('../models/CobranzaErp');
const CajaDiaria         = require('../models/CajaDiaria');
const TcMovimiento       = require('../models/TcMovimiento');
const ConciliacionManualTC = require('../models/ConciliacionManualTC');
const ConciliacionExclusionEECC = require('../models/ConciliacionExclusionEECC');

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

// Para cada deposito de CAJA, se reunen TODOS los movimientos "INGRESO EN EFECTIVO" del EECC
// dentro de la ventana [fecha del deposito, +MAX_DIAS_BANCO dias] (no se busca un monto exacto:
// se suman todos los candidatos y se compara el total contra el deposito) — esto permite ver el
// desglose completo y que el usuario excluya a mano un movimiento mal agrupado.
//
// INVARIANTE: un movimiento del EECC solo puede formar parte de UN deposito. Se procesan los
// depositos en orden cronologico y cada uno "reclama" (Set `claimed`) los movimientos que suma,
// para que un deposito posterior no vuelva a contarlos. `excluidos` (Set de ids en string,
// persistido en ConciliacionExclusionEECC) saca movimientos de la agrupacion automatica por
// completo — quedan disponibles solo en la lista de pendientes.
function agruparEnBanco(depositos, eeccRows, claimed = new Set(), excluidos = new Set()) {
  const fmtMov = m => ({ id: String(m._id), fecha: m.fechaOperacion, importe: m.importe, concepto: m.concepto, banco: m.banco, nroDoc: m.nroDoc });

  const resultado = [...depositos].sort((a, b) => a.fecha - b.fecha).map(d => {
    const candidatos = eeccRows.filter(e =>
      !claimed.has(e) &&
      !excluidos.has(String(e._id)) &&
      e.importe > 0 &&
      (e.concepto || '').trim().toUpperCase() === CONCEPTO_DEPOSITO_EFECTIVO &&
      e.fechaOperacion >= d.fecha &&
      (e.fechaOperacion - d.fecha) / 86400000 <= MAX_DIAS_BANCO
    );
    candidatos.forEach(e => claimed.add(e));
    const movimientos = candidatos.map(fmtMov).sort((a, b) => a.fecha - b.fecha);
    const bancoTotal = movimientos.reduce((s, m) => s + m.importe, 0);
    return {
      ...d,
      movimientos,
      bancoTotal,
      diferencia: Math.abs(d.deposito) - bancoTotal,
      okBanco: Math.abs(Math.abs(d.deposito) - bancoTotal) < TOL,
    };
  });

  // Movimientos "INGRESO EN EFECTIVO" del EECC que ningun deposito reclamo (o que se
  // excluyeron a mano) — se listan aparte para revisarlos al final de la seccion.
  const pendientesEecc = eeccRows
    .filter(e => !claimed.has(e) && (e.concepto || '').trim().toUpperCase() === CONCEPTO_DEPOSITO_EFECTIVO && e.importe > 0)
    .sort((a, b) => a.fechaOperacion - b.fechaOperacion);

  return { resultado, pendientesEecc };
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

  const exclusiones = await ConciliacionExclusionEECC.find({ sociedad });
  const excluidos = new Set(exclusiones.map(x => String(x.eeccMovimientoId)));

  const usadosSol = new Set();
  const usadosUsd = new Set();
  const pen = agruparEnBanco(depPen, eeccSol, usadosSol, excluidos);
  const usd = agruparEnBanco(depUsd, eeccUsd, usadosUsd, excluidos);

  return {
    pen: pen.resultado, usd: usd.resultado,
    pendientesEeccSol: pen.pendientesEecc, pendientesEeccUsd: usd.pendientesEecc,
    eeccSol, eeccUsd, usadosSol, usadosUsd,
  };
}

function fmtCheck3(arr) {
  return arr.map(d => ({
    fecha: ymd(d.fecha), deposito: d.deposito,
    movimientos: d.movimientos.map(m => ({ id: m.id, fecha: ymd(m.fecha), importe: m.importe, concepto: m.concepto, banco: m.banco, nroDoc: m.nroDoc })),
    bancoTotal: d.bancoTotal,
    diferencia: d.diferencia,
    okBanco: d.okBanco,
  }));
}

function fmtPendientesEecc(arr, fechaDesde, fechaHasta) {
  return arr
    .filter(e => e.fechaOperacion >= fechaDesde && e.fechaOperacion <= fechaHasta)
    .map(e => ({ fecha: ymd(e.fechaOperacion), importe: e.importe, concepto: e.concepto, banco: e.banco, nroDoc: e.nroDoc }));
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

    const { pen, usd, pendientesEeccSol, pendientesEeccUsd } = await calcularCheck3(sociedad, fechaDesde, fechaHasta);
    // agruparEnBanco usa margenes mas amplios (dias antes/despues) para el matching interno;
    // aqui se recorta la salida al rango exacto que el usuario seleccionó, para que las filas
    // tambien respeten el rango y no queden fijas al cambiar las fechas.
    const enRango = f => f.fecha >= fechaDesde && f.fecha <= fechaHasta;
    res.json({
      pen: fmtCheck3(pen.filter(enRango)), usd: fmtCheck3(usd.filter(enRango)),
      pendientesEeccPen: fmtPendientesEecc(pendientesEeccSol, fechaDesde, fechaHasta),
      pendientesEeccUsd: fmtPendientesEecc(pendientesEeccUsd, fechaDesde, fechaHasta),
    });
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
      cliente: c.cliente, facturado: c.facturado, estado: c.estado,
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
      cliente: e.cliente, facturado: e.facturado, estado: e.estado,
      banco: e.banco ? { fecha: ymd(e.banco.fecha), importe: e.banco.importe, concepto: e.banco.concepto, banco: e.banco.banco, nroDoc: e.banco.nroDoc } : null,
    }));

    res.json({ pen: fmt(pen), usd: fmt(usd) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const TC_OPERADORES = ['IZIPAY', 'NIUBIZ', 'AMEX', 'DINERS'];
// FECHA VENTA de Q TC puede diferir unos dias de FECHA COBRANZA (confirmado con casos reales).
// La ventana es mas amplia cuando se exige la misma tarjeta (pasadas 1 y 2, mas confiables);
// el fallback sin tarjeta (pasada 3) usa una ventana mas conservadora para no aumentar falsos positivos.
const MAX_DIAS_TC_TARJETA = 15;
const MAX_DIAS_TC_FALLBACK = 5;

// COBRANZA ERP (Tarjeta de Credito, TC en TC_OPERADORES) vs Q TC: se concilia por
// TARJETA (4 digitos en COBRANZA) == ultimos 4 digitos de TARJETA en Q TC, + fecha de venta
// dentro de +/- MAX_DIAS_TC_TARJETA dias de la fecha de cobranza + mismo monto (con tolerancia)
// — la combinacion evita cruzar dos ventas distintas que por coincidencia compartan los
// mismos 4 digitos de tarjeta.
//
// 2da pasada: un solo movimiento de Q TC puede corresponder a la SUMA de varias cobranzas
// del mismo dia con la misma tarjeta (el operador liquido varias ventas juntas). Si una
// cobranza no matchea individualmente, se agrupa con otras de la misma tarjeta+fecha sin
// match y se busca un movimiento de Q TC cuyo VENTA sea igual a la suma del grupo.
// 3ra pasada: si aun asi no hay match, se busca SOLO por importe+fecha (sin exigir la
// misma tarjeta) — cada movimiento de Q TC solo puede conciliar UN registro de COBRANZA
// (respeta el mismo Set `usados`). Como la tarjeta puede no coincidir, se muestran ambas
// (la de COBRANZA y la de Q TC) para que se pueda verificar a simple vista.
// `manuales` es un Map documentoCobranza -> tcMovimientoId (string) con las conciliaciones
// que el usuario emparejo a mano (siempre entre registros que ninguna pasada automatica logro
// conciliar). Se aplican ANTES que las pasadas automaticas para que esos movimientos de TC
// queden reservados y no se les asigne otra cobranza por error.
function matchTC(cobranzas, tcRows, manuales = new Map()) {
  const usados = new Set();
  const fmtMov = t => ({
    establecimiento: t.establecimiento, venta: t.venta, estado: t.estado,
    deposito: t.deposito, fechaDeposito: t.fechaDeposito,
    comisionTotal: t.comisionTotal, tc: t.tc, autorizacion: t.autorizacion,
    tarjetaUlt4: t.tarjetaUlt4,
  });

  const resultados = cobranzas.map(c => {
    const tcId = manuales.get(c.documento);
    if (tcId) {
      const candidato = tcRows.find(t => !usados.has(t) && String(t._id) === tcId);
      if (candidato) { usados.add(candidato); return { c, candidato, combinado: false, soloImporteFecha: false, manual: true }; }
    }
    // Q TC.VENTA incluye la propina (equivale a COBRANZA.COBRANZA = VENTA+TIP), no a
    // COBRANZA_MONEDA (que excluye el TIP) — confirmado con datos reales.
    const target = Math.abs(c.cobranza);
    const candidato = tcRows.find(t =>
      !usados.has(t) &&
      t.tarjetaUlt4 === c.tarjeta &&
      Math.abs(t.fechaVenta - c.fecha) / 86400000 <= MAX_DIAS_TC_TARJETA &&
      Math.abs(t.venta - target) < TOL
    );
    if (candidato) usados.add(candidato);
    return { c, candidato, combinado: false, soloImporteFecha: false, manual: false };
  });

  const gruposSinMatch = {};
  resultados.forEach(r => {
    if (r.candidato) return;
    const k = r.c.tarjeta + '|' + ymd(r.c.fecha);
    (gruposSinMatch[k] = gruposSinMatch[k] || []).push(r);
  });
  Object.values(gruposSinMatch).forEach(grupo => {
    if (grupo.length < 2) return; // nada que combinar
    const suma = grupo.reduce((s, r) => s + Math.abs(r.c.cobranza), 0);
    const candidato = tcRows.find(t =>
      !usados.has(t) &&
      t.tarjetaUlt4 === grupo[0].c.tarjeta &&
      Math.abs(t.fechaVenta - grupo[0].c.fecha) / 86400000 <= MAX_DIAS_TC_TARJETA &&
      Math.abs(t.venta - suma) < TOL
    );
    if (candidato) {
      usados.add(candidato);
      grupo.forEach(r => { r.candidato = candidato; r.combinado = true; });
    }
  });

  resultados.forEach(r => {
    if (r.candidato) return;
    const target = Math.abs(r.c.cobranza);
    const candidato = tcRows.find(t =>
      !usados.has(t) &&
      Math.abs(t.fechaVenta - r.c.fecha) / 86400000 <= MAX_DIAS_TC_FALLBACK &&
      Math.abs(t.venta - target) < TOL
    );
    if (candidato) {
      usados.add(candidato);
      r.candidato = candidato;
      r.soloImporteFecha = true;
    }
  });

  const pendientesTc = tcRows.filter(t => !usados.has(t));

  return {
    resultados: resultados.map(({ c, candidato, combinado, soloImporteFecha, manual }) => ({
      documento: c.documento, fecha: c.fecha, tarjeta: c.tarjeta, tcOperador: c.tc, monto: c.cobranza,
      cliente: c.cliente,
      tcMov: candidato ? fmtMov(candidato) : null,
      combinado, soloImporteFecha, manual: !!manual,
      ok: !!candidato,
    })),
    pendientesTc,
  };
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

    // Margen para que un TC cerca del borde del rango (dentro de MAX_DIAS_TC_TARJETA) tambien
    // pueda conciliar con una cobranza dentro del rango.
    const fechaConMargen = new Date(fechaDesde.getTime() - MAX_DIAS_TC_TARJETA * 86400000);
    const fechaHastaMargen = new Date(fechaHasta.getTime() + MAX_DIAS_TC_TARJETA * 86400000);

    const cobranzas = await CobranzaErp.find({
      sociedad, medioPago: 'Tarjeta de Crédito',
      tc: { $in: TC_OPERADORES.map(o => new RegExp(`^${o}$`, 'i')) },
      fecha: { $gte: fechaDesde, $lte: fechaHasta },
    });
    const tcRows = await TcMovimiento.find({ sociedad, fechaVenta: { $gte: fechaConMargen, $lte: fechaHastaMargen } });

    const manualesDocs = await ConciliacionManualTC.find({ sociedad });
    const manuales = new Map(manualesDocs.map(m => [m.documentoCobranza, String(m.tcMovimientoId)]));

    const { resultados, pendientesTc } = matchTC(cobranzas, tcRows, manuales);

    const fmtMovOut = m => m ? {
      establecimiento: m.establecimiento, venta: m.venta, estado: m.estado,
      deposito: m.deposito, fechaDeposito: m.fechaDeposito ? ymd(m.fechaDeposito) : null,
      comisionTotal: m.comisionTotal, tc: m.tc, autorizacion: m.autorizacion, tarjetaUlt4: m.tarjetaUlt4,
    } : null;

    const resultado = resultados.map(e => ({
      documento: e.documento, fecha: ymd(e.fecha), tarjeta: e.tarjeta, tcOperador: e.tcOperador, monto: e.monto, ok: e.ok,
      cliente: e.cliente, combinado: e.combinado, soloImporteFecha: e.soloImporteFecha, manual: e.manual,
      tcMov: fmtMovOut(e.tcMov),
    }));

    // Solo se muestran los pendientes dentro del rango exacto seleccionado (el margen de
    // consulta era solo para permitir el matching cerca del borde).
    const pendientes = pendientesTc
      .filter(t => t.fechaVenta >= fechaDesde && t.fechaVenta <= fechaHasta)
      .map(t => ({
        id: String(t._id),
        tarjeta: t.tarjetaUlt4, fecha: ymd(t.fechaVenta), venta: t.venta, estado: t.estado,
        establecimiento: t.establecimiento, tc: t.tc, autorizacion: t.autorizacion,
        deposito: t.deposito, fechaDeposito: t.fechaDeposito ? ymd(t.fechaDeposito) : null,
      }));

    res.json({ resultado, pendientesTc: pendientes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /tc-manual — registrar conciliacion manual COBRANZA <-> Q TC ───
// Solo debe usarse entre registros que ninguna pasada automatica logro conciliar.
router.post('/tc-manual', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad, documentoCobranza, tcMovimientoId } = req.body;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    if (!documentoCobranza || !tcMovimientoId) return res.status(400).json({ error: 'Faltan datos' });

    const tcMov = await TcMovimiento.findOne({ _id: tcMovimientoId, sociedad });
    if (!tcMov) return res.status(404).json({ error: 'Movimiento de Q TC no encontrado' });

    const registro = await ConciliacionManualTC.findOneAndUpdate(
      { sociedad, documentoCobranza },
      { $set: { tcMovimientoId, creadoPor: req.user.username || '', creadoEn: new Date() } },
      { new: true, upsert: true }
    );
    res.json(registro);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DELETE /tc-manual/:documentoCobranza — deshacer conciliacion manual ──
router.delete('/tc-manual/:documentoCobranza', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    await ConciliacionManualTC.deleteOne({ sociedad, documentoCobranza: req.params.documentoCobranza });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /eecc-excluir — excluir un movimiento del EECC de la agrupacion ──
// automatica de "Deposito CAJA vs Banco" (check3). Pasa a la lista de sin conciliar.
router.post('/eecc-excluir', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad, eeccMovimientoId } = req.body;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    if (!eeccMovimientoId) return res.status(400).json({ error: 'Faltan datos' });

    const mov = await EeccMovimiento.findOne({ _id: eeccMovimientoId, sociedad });
    if (!mov) return res.status(404).json({ error: 'Movimiento de EECC no encontrado' });

    const registro = await ConciliacionExclusionEECC.findOneAndUpdate(
      { sociedad, eeccMovimientoId },
      { $set: { creadoPor: req.user.username || '', creadoEn: new Date() } },
      { new: true, upsert: true }
    );
    res.json(registro);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DELETE /eecc-excluir/:id — deshacer la exclusion de un movimiento EECC ──
router.delete('/eecc-excluir/:id', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    await ConciliacionExclusionEECC.deleteOne({ sociedad, eeccMovimientoId: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Descripciones EECC que corresponden a depositos de operadores de TC (no hay un concepto
// unico/exacto; se identifican por estas subcadenas dentro del Concepto, confirmado con datos
// reales: "R204...PROCESOS DE MEDI", "R204...COMPAÑIA DE SERV", "R203...COMPAÑIA PERUANA",
// "R201...DINERS CLUB PERU").
const CONCEPTO_DEPOSITO_TC = ['DINERS', 'COMPAÑIA PERU', 'PROCESOS DE ME', 'COMPAÑIA DE SE'];

// ─── GET /check6 — Depositos de operadores de TC: Q TC vs EECC (por dia) ─
// Q TC: total de DEPOSITO agrupado por FECHA DEPOSITO. EECC: total de movimientos positivos
// cuyo Concepto contiene alguna de las subcadenas de CONCEPTO_DEPOSITO_TC, agrupado por dia.
router.get('/check6', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { sociedad } = req.query;
    if (!sociedad || !checkSociedad(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde) : new Date('2000-01-01');
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta) : new Date('2100-01-01');
    fechaHasta.setHours(23, 59, 59, 999);

    const tcRows = await TcMovimiento.find({
      sociedad, fechaDeposito: { $gte: fechaDesde, $lte: fechaHasta },
    });
    const eeccSol = await EeccMovimiento.find({ sociedad, moneda: 'SOL', fechaOperacion: { $gte: fechaDesde, $lte: fechaHasta } });
    const eeccUsd = await EeccMovimiento.find({ sociedad, moneda: 'USD', fechaOperacion: { $gte: fechaDesde, $lte: fechaHasta } });

    // Q TC casi no trae MONEDA poblada (en blanco = Soles por defecto); solo se cuenta como
    // USD cuando dice explicitamente "dolar". Se separa asi para no comparar el total de TC
    // (que es ~100% soles) contra el lado de dolares y marcar error en todos los dias.
    const tcPorDiaSol = {};
    const tcPorDiaUsd = {};
    tcRows.forEach(t => {
      const k = ymd(t.fechaDeposito);
      const esUsd = /dolar/i.test(t.moneda || '');
      const bucket = esUsd ? tcPorDiaUsd : tcPorDiaSol;
      bucket[k] = (bucket[k] || 0) + (t.deposito || 0);
    });

    const esDepositoTC = e => {
      const c = (e.concepto || '').toUpperCase();
      return e.importe > 0 && CONCEPTO_DEPOSITO_TC.some(s => c.includes(s));
    };

    function compararPorDia(eeccRows, tcPorDia) {
      const eeccPorDia = {};
      eeccRows.filter(esDepositoTC).forEach(e => {
        const k = ymd(e.fechaOperacion);
        eeccPorDia[k] = (eeccPorDia[k] || 0) + e.importe;
      });
      const dias = new Set([...Object.keys(tcPorDia), ...Object.keys(eeccPorDia)]);
      return [...dias].sort().map(fecha => {
        const tc = tcPorDia[fecha] || 0;
        const eecc = eeccPorDia[fecha] || 0;
        const diferencia = tc - eecc;
        return { fecha, tc, eecc, diferencia, ok: Math.abs(diferencia) < TOL };
      });
    }

    res.json({ pen: compararPorDia(eeccSol, tcPorDiaSol), usd: compararPorDia(eeccUsd, tcPorDiaUsd) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

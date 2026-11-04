const express = require('express');
const auth = require('../middleware/auth');

const CajaEfectivoConfig = require('../models/CajaEfectivoConfig');
const TurnoCaja = require('../models/TurnoCaja');
const MovimientoEfectivoCaja = require('../models/MovimientoEfectivoCaja');
const EnvioEfectivo = require('../models/EnvioEfectivo');
const CierreOficinaDiario = require('../models/CierreOficinaDiario');
const DepositoBanco = require('../models/DepositoBanco');
const SupervisorConteo = require('../models/SupervisorConteo');
const CobranzaEfectivoErp = require('../models/CobranzaEfectivoErp');
const Operacion = require('../models/Operacion');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || (req.user.rolesCajaEfectivo || []).length) return next();
  return res.status(403).json({ error: 'Sin acceso a Cierre de Caja' });
}
router.use(requireAccess);

function opsFilter(user) { return user.role === 'ADMIN' ? null : (user.operations || []); }
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}
// Un usuario puede tener varios roles a la vez (ej. Oficina + Control) — cumple si
// tiene AL MENOS UNO de los pedidos.
function tieneRol(user, ...rolesPedidos) {
  if (user.role === 'ADMIN') return true;
  const roles = user.rolesCajaEfectivo || [];
  return rolesPedidos.some(r => roles.includes(r));
}
function requireRol(...roles) {
  return (req, res, next) => tieneRol(req.user, ...roles) ? next() : res.status(403).json({ error: 'Rol sin permiso para esta acción' });
}

const ymd = d => new Date(d).toISOString().slice(0, 10);
// conteo = { pen: {denom: qty}, usd: {denom: qty} }; moneda = 'pen'|'usd'
function sumaConteo(conteo, moneda) {
  if (!conteo || !conteo[moneda]) return 0;
  return Object.entries(conteo[moneda]).reduce((s, [denom, qty]) => s + Number(denom) * Number(qty || 0), 0);
}
// Ingreso neto de un turno en una moneda: VENTA+TIP − VUELTO (VUELTO siempre PEN).
function netoIngresos(movimientos, monedaUpper) {
  const { venta, tip } = netoVentaTip(movimientos, monedaUpper);
  return venta + tip;
}
// Desglose venta/TIP del ingreso neto de un turno en una moneda. El vuelto se resta
// de venta (es cambio de una venta pagada en dólares), nunca del TIP.
function netoVentaTip(movimientos, monedaUpper) {
  let venta = 0, tip = 0;
  movimientos.forEach(m => {
    if (m.moneda !== monedaUpper) return;
    if (m.tipo === 'VENTA') venta += m.monto;
    else if (m.tipo === 'TIP') tip += m.monto;
    else if (m.tipo === 'VUELTO') venta -= m.monto;
  });
  return { venta, tip };
}
async function configDe(operacion) {
  const cfg = await CajaEfectivoConfig.findOne({ operacion }).lean();
  return cfg || { tieneOficina: false, turnos: [], fondoFijoCaja: { pen: 0, usd: 0 }, fondoFijoOficina: { pen: 0, usd: 0 } };
}

// Libera (desreclama) todos los turnos/envíos que cubre un DepositoBanco —
// vuelven a quedar disponibles para un depósito nuevo (o para recalcular el mismo).
async function liberarCubre(dep) {
  const campoClaim = dep.moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';
  for (const item of dep.cubre) {
    if (item.tipo === 'TURNO') {
      await TurnoCaja.updateOne({ _id: item.id, [campoClaim]: dep._id }, { $set: { [campoClaim]: null } });
    } else if (item.tipo === 'ENVIO') {
      await EnvioEfectivo.updateOne({ _id: item.id, depositoId: dep._id }, { $set: { depositoId: null } });
    }
  }
}

// Borra un DepositoBanco y libera lo que cubría. Usado al borrar (ADMIN) un
// turno/día que ya había sido reclamado, con confirmación explícita.
async function borrarDepositoYLiberar(depositoId) {
  const dep = await DepositoBanco.findById(depositoId).lean();
  if (!dep) return;
  await liberarCubre(dep);
  await DepositoBanco.deleteOne({ _id: dep._id });
}

// Valida una selección de turnos/envíos para un depósito y calcula lo que cubre
// (fecha + monto de cada uno) y los totales de venta/TIP. No marca nada como
// reclamado todavía — eso lo hace `reclamarCubre` una vez que el depósito ya
// existe (con su _id). Lanza si algún item ya no está disponible.
async function calcularCubre(origen, operacion, moneda, cubre) {
  const cubreCalculado = [];
  let montoVenta = 0, montoTip = 0;
  if (origen === 'OFICINA') {
    for (const item of cubre) {
      const envio = await EnvioEfectivo.findOne({ _id: item.id, operacion, estado: 'CONFIRMADO', moneda, depositoId: null });
      if (!envio) throw new Error('Un envío seleccionado ya no está disponible');
      // La fecha que se guarda es la del turno de origen (cuándo se generó el
      // efectivo), no la de cuándo Oficina confirmó el envío.
      const turnoOrigen = await TurnoCaja.findById(envio.origenTurnoId).lean();
      cubreCalculado.push({ tipo: 'ENVIO', id: envio._id, fecha: turnoOrigen ? turnoOrigen.fecha : envio.fechaConfirmacion, monto: envio.montoConfirmado });
      montoVenta += envio.montoVenta; montoTip += envio.montoTip;
    }
  } else {
    const campoClaim = moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';
    for (const item of cubre) {
      // Se puede depositar contra un turno todavía ABIERTO (editable hasta que
      // se cierre) — no solo contra turnos ya CERRADOs.
      const turno = await TurnoCaja.findOne({ _id: item.id, operacion, [campoClaim]: null });
      if (!turno) throw new Error('Un turno seleccionado ya no está disponible');
      const movimientos = await MovimientoEfectivoCaja.find({ turnoId: turno._id }).lean();
      const { venta, tip } = netoVentaTip(movimientos, moneda);
      cubreCalculado.push({ tipo: 'TURNO', id: turno._id, fecha: turno.fecha, monto: venta + tip });
      montoVenta += venta; montoTip += tip;
    }
  }
  const totalCubierto = cubreCalculado.reduce((s, c) => s + c.monto, 0);
  return { cubreCalculado, totalCubierto, montoVenta, montoTip };
}

// Marca como reclamados (depositoId) los turnos/envíos ya calculados por `calcularCubre`.
async function reclamarCubre(origen, moneda, cubreCalculado, depositoId) {
  if (origen === 'OFICINA') {
    await EnvioEfectivo.updateMany({ _id: { $in: cubreCalculado.map(c => c.id) } }, { $set: { depositoId } });
  } else {
    const campoClaim = moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';
    await TurnoCaja.updateMany({ _id: { $in: cubreCalculado.map(c => c.id) } }, { $set: { [campoClaim]: depositoId } });
  }
}

// Resuelve el turno/día "vigente" (abierto) de una operación al momento de
// registrar un depósito — no necesariamente el mismo turno/envío que el depósito
// termina cubriendo (p.ej. se deposita en el turno de hoy la plata que quedó sin
// depositar de un turno ya cerrado de días anteriores).
async function vigenteDe(origen, operacion) {
  if (origen === 'CAJA') {
    const turno = await TurnoCaja.findOne({ operacion, estado: 'ABIERTO' }).lean();
    return turno ? turno._id : null;
  }
  const dia = await CierreOficinaDiario.findOne({ operacion, fechaCierre: null }).sort({ fechaApertura: -1 }).lean();
  return dia ? dia._id : null;
}

// Un depósito es editable "hasta antes de cerrar el turno": el turno (origen CAJA)
// o día de Oficina (origen OFICINA) que estaba abierto cuando se registró el
// depósito (`turnoVigenteId`/`diaVigenteId`) debe seguir abierto — no los
// turnos/envíos que el depósito cubre, que pueden ser de un turno ya cerrado.
async function depositoEsEditable(dep) {
  if (dep.origen === 'CAJA') {
    if (dep.turnoVigenteId) {
      const turno = await TurnoCaja.findById(dep.turnoVigenteId, 'estado').lean();
      return !!turno && turno.estado === 'ABIERTO';
    }
    // Depósitos creados antes de guardar turnoVigenteId: criterio anterior,
    // de compatibilidad (compara contra los turnos que cubre).
    const turnoIds = dep.cubre.filter(c => c.tipo === 'TURNO').map(c => c.id);
    if (!turnoIds.length) return false;
    const turnos = await TurnoCaja.find({ _id: { $in: turnoIds } }, 'estado').lean();
    return turnos.length === turnoIds.length && turnos.every(t => t.estado === 'ABIERTO');
  }
  if (dep.diaVigenteId) {
    const dia = await CierreOficinaDiario.findById(dep.diaVigenteId, 'fechaCierre').lean();
    return !!dia && !dia.fechaCierre;
  }
  const diaAbierto = await CierreOficinaDiario.findOne({
    operacion: dep.operacion, fechaApertura: { $lte: dep.fechaRegistro }, fechaCierre: null,
  }).lean();
  return !!diaAbierto;
}

// ─── Config (solo ADMIN) ──────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const [operaciones, configs] = await Promise.all([
      Operacion.find({}, 'codigo nombre').sort({ codigo: 1 }).lean(),
      CajaEfectivoConfig.find({}).lean(),
    ]);
    const byOp = {};
    configs.forEach(c => { byOp[c.operacion] = c; });
    res.json(operaciones.map(o => {
      const c = byOp[o.codigo];
      return {
        operacion: o.codigo, nombre: o.nombre,
        tieneOficina: c?.tieneOficina || false,
        turnos: c?.turnos || [],
        fondoFijoCaja: c?.fondoFijoCaja || { pen: 0, usd: 0 },
        fondoFijoOficina: c?.fondoFijoOficina || { pen: 0, usd: 0 },
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config/:operacion', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { operacion } = req.params;
    const { tieneOficina, turnos, fondoFijoCaja, fondoFijoOficina } = req.body;
    const num = v => Number(v) || 0;
    const cfg = await CajaEfectivoConfig.findOneAndUpdate(
      { operacion },
      { $set: {
          ...(tieneOficina !== undefined && { tieneOficina: !!tieneOficina }),
          ...(turnos !== undefined && { turnos: Array.isArray(turnos) ? turnos.map(t => String(t).trim()).filter(Boolean) : [] }),
          ...(fondoFijoCaja !== undefined && { fondoFijoCaja: { pen: num(fondoFijoCaja.pen), usd: num(fondoFijoCaja.usd) } }),
          ...(fondoFijoOficina !== undefined && { fondoFijoOficina: { pen: num(fondoFijoOficina.pen), usd: num(fondoFijoOficina.usd) } }),
        } },
      { new: true, upsert: true }
    );
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Catálogo ──────────────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const ops = opsFilter(req.user);
    const filter = ops === null ? {} : { codigo: { $in: ops } };
    const operaciones = await Operacion.find(filter, 'codigo').sort({ codigo: 1 }).lean();
    res.json(operaciones.map(o => o.codigo));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/config/propio', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    res.json(await configDe(operacion));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Turnos de Tienda (rol CAJA) ────────────────────────────────────────────
router.get('/turnos', async (req, res) => {
  try {
    const { operacion, fecha } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const filter = { operacion };
    if (fecha) filter.fecha = new Date(fecha);
    const turnos = await TurnoCaja.find(filter).sort({ fecha: -1, turno: 1 }).lean();
    res.json(turnos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/turnos', requireRol('CAJA'), async (req, res) => {
  try {
    const { operacion, fecha, turno, conteoApertura } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha || !turno) return res.status(400).json({ error: 'Faltan datos' });

    const abierto = await TurnoCaja.findOne({ operacion, estado: 'ABIERTO' });
    if (abierto) return res.status(400).json({ error: `Ya hay un turno abierto (${abierto.turno} del ${ymd(abierto.fecha)}) en esta operación` });

    // Chequeo explícito además del índice único de Mongo — no depender solo del
    // catch de 11000 (por si el índice no llegó a crearse en una colección vieja).
    const duplicado = await TurnoCaja.findOne({ operacion, fecha: new Date(fecha), turno });
    if (duplicado) {
      return res.status(400).json({
        error: `Ya existe un turno "${turno}" para el ${ymd(duplicado.fecha)} en esta operación (${duplicado.estado === 'ABIERTO' ? 'sigue abierto' : 'ya cerrado'})`,
      });
    }

    const turnoDoc = await TurnoCaja.create({
      operacion, fecha: new Date(fecha), turno,
      conteoApertura: conteoApertura || {},
      abiertoPor: req.user.username || '',
    });
    res.json(turnoDoc);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe un turno con esa operación/fecha/turno' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/turnos/:id', async (req, res) => {
  try {
    const turno = await TurnoCaja.findById(req.params.id).lean();
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    if (!checkOpAccess(req.user, turno.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const [movimientos, envios] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: turno._id }).sort({ fechaRegistro: 1 }).lean(),
      EnvioEfectivo.find({ origenTurnoId: turno._id }).sort({ fechaEnvio: 1 }).lean(),
    ]);
    res.json({ turno, movimientos, envios });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/turnos/:id/movimientos', requireRol('CAJA'), async (req, res) => {
  try {
    const turno = await TurnoCaja.findById(req.params.id);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    if (!checkOpAccess(req.user, turno.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (req.user.role !== 'ADMIN' && turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya está cerrado' });

    const { tipo, moneda, monto, comentario } = req.body;
    if (!['VENTA', 'TIP', 'VUELTO', 'TIP_FACTURADO'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    if ((tipo === 'VUELTO' || tipo === 'TIP_FACTURADO') && moneda !== 'PEN') return res.status(400).json({ error: 'El vuelto y el TIP facturado siempre son en soles' });
    if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'Falta el monto' });

    const mov = await MovimientoEfectivoCaja.create({
      turnoId: turno._id, operacion: turno.operacion, fecha: turno.fecha,
      tipo, moneda, monto: Number(monto),
      comentario: comentario || '', creadoPor: req.user.username || '',
    });
    res.json(mov);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita un movimiento existente (antes solo se podía borrar y volver a crear).
// CAJA solo mientras el turno siga ABIERTO; ADMIN sin restricción de estado.
router.put('/movimientos/:id', requireRol('CAJA'), async (req, res) => {
  try {
    const mov = await MovimientoEfectivoCaja.findById(req.params.id);
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (!checkOpAccess(req.user, mov.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (req.user.role !== 'ADMIN') {
      const turno = await TurnoCaja.findById(mov.turnoId).lean();
      if (!turno || turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya está cerrado' });
    }

    const { tipo, moneda, monto, comentario } = req.body;
    if (!['VENTA', 'TIP', 'VUELTO', 'TIP_FACTURADO'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    if ((tipo === 'VUELTO' || tipo === 'TIP_FACTURADO') && moneda !== 'PEN') return res.status(400).json({ error: 'El vuelto y el TIP facturado siempre son en soles' });
    if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'Falta el monto' });

    mov.tipo = tipo; mov.moneda = moneda; mov.monto = Number(monto);
    if (comentario !== undefined) mov.comentario = comentario;
    await mov.save();
    res.json(mov);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/movimientos/:id', requireRol('CAJA'), async (req, res) => {
  try {
    const mov = await MovimientoEfectivoCaja.findById(req.params.id);
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (!checkOpAccess(req.user, mov.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (req.user.role !== 'ADMIN') {
      const turno = await TurnoCaja.findById(mov.turnoId).lean();
      if (!turno || turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya está cerrado' });
    }
    await MovimientoEfectivoCaja.deleteOne({ _id: mov._id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/turnos/:id/cerrar', requireRol('CAJA'), async (req, res) => {
  try {
    const turno = await TurnoCaja.findById(req.params.id);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    if (!checkOpAccess(req.user, turno.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya está cerrado' });

    const { conteoCierre, comentario } = req.body;
    if (!conteoCierre) return res.status(400).json({ error: 'Falta el conteo de cierre' });

    turno.estado = 'CERRADO';
    turno.conteoCierre = conteoCierre;
    turno.cerradoPor = req.user.username || '';
    turno.fechaCierre = new Date();
    if (comentario !== undefined) turno.comentario = comentario;
    await turno.save();
    res.json(turno);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita directamente cualquier campo de un turno (fecha, nombre, estado, conteos,
// comentario) — solo ADMIN, sin restricción de estado. Pensado para corregir
// errores (un conteo mal tipeado, reabrir un turno cerrado por error, etc.), no
// para el flujo normal de Caja (que usa /turnos, /movimientos y /cerrar).
router.put('/turnos/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const turno = await TurnoCaja.findById(req.params.id);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    const { fecha, turno: nombreTurno, estado, conteoApertura, conteoCierre, comentario } = req.body;
    if (estado !== undefined && !['ABIERTO', 'CERRADO'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (estado === 'ABIERTO') {
      const otroAbierto = await TurnoCaja.findOne({ operacion: turno.operacion, estado: 'ABIERTO', _id: { $ne: turno._id } });
      if (otroAbierto) return res.status(400).json({ error: `Ya hay otro turno abierto (${otroAbierto.turno} del ${ymd(otroAbierto.fecha)}) en esta operación` });
    }

    if (fecha !== undefined) turno.fecha = new Date(fecha);
    if (nombreTurno !== undefined) turno.turno = String(nombreTurno).trim();
    if (conteoApertura !== undefined) turno.conteoApertura = conteoApertura;
    if (conteoCierre !== undefined) turno.conteoCierre = conteoCierre;
    if (comentario !== undefined) turno.comentario = comentario;
    if (estado !== undefined) {
      turno.estado = estado;
      if (estado === 'CERRADO' && !turno.fechaCierre) { turno.fechaCierre = new Date(); turno.cerradoPor = turno.cerradoPor || req.user.username || ''; }
      if (estado === 'ABIERTO') { turno.fechaCierre = null; turno.cerradoPor = ''; }
    }
    await turno.save();
    res.json(turno);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe un turno con esa operación/fecha/turno' });
    res.status(500).json({ error: e.message });
  }
});

// Borra por completo un turno (lo que registró Caja) y su conteo de supervisor —
// solo ADMIN, pensado para corregir pruebas/errores. Bloqueado si ya fue reclamado
// por un depósito (directo o vía un envío ya depositado), para no dejar un
// DepositoBanco con un `cubre[]` apuntando a un turno que ya no existe.
router.delete('/turnos/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const turno = await TurnoCaja.findById(req.params.id);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    const confirmarDeposito = req.query.confirmarDeposito === 'true';

    const envios = await EnvioEfectivo.find({ origenTurnoId: turno._id }).lean();
    const depositos = new Set();
    if (turno.depositoPenId) depositos.add(String(turno.depositoPenId));
    if (turno.depositoUsdId) depositos.add(String(turno.depositoUsdId));
    envios.forEach(e => { if (e.depositoId) depositos.add(String(e.depositoId)); });

    if (depositos.size && !confirmarDeposito) {
      return res.status(409).json({
        error: 'Este turno (o un envío suyo) ya fue reclamado por un depósito',
        requiereConfirmarDeposito: true,
      });
    }
    for (const depId of depositos) await borrarDepositoYLiberar(depId);

    await Promise.all([
      MovimientoEfectivoCaja.deleteMany({ turnoId: turno._id }),
      EnvioEfectivo.deleteMany({ origenTurnoId: turno._id }),
      SupervisorConteo.deleteOne({ ubicacion: 'TIENDA', refId: turno._id }),
      TurnoCaja.deleteOne({ _id: turno._id }),
    ]);
    res.json({ ok: true, depositosBorrados: depositos.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Envíos Tienda → Oficina (solo operaciones con oficina) ────────────────
router.post('/envios', requireRol('CAJA'), async (req, res) => {
  try {
    const { operacion, origenTurnoId, moneda, denominacion, montoVenta, montoTip, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Falta la moneda' });
    if (!denominacion || typeof denominacion !== 'object' || Array.isArray(denominacion)) {
      return res.status(400).json({ error: 'Falta el desglose de billetes/monedas' });
    }

    const { tieneOficina } = await configDe(operacion);
    if (!tieneOficina) return res.status(400).json({ error: 'Esta operación no tiene oficina' });

    const turno = await TurnoCaja.findById(origenTurnoId);
    if (!turno || turno.operacion !== operacion) return res.status(400).json({ error: 'Turno de origen inválido' });

    // El monto enviado sale del desglose (no se confía en lo que mande el cliente);
    // venta + TIP debe cuadrar exacto con esa suma.
    const montoEnviado = Object.entries(denominacion).reduce((s, [d, q]) => s + Number(d) * Number(q || 0), 0);
    if (!montoEnviado) return res.status(400).json({ error: 'El desglose no suma nada' });
    const venta = Number(montoVenta) || 0, tip = Number(montoTip) || 0;
    if (Math.abs(venta + tip - montoEnviado) > 0.01) {
      return res.status(400).json({ error: 'Venta + TIP debe sumar el mismo total que el desglose de billetes/monedas' });
    }

    const envio = await EnvioEfectivo.create({
      operacion, origenTurnoId, moneda, montoEnviado, montoVenta: venta, montoTip: tip, denominacion,
      enviadoPor: req.user.username || '', comentario: comentario || '',
    });
    res.json(envio);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita un envío a Oficina — CAJA solo mientras Oficina no lo haya confirmado
// todavía Y el turno de origen siga ABIERTO ("hasta antes de cerrar el turno");
// ADMIN sin esa restricción.
router.put('/envios/:id', requireRol('CAJA'), async (req, res) => {
  try {
    const envio = await EnvioEfectivo.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (req.user.role !== 'ADMIN') {
      if (envio.estado !== 'ENVIADO') return res.status(400).json({ error: 'Ya fue confirmado por Oficina, no se puede editar' });
      const turno = await TurnoCaja.findById(envio.origenTurnoId).lean();
      if (!turno || turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya se cerró, no se puede editar el envío' });
    }

    const { denominacion, montoVenta, montoTip, comentario } = req.body;
    if (!denominacion || typeof denominacion !== 'object' || Array.isArray(denominacion)) {
      return res.status(400).json({ error: 'Falta el desglose de billetes/monedas' });
    }
    const montoEnviado = Object.entries(denominacion).reduce((s, [d, q]) => s + Number(d) * Number(q || 0), 0);
    if (!montoEnviado) return res.status(400).json({ error: 'El desglose no suma nada' });
    const venta = Number(montoVenta) || 0, tip = Number(montoTip) || 0;
    if (Math.abs(venta + tip - montoEnviado) > 0.01) {
      return res.status(400).json({ error: 'Venta + TIP debe sumar el mismo total que el desglose de billetes/monedas' });
    }

    envio.denominacion = denominacion;
    envio.montoEnviado = montoEnviado;
    envio.montoVenta = venta;
    envio.montoTip = tip;
    if (comentario !== undefined) envio.comentario = comentario;
    await envio.save();
    res.json(envio);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Elimina un envío a Oficina. CAJA solo mientras siga ENVIADO (sin confirmar) y
// el turno de origen siga ABIERTO — mismo criterio que editarlo. ADMIN puede
// borrar cualquiera (p.ej. uno ya CONFIRMADO); si ya fue reclamado por un
// depósito, pide confirmación explícita (mismo patrón 409/confirmarDeposito que
// borrar un turno/día) y de confirmarse borra también ese depósito, liberando lo
// demás que cubría.
router.delete('/envios/:id', async (req, res) => {
  try {
    const envio = await EnvioEfectivo.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const esAdmin = req.user.role === 'ADMIN';
    if (!esAdmin) {
      if (!tieneRol(req.user, 'CAJA')) return res.status(403).json({ error: 'Sin permiso' });
      if (envio.estado !== 'ENVIADO') return res.status(400).json({ error: 'Ya fue confirmado por Oficina, no se puede eliminar' });
      const turno = await TurnoCaja.findById(envio.origenTurnoId).lean();
      if (!turno || turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya se cerró, no se puede eliminar el envío' });
    }

    const confirmarDeposito = req.query.confirmarDeposito === 'true';
    if (envio.depositoId && !confirmarDeposito) {
      return res.status(409).json({
        error: 'Este envío ya fue reclamado por un depósito',
        requiereConfirmarDeposito: true,
      });
    }
    if (envio.depositoId) await borrarDepositoYLiberar(envio.depositoId);

    await EnvioEfectivo.deleteOne({ _id: envio._id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/envios/pendientes', requireRol('OFICINA'), async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const envios = await EnvioEfectivo.find({ operacion, estado: 'ENVIADO' }).sort({ fechaEnvio: 1 }).lean();
    res.json(envios);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// OFICINA solo puede confirmar un envío una vez; ADMIN puede volver a confirmar
// (p.ej. para corregir el monto confirmado) aunque ya tenga estado CONFIRMADO.
router.put('/envios/:id/confirmar', requireRol('OFICINA'), async (req, res) => {
  try {
    const envio = await EnvioEfectivo.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (req.user.role !== 'ADMIN' && envio.estado !== 'ENVIADO') return res.status(400).json({ error: 'El envío ya fue confirmado' });

    const { montoConfirmado, comentario } = req.body;
    if (montoConfirmado === undefined || montoConfirmado === null || montoConfirmado === '') {
      return res.status(400).json({ error: 'Falta el monto confirmado' });
    }
    envio.estado = 'CONFIRMADO';
    envio.montoConfirmado = Number(montoConfirmado);
    envio.confirmadoPor = req.user.username || '';
    envio.fechaConfirmacion = new Date();
    if (comentario !== undefined) envio.comentario = comentario;
    await envio.save();
    res.json(envio);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Oficina (ciclo diario) ────────────────────────────────────────────────
router.get('/oficina/dia', requireRol('OFICINA', 'SUPERVISOR', 'GERENCIA'), async (req, res) => {
  try {
    const { operacion, fecha } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
    const dia = await CierreOficinaDiario.findOne({ operacion, fecha: new Date(fecha) }).lean();
    res.json(dia);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/oficina/dia/abrir', requireRol('OFICINA'), async (req, res) => {
  try {
    const { operacion, fecha, conteoApertura } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha || !conteoApertura) return res.status(400).json({ error: 'Faltan datos' });
    const existente = await CierreOficinaDiario.findOne({ operacion, fecha: new Date(fecha) });
    if (existente) return res.status(400).json({ error: 'Ese día ya fue abierto' });
    const dia = await CierreOficinaDiario.create({
      operacion, fecha: new Date(fecha), conteoApertura,
      abiertoPor: req.user.username || '', fechaApertura: new Date(),
    });
    res.json(dia);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ese día ya fue abierto' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/oficina/dia/cerrar', requireRol('OFICINA'), async (req, res) => {
  try {
    const { operacion, fecha, conteoCierre, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha || !conteoCierre) return res.status(400).json({ error: 'Faltan datos' });
    const dia = await CierreOficinaDiario.findOne({ operacion, fecha: new Date(fecha) });
    if (!dia || !dia.fechaApertura) return res.status(400).json({ error: 'Ese día todavía no se abrió' });
    if (dia.fechaCierre) return res.status(400).json({ error: 'Ese día ya fue cerrado' });
    dia.conteoCierre = conteoCierre;
    dia.cerradoPor = req.user.username || '';
    dia.fechaCierre = new Date();
    if (comentario !== undefined) dia.comentario = comentario;
    await dia.save();
    res.json(dia);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita directamente cualquier campo de un día de Oficina (fecha, conteos,
// apertura/cierre, comentario) — solo ADMIN, sin restricción de estado. Permite
// incluso "reabrir" un día ya cerrado (fechaCierre: null).
router.put('/oficina/dia/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const dia = await CierreOficinaDiario.findById(req.params.id);
    if (!dia) return res.status(404).json({ error: 'Día no encontrado' });

    const { fecha, conteoApertura, conteoCierre, comentario, cerrado } = req.body;
    if (fecha !== undefined) dia.fecha = new Date(fecha);
    if (conteoApertura !== undefined) dia.conteoApertura = conteoApertura;
    if (conteoCierre !== undefined) dia.conteoCierre = conteoCierre;
    if (comentario !== undefined) dia.comentario = comentario;
    // `cerrado` es explícito (no se infiere de si mandaron conteoCierre, que
    // siempre viaja desde el formulario de edición aunque esté vacío).
    if (cerrado === true && !dia.fechaCierre) { dia.fechaCierre = new Date(); dia.cerradoPor = dia.cerradoPor || req.user.username || ''; }
    else if (cerrado === false) { dia.fechaCierre = null; dia.cerradoPor = ''; }
    await dia.save();
    res.json(dia);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe un día con esa operación/fecha' });
    res.status(500).json({ error: e.message });
  }
});

// Borra por completo un día de Oficina (lo que registró Oficina) y su conteo de
// supervisor — solo ADMIN. Bloqueado si ya hay un depósito de Oficina registrado
// dentro de su ventana de apertura/cierre, para no dejar un DepositoBanco huérfano.
router.delete('/oficina/dia/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const dia = await CierreOficinaDiario.findById(req.params.id);
    if (!dia) return res.status(404).json({ error: 'Día no encontrado' });
    const confirmarDeposito = req.query.confirmarDeposito === 'true';

    const ini = dia.fechaApertura || dia.fecha;
    const fin = dia.fechaCierre || new Date(dia.fecha.getTime() + 86400000);
    const depositos = await DepositoBanco.find({ operacion: dia.operacion, origen: 'OFICINA', fechaRegistro: { $gte: ini, $lt: fin } }).lean();

    if (depositos.length && !confirmarDeposito) {
      return res.status(409).json({
        error: 'Este día ya tiene depósito(s) registrado(s)',
        requiereConfirmarDeposito: true,
      });
    }
    for (const dep of depositos) await borrarDepositoYLiberar(dep._id);

    await Promise.all([
      SupervisorConteo.deleteOne({ ubicacion: 'OFICINA', refId: dia._id }),
      CierreOficinaDiario.deleteOne({ _id: dia._id }),
    ]);
    res.json({ ok: true, depositosBorrados: depositos.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Depósitos al banco (CAJA si no hay oficina, OFICINA si la hay) ────────
router.get('/depositos/disponibles', async (req, res) => {
  try {
    const { operacion, moneda } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    const { tieneOficina } = await configDe(operacion);
    const campoClaim = moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';

    if (tieneOficina) {
      if (!tieneRol(req.user, 'OFICINA')) return res.status(403).json({ error: 'Sin permiso' });
      const envios = await EnvioEfectivo.find({ operacion, estado: 'CONFIRMADO', moneda, depositoId: null }).lean();
      // La fecha que importa para el cuadre es la del turno donde se generó el
      // efectivo (cuándo se cobró), no la de cuándo Oficina confirmó el envío —
      // pueden ser días distintos.
      const turnos = await TurnoCaja.find({ _id: { $in: envios.map(e => e.origenTurnoId) } }, 'fecha turno').lean();
      const turnoPorId = {};
      turnos.forEach(t => { turnoPorId[String(t._id)] = t; });
      const disponibles = envios
        .map(e => {
          const t = turnoPorId[String(e.origenTurnoId)];
          return { tipo: 'ENVIO', id: e._id, fecha: t ? t.fecha : e.fechaConfirmacion, turno: t?.turno, monto: e.montoConfirmado, venta: e.montoVenta, tip: e.montoTip };
        })
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      res.json(disponibles);
    } else {
      if (!tieneRol(req.user, 'CAJA')) return res.status(403).json({ error: 'Sin permiso' });
      // Incluye turnos ABIERTO también (no solo CERRADO): se puede depositar
      // contra el turno en curso y seguir editando el depósito hasta cerrarlo.
      const turnos = await TurnoCaja.find({ operacion, [campoClaim]: null }).sort({ fecha: 1 }).lean();
      const turnoIds = turnos.map(t => t._id);
      const movimientos = await MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean();
      const movPorTurno = {};
      movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });
      const disponibles = turnos
        .map(t => {
          const { venta, tip } = netoVentaTip(movPorTurno[String(t._id)] || [], moneda);
          return { tipo: 'TURNO', id: t._id, fecha: t.fecha, turno: t.turno, monto: venta + tip, venta, tip };
        })
        .filter(x => x.monto > 0);
      res.json(disponibles);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/depositos', async (req, res) => {
  try {
    const { operacion, moneda, montoDepositado, fechaDeposito, cubre, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['PEN', 'USD'].includes(moneda) || !montoDepositado || !fechaDeposito) return res.status(400).json({ error: 'Faltan datos' });
    if (!Array.isArray(cubre) || !cubre.length) return res.status(400).json({ error: 'Selecciona al menos un turno/envío' });

    const { tieneOficina } = await configDe(operacion);
    const origen = tieneOficina ? 'OFICINA' : 'CAJA';
    if (!tieneRol(req.user, origen)) return res.status(403).json({ error: 'Sin permiso' });

    let resultado;
    try { resultado = await calcularCubre(origen, operacion, moneda, cubre); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const { cubreCalculado, totalCubierto, montoVenta, montoTip } = resultado;
    const vigenteId = await vigenteDe(origen, operacion);

    const deposito = await DepositoBanco.create({
      operacion, origen, moneda, montoDepositado: Number(montoDepositado), fechaDeposito: new Date(fechaDeposito),
      cubre: cubreCalculado, totalCubierto, diferencia: Number(montoDepositado) - totalCubierto,
      montoVenta, montoTip,
      turnoVigenteId: origen === 'CAJA' ? vigenteId : null,
      diaVigenteId: origen === 'OFICINA' ? vigenteId : null,
      registradoPor: req.user.username || '', comentario: comentario || '',
    });
    await reclamarCubre(origen, moneda, cubreCalculado, deposito._id);
    res.json(deposito);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Depósitos propios (CAJA u OFICINA, según corresponda) que todavía son
// editables — para mostrar un botón "Editar" en la pantalla operativa.
router.get('/depositos/editables', async (req, res) => {
  try {
    const { operacion, moneda } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    const { tieneOficina } = await configDe(operacion);
    const origen = tieneOficina ? 'OFICINA' : 'CAJA';
    if (!tieneRol(req.user, origen)) return res.status(403).json({ error: 'Sin permiso' });

    const depositos = await DepositoBanco.find({ operacion, moneda, origen }).sort({ fechaRegistro: -1 }).limit(20).lean();
    if (req.user.role === 'ADMIN') return res.json(depositos); // ADMIN: todos, sin filtrar por editable
    const editables = [];
    for (const dep of depositos) {
      if (await depositoEsEditable(dep)) editables.push(dep);
    }
    res.json(editables);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edita un depósito ya registrado — permitido solo mientras sigue "abierto"
// (ver `depositoEsEditable`): sus turnos (CAJA) todavía no cerraron, o el día
// de Oficina donde se registró todavía no cerró. Recalcula todo desde cero con
// la selección nueva (misma validación que al crear).
router.put('/depositos/:id', async (req, res) => {
  try {
    const deposito = await DepositoBanco.findById(req.params.id);
    if (!deposito) return res.status(404).json({ error: 'Depósito no encontrado' });
    if (!checkOpAccess(req.user, deposito.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!tieneRol(req.user, deposito.origen)) return res.status(403).json({ error: 'Sin permiso' });
    if (req.user.role !== 'ADMIN' && !(await depositoEsEditable(deposito))) {
      return res.status(400).json({ error: 'Este depósito ya no se puede editar (el turno o el día ya se cerró)' });
    }

    const { moneda, montoDepositado, fechaDeposito, cubre, comentario } = req.body;
    if (!['PEN', 'USD'].includes(moneda) || !montoDepositado || !fechaDeposito) return res.status(400).json({ error: 'Faltan datos' });
    if (!Array.isArray(cubre) || !cubre.length) return res.status(400).json({ error: 'Selecciona al menos un turno/envío' });

    const cubreViejo = deposito.cubre, monedaVieja = deposito.moneda;
    await liberarCubre(deposito);

    let resultado;
    try { resultado = await calcularCubre(deposito.origen, deposito.operacion, moneda, cubre); }
    catch (err) {
      await reclamarCubre(deposito.origen, monedaVieja, cubreViejo, deposito._id); // revertir la liberación
      return res.status(400).json({ error: err.message });
    }
    const { cubreCalculado, totalCubierto, montoVenta, montoTip } = resultado;
    await reclamarCubre(deposito.origen, moneda, cubreCalculado, deposito._id);

    deposito.moneda = moneda;
    deposito.montoDepositado = Number(montoDepositado);
    deposito.fechaDeposito = new Date(fechaDeposito);
    deposito.cubre = cubreCalculado;
    deposito.totalCubierto = totalCubierto;
    deposito.diferencia = Number(montoDepositado) - totalCubierto;
    deposito.montoVenta = montoVenta;
    deposito.montoTip = montoTip;
    if (comentario !== undefined) deposito.comentario = comentario;
    await deposito.save();
    res.json(deposito);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Supervisor (conteo independiente al cierre) ───────────────────────────
router.get('/supervisor/pendientes', requireRol('SUPERVISOR'), async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const [turnosCerrados, diasCerrados, conteos] = await Promise.all([
      TurnoCaja.find({ operacion, estado: 'CERRADO' }).sort({ fecha: -1 }).lean(),
      CierreOficinaDiario.find({ operacion, fechaCierre: { $ne: null } }).sort({ fecha: -1 }).lean(),
      SupervisorConteo.find({ operacion }).lean(),
    ]);
    const yaContado = new Set(conteos.map(c => `${c.ubicacion}:${c.refId}`));
    const tienda = turnosCerrados.filter(t => !yaContado.has(`TIENDA:${t._id}`));

    // TIP Facturado por turno — dato informativo (no efectivo), se muestra junto al
    // turno pendiente de contar como referencia para el supervisor.
    const movimientos = await MovimientoEfectivoCaja.find({ turnoId: { $in: tienda.map(t => t._id) }, tipo: 'TIP_FACTURADO' }).lean();
    const tipFacturadoPorTurno = {};
    movimientos.forEach(m => { const k = String(m.turnoId); tipFacturadoPorTurno[k] = (tipFacturadoPorTurno[k] || 0) + m.monto; });

    res.json({
      tienda: tienda.map(t => ({ ...t, tipFacturado: tipFacturadoPorTurno[String(t._id)] || 0 })),
      oficina: diasCerrados.filter(d => !yaContado.has(`OFICINA:${d._id}`)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/supervisor/conteo', requireRol('SUPERVISOR'), async (req, res) => {
  try {
    const { operacion, ubicacion, refId, conteo, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['TIENDA', 'OFICINA'].includes(ubicacion) || !refId || !conteo) return res.status(400).json({ error: 'Faltan datos' });

    const ref = ubicacion === 'TIENDA' ? await TurnoCaja.findById(refId).lean() : await CierreOficinaDiario.findById(refId).lean();
    if (!ref || ref.operacion !== operacion) return res.status(400).json({ error: 'Referencia inválida' });

    const doc = await SupervisorConteo.findOneAndUpdate(
      { ubicacion, refId },
      { $set: {
          operacion, fecha: ref.fecha, conteo,
          supervisadoPor: req.user.username || '', fechaRegistro: new Date(),
          ...(comentario !== undefined && { comentario }),
        } },
      { new: true, upsert: true }
    );
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Contabilidad (solo lectura) ────────────────────────────────────────────
router.get('/contabilidad/movimientos', requireRol('CONTABILIDAD', 'GERENCIA'), async (req, res) => {
  try {
    const { operacion, desde, hasta } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const fDesde = desde ? new Date(desde) : new Date('2000-01-01');
    const fHasta = hasta ? new Date(hasta) : new Date('2100-01-01');
    fHasta.setHours(23, 59, 59, 999);

    const turnos = await TurnoCaja.find({ operacion, fecha: { $gte: fDesde, $lte: fHasta } }).sort({ fecha: 1 }).lean();
    const turnoIds = turnos.map(t => t._id);
    const [movimientos, cobranzasErp] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean(),
      CobranzaEfectivoErp.find({ operacion, fecha: { $gte: fDesde, $lte: fHasta } }).lean(),
    ]);
    const movPorTurno = {};
    movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });
    const erpPorDia = {};
    cobranzasErp.forEach(c => { const k = ymd(c.fecha); erpPorDia[k] = (erpPorDia[k] || 0) + c.efectivo; });

    const porDia = {};
    const diaVacio = k => ({ fecha: k, VENTA_PEN: 0, VENTA_USD: 0, TIP_PEN: 0, TIP_USD: 0, VUELTO_PEN: 0, TIP_FACTURADO_PEN: 0, turnos: 0, turnosCerrados: 0 });
    turnos.forEach(t => {
      const k = ymd(t.fecha);
      if (!porDia[k]) porDia[k] = diaVacio(k);
      const d = porDia[k];
      d.turnos++;
      if (t.estado === 'CERRADO') d.turnosCerrados++;
      (movPorTurno[String(t._id)] || []).forEach(m => {
        const key = `${m.tipo}_${m.moneda}`;
        if (d[key] !== undefined) d[key] += m.monto;
      });
    });
    // Días que el ERP trae pero no tienen turno registrado en el módulo (ej. antes
    // de usarlo, o se olvidaron de abrir caja) también se muestran, en 0, para que
    // la diferencia contra el ERP quede visible igual.
    Object.keys(erpPorDia).forEach(k => { if (!porDia[k]) porDia[k] = diaVacio(k); });

    const dias = Object.values(porDia).map(d => {
      const erp = erpPorDia[d.fecha] ?? null;
      return { ...d, cobranzaErp: erp, diferenciaErp: erp === null ? null : d.VENTA_PEN - erp };
    });
    res.json(dias.sort((a, b) => a.fecha.localeCompare(b.fecha)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/contabilidad/depositos', requireRol('CONTABILIDAD', 'GERENCIA'), async (req, res) => {
  try {
    const { operacion, desde, hasta } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const filter = { operacion };
    if (desde || hasta) {
      filter.fechaDeposito = {};
      if (desde) filter.fechaDeposito.$gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setHours(23, 59, 59, 999); filter.fechaDeposito.$lte = h; }
    }
    const depositos = await DepositoBanco.find(filter).sort({ fechaDeposito: -1 }).lean();
    res.json(depositos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Gerencia (solo lectura: saldo teórico vs conteo del supervisor) ───────
// Saldo teórico (calculado) vs. conteo del supervisor, por turno de Tienda y por
// día de Oficina, para un rango de fechas (un solo día = desde===hasta). Lo usan
// tanto Gerencia (un día) como Contabilidad (rango) — mismo endpoint.
router.get('/gerencia/teorico', requireRol('GERENCIA', 'CONTABILIDAD'), async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const fDesde = req.query.desde ? new Date(req.query.desde) : (req.query.fecha ? new Date(req.query.fecha) : null);
    const fHasta = req.query.hasta ? new Date(req.query.hasta) : fDesde;
    if (!fDesde || !fHasta) return res.status(400).json({ error: 'Falta la fecha' });
    const fHastaSiguiente = new Date(fHasta.getTime() + 86400000);

    const turnos = await TurnoCaja.find({ operacion, fecha: { $gte: fDesde, $lt: fHastaSiguiente } }).lean();
    const turnoIds = turnos.map(t => t._id);
    const dias = await CierreOficinaDiario.find({ operacion, fecha: { $gte: fDesde, $lt: fHastaSiguiente } }).lean();
    // Margen de 2 días para las ventanas de apertura/cierre de oficina, por si
    // caen justo en el borde del rango pedido.
    const margen = 2 * 86400000;
    const [movimientos, envios, supervisor, recibidosOficina, depositosOficina] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean(),
      EnvioEfectivo.find({ origenTurnoId: { $in: turnoIds } }).lean(),
      SupervisorConteo.find({ operacion, fecha: { $gte: fDesde, $lt: fHastaSiguiente } }).lean(),
      EnvioEfectivo.find({ operacion, estado: 'CONFIRMADO', fechaConfirmacion: { $gte: new Date(fDesde.getTime() - margen), $lt: new Date(fHastaSiguiente.getTime() + margen) } }).lean(),
      DepositoBanco.find({ operacion, origen: 'OFICINA', fechaRegistro: { $gte: new Date(fDesde.getTime() - margen), $lt: new Date(fHastaSiguiente.getTime() + margen) } }).lean(),
    ]);

    const movPorTurno = {};
    movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });
    const enviosPorTurno = {};
    envios.forEach(e => { (enviosPorTurno[String(e.origenTurnoId)] || (enviosPorTurno[String(e.origenTurnoId)] = [])).push(e); });
    const supPorRef = {};
    supervisor.forEach(s => { supPorRef[`${s.ubicacion}:${s.refId}`] = s; });

    function saldoTurno(t) {
      const movs = movPorTurno[String(t._id)] || [];
      const envs = enviosPorTurno[String(t._id)] || [];
      const sup = supPorRef[`TIENDA:${t._id}`] || null;
      const saldo = {};
      ['PEN', 'USD'].forEach(mon => {
        const key = mon.toLowerCase();
        // Egreso de custodia: enviado a Oficina (operaciones con oficina) +
        // depositado directo al banco (operaciones sin oficina) — solo uno de los
        // dos aplica por operación, pero se suman ambos por si acaso sin riesgo.
        const enviadoOficina = envs.filter(e => e.moneda === mon).reduce((s, e) => s + e.montoEnviado, 0);
        const depositadoDirecto = (t[mon === 'PEN' ? 'depositoPenId' : 'depositoUsdId']) ? netoIngresos(movs, mon) : 0;
        const egreso = enviadoOficina + depositadoDirecto;
        const calculado = sumaConteo(t.conteoApertura, key) + netoIngresos(movs, mon) - egreso;
        const conteoCajero = t.conteoCierre ? sumaConteo(t.conteoCierre, key) : null;
        const conteoSupervisor = sup ? sumaConteo(sup.conteo, key) : null;
        saldo[mon] = {
          saldoCalculado: calculado,
          conteoCajero, diferenciaCajero: conteoCajero === null ? null : conteoCajero - calculado,
          conteoSupervisor, diferenciaSupervisor: conteoSupervisor === null ? null : conteoSupervisor - calculado,
        };
      });
      return saldo;
    }

    function saldoOficina(dia) {
      const ini = dia.fechaApertura || dia.fecha;
      const fin = dia.fechaCierre || new Date(dia.fecha.getTime() + 86400000);
      const recibidos = recibidosOficina.filter(e => e.fechaConfirmacion >= ini && e.fechaConfirmacion < fin);
      const depositado = depositosOficina.filter(d => d.fechaRegistro >= ini && d.fechaRegistro < fin);
      const sup = supPorRef[`OFICINA:${dia._id}`] || null;
      const saldo = {};
      ['PEN', 'USD'].forEach(mon => {
        const key = mon.toLowerCase();
        const ingreso = recibidos.filter(e => e.moneda === mon).reduce((s, e) => s + e.montoConfirmado, 0);
        const egreso = depositado.filter(d => d.moneda === mon).reduce((s, d) => s + d.montoDepositado, 0);
        const calculado = sumaConteo(dia.conteoApertura, key) + ingreso - egreso;
        const conteoCajero = dia.conteoCierre ? sumaConteo(dia.conteoCierre, key) : null;
        const conteoSupervisor = sup ? sumaConteo(sup.conteo, key) : null;
        saldo[mon] = {
          saldoCalculado: calculado,
          conteoCajero, diferenciaCajero: conteoCajero === null ? null : conteoCajero - calculado,
          conteoSupervisor, diferenciaSupervisor: conteoSupervisor === null ? null : conteoSupervisor - calculado,
        };
      });
      return saldo;
    }

    const porDia = {};
    turnos.forEach(t => {
      const k = ymd(t.fecha);
      if (!porDia[k]) porDia[k] = { fecha: k, tienda: [], oficina: null };
      porDia[k].tienda.push({ turno: t, saldo: saldoTurno(t) });
    });
    dias.forEach(d => {
      const k = ymd(d.fecha);
      if (!porDia[k]) porDia[k] = { fecha: k, tienda: [], oficina: null };
      porDia[k].oficina = { dia: d, saldo: saldoOficina(d) };
    });

    res.json(Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

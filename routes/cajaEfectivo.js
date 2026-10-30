const express = require('express');
const auth = require('../middleware/auth');

const CajaEfectivoConfig = require('../models/CajaEfectivoConfig');
const TurnoCaja = require('../models/TurnoCaja');
const MovimientoEfectivoCaja = require('../models/MovimientoEfectivoCaja');
const EnvioEfectivo = require('../models/EnvioEfectivo');
const CierreOficinaDiario = require('../models/CierreOficinaDiario');
const DepositoBanco = require('../models/DepositoBanco');
const SupervisorConteo = require('../models/SupervisorConteo');
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
  let s = 0;
  movimientos.forEach(m => {
    if (m.moneda !== monedaUpper) return;
    if (m.tipo === 'VUELTO') s -= m.monto; else s += m.monto;
  });
  return s;
}
async function configDe(operacion) {
  const cfg = await CajaEfectivoConfig.findOne({ operacion }).lean();
  return cfg || { tieneOficina: false, turnos: [], fondoFijoCaja: { pen: 0, usd: 0 }, fondoFijoOficina: { pen: 0, usd: 0 } };
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
    if (turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno ya está cerrado' });

    const { tipo, moneda, monto, comentario } = req.body;
    if (!['VENTA', 'TIP', 'VUELTO'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    if (!['PEN', 'USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    if (tipo === 'VUELTO' && moneda !== 'PEN') return res.status(400).json({ error: 'El vuelto siempre es en soles' });
    if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'Falta el monto' });

    const mov = await MovimientoEfectivoCaja.create({
      turnoId: turno._id, operacion: turno.operacion, fecha: turno.fecha,
      tipo, moneda, monto: Number(monto),
      comentario: comentario || '', creadoPor: req.user.username || '',
    });
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

router.get('/envios/pendientes', requireRol('OFICINA'), async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const envios = await EnvioEfectivo.find({ operacion, estado: 'ENVIADO' }).sort({ fechaEnvio: 1 }).lean();
    res.json(envios);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/envios/:id/confirmar', requireRol('OFICINA'), async (req, res) => {
  try {
    const envio = await EnvioEfectivo.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (envio.estado !== 'ENVIADO') return res.status(400).json({ error: 'El envío ya fue confirmado' });

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
      const envios = await EnvioEfectivo.find({ operacion, estado: 'CONFIRMADO', moneda, depositoId: null }).sort({ fechaConfirmacion: 1 }).lean();
      res.json(envios.map(e => ({ tipo: 'ENVIO', id: e._id, fecha: e.fechaConfirmacion, monto: e.montoConfirmado })));
    } else {
      if (!tieneRol(req.user, 'CAJA')) return res.status(403).json({ error: 'Sin permiso' });
      const turnos = await TurnoCaja.find({ operacion, estado: 'CERRADO', [campoClaim]: null }).sort({ fecha: 1 }).lean();
      const turnoIds = turnos.map(t => t._id);
      const movimientos = await MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean();
      const movPorTurno = {};
      movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });
      const disponibles = turnos
        .map(t => ({ tipo: 'TURNO', id: t._id, fecha: t.fechaCierre || t.fecha, turno: t.turno, monto: netoIngresos(movPorTurno[String(t._id)] || [], moneda) }))
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

    const cubreCalculado = [];
    if (origen === 'OFICINA') {
      for (const item of cubre) {
        const envio = await EnvioEfectivo.findOne({ _id: item.id, operacion, estado: 'CONFIRMADO', moneda, depositoId: null });
        if (!envio) return res.status(400).json({ error: 'Un envío seleccionado ya no está disponible' });
        cubreCalculado.push({ tipo: 'ENVIO', id: envio._id, fecha: envio.fechaConfirmacion, monto: envio.montoConfirmado });
      }
    } else {
      const campoClaim = moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';
      for (const item of cubre) {
        const turno = await TurnoCaja.findOne({ _id: item.id, operacion, estado: 'CERRADO', [campoClaim]: null });
        if (!turno) return res.status(400).json({ error: 'Un turno seleccionado ya no está disponible' });
        const movimientos = await MovimientoEfectivoCaja.find({ turnoId: turno._id }).lean();
        const monto = netoIngresos(movimientos, moneda);
        cubreCalculado.push({ tipo: 'TURNO', id: turno._id, fecha: turno.fechaCierre || turno.fecha, monto });
      }
    }

    const totalCubierto = cubreCalculado.reduce((s, c) => s + c.monto, 0);
    const deposito = await DepositoBanco.create({
      operacion, origen, moneda, montoDepositado: Number(montoDepositado), fechaDeposito: new Date(fechaDeposito),
      cubre: cubreCalculado, totalCubierto, diferencia: Number(montoDepositado) - totalCubierto,
      registradoPor: req.user.username || '', comentario: comentario || '',
    });

    if (origen === 'OFICINA') {
      await EnvioEfectivo.updateMany({ _id: { $in: cubreCalculado.map(c => c.id) } }, { $set: { depositoId: deposito._id } });
    } else {
      const campoClaim = moneda === 'PEN' ? 'depositoPenId' : 'depositoUsdId';
      await TurnoCaja.updateMany({ _id: { $in: cubreCalculado.map(c => c.id) } }, { $set: { [campoClaim]: deposito._id } });
    }
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

    res.json({
      tienda: turnosCerrados.filter(t => !yaContado.has(`TIENDA:${t._id}`)),
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
    const movimientos = await MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean();
    const movPorTurno = {};
    movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });

    const porDia = {};
    turnos.forEach(t => {
      const k = ymd(t.fecha);
      if (!porDia[k]) porDia[k] = { fecha: k, VENTA_PEN: 0, VENTA_USD: 0, TIP_PEN: 0, TIP_USD: 0, VUELTO_PEN: 0, turnos: 0, turnosCerrados: 0 };
      const d = porDia[k];
      d.turnos++;
      if (t.estado === 'CERRADO') d.turnosCerrados++;
      (movPorTurno[String(t._id)] || []).forEach(m => {
        const key = `${m.tipo}_${m.moneda}`;
        if (d[key] !== undefined) d[key] += m.monto;
      });
    });
    res.json(Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha)));
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
router.get('/gerencia/teorico', requireRol('GERENCIA'), async (req, res) => {
  try {
    const { operacion, fecha } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
    const f = new Date(fecha);
    const fSiguiente = new Date(f.getTime() + 86400000);

    const turnos = await TurnoCaja.find({ operacion, fecha: f }).lean();
    const turnoIds = turnos.map(t => t._id);
    const [movimientos, envios, supervisorTienda] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean(),
      EnvioEfectivo.find({ origenTurnoId: { $in: turnoIds } }).lean(),
      SupervisorConteo.find({ ubicacion: 'TIENDA', refId: { $in: turnoIds } }).lean(),
    ]);
    const movPorTurno = {};
    movimientos.forEach(m => { (movPorTurno[String(m.turnoId)] || (movPorTurno[String(m.turnoId)] = [])).push(m); });
    const enviosPorTurno = {};
    envios.forEach(e => { (enviosPorTurno[String(e.origenTurnoId)] || (enviosPorTurno[String(e.origenTurnoId)] = [])).push(e); });
    const supervisorPorTurno = {};
    supervisorTienda.forEach(s => { supervisorPorTurno[String(s.refId)] = s; });

    const tienda = turnos.map(t => {
      const movs = movPorTurno[String(t._id)] || [];
      const envs = enviosPorTurno[String(t._id)] || [];
      const sup = supervisorPorTurno[String(t._id)] || null;
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
        const conteoSupervisor = sup ? sumaConteo(sup.conteo, key) : null;
        saldo[mon] = { saldoCalculado: calculado, conteoSupervisor, diferencia: conteoSupervisor === null ? null : conteoSupervisor - calculado };
      });
      return { turno: t, saldo };
    });

    let oficina = null;
    const dia = await CierreOficinaDiario.findOne({ operacion, fecha: f }).lean();
    if (dia) {
      const [recibidos, depositado, supDia] = await Promise.all([
        EnvioEfectivo.find({ operacion, estado: 'CONFIRMADO', fechaConfirmacion: { $gte: dia.fechaApertura || f, $lt: dia.fechaCierre || fSiguiente } }).lean(),
        DepositoBanco.find({ operacion, origen: 'OFICINA', fechaRegistro: { $gte: dia.fechaApertura || f, $lt: dia.fechaCierre || fSiguiente } }).lean(),
        SupervisorConteo.findOne({ ubicacion: 'OFICINA', refId: dia._id }).lean(),
      ]);
      const saldo = {};
      ['PEN', 'USD'].forEach(mon => {
        const key = mon.toLowerCase();
        const ingreso = recibidos.filter(e => e.moneda === mon).reduce((s, e) => s + e.montoConfirmado, 0);
        const egreso = depositado.filter(d => d.moneda === mon).reduce((s, d) => s + d.montoDepositado, 0);
        const calculado = sumaConteo(dia.conteoApertura, key) + ingreso - egreso;
        const conteoSupervisor = supDia ? sumaConteo(supDia.conteo, key) : null;
        saldo[mon] = { saldoCalculado: calculado, conteoSupervisor, diferencia: conteoSupervisor === null ? null : conteoSupervisor - calculado };
      });
      oficina = { dia, saldo };
    }

    res.json({ tienda, oficina });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

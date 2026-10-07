const express = require('express');
const auth = require('../middleware/auth');

const CajaEfectivoConfig = require('../models/CajaEfectivoConfig');
const TurnoCaja = require('../models/TurnoCaja');
const MovimientoEfectivoCaja = require('../models/MovimientoEfectivoCaja');
const EnvioEfectivo = require('../models/EnvioEfectivo');
const CierreOficinaDiario = require('../models/CierreOficinaDiario');
const Operacion = require('../models/Operacion');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolCajaEfectivo) return next();
  return res.status(403).json({ error: 'Sin acceso a Cierre de Caja' });
}
router.use(requireAccess);

/** Operaciones autorizadas del usuario (null = todas, solo ADMIN) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}
function rol(user) {
  return user.role === 'ADMIN' ? 'ADMIN' : (user.rolCajaEfectivo || '');
}
function requireRol(...roles) {
  return (req, res, next) => {
    const r = rol(req.user);
    if (r === 'ADMIN' || roles.includes(r)) return next();
    return res.status(403).json({ error: 'Rol sin permiso para esta acción' });
  };
}

const ymd = d => new Date(d).toISOString().slice(0, 10);
// conteo = { pen: {denom: qty}, usd: {denom: qty} }; moneda = 'pen'|'usd'
function sumaConteo(conteo, moneda) {
  if (!conteo || !conteo[moneda]) return 0;
  return Object.entries(conteo[moneda]).reduce((s, [denom, qty]) => s + Number(denom) * Number(qty || 0), 0);
}
async function configDe(operacion) {
  const cfg = await CajaEfectivoConfig.findOne({ operacion }).lean();
  return { tieneOficina: cfg?.tieneOficina || false, turnos: cfg?.turnos || [] };
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
    res.json(operaciones.map(o => ({
      operacion: o.codigo, nombre: o.nombre,
      tieneOficina: byOp[o.codigo]?.tieneOficina || false,
      turnos: byOp[o.codigo]?.turnos || [],
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config/:operacion', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { operacion } = req.params;
    const { tieneOficina, turnos } = req.body;
    const cfg = await CajaEfectivoConfig.findOneAndUpdate(
      { operacion },
      { $set: {
          ...(tieneOficina !== undefined && { tieneOficina: !!tieneOficina }),
          ...(turnos !== undefined && { turnos: Array.isArray(turnos) ? turnos.map(t => String(t).trim()).filter(Boolean) : [] }),
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

// ─── Turnos (rol CAJA) ─────────────────────────────────────────────────────
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

    const { tipo, moneda, monto, monedaIngreso, montoIngreso, monedaEgreso, montoEgreso, comentario } = req.body;
    if (!['VENTA', 'TIP_COMERCIAL', 'TIP_TIENDA', 'CAMBIO_MONEDA'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    }

    const data = {
      turnoId: turno._id, operacion: turno.operacion, fecha: turno.fecha, tipo,
      comentario: comentario || '', creadoPor: req.user.username || '',
    };
    if (tipo === 'CAMBIO_MONEDA') {
      if (!monedaIngreso || !montoIngreso || !monedaEgreso || !montoEgreso) {
        return res.status(400).json({ error: 'Faltan los montos del cambio de moneda' });
      }
      if (monedaIngreso === monedaEgreso) {
        return res.status(400).json({ error: 'El ingreso y el vuelto deben ser en monedas distintas' });
      }
      Object.assign(data, { monedaIngreso, montoIngreso: Number(montoIngreso), monedaEgreso, montoEgreso: Number(montoEgreso) });
    } else {
      if (!moneda || !monto) return res.status(400).json({ error: 'Faltan moneda/monto' });
      Object.assign(data, { moneda, monto: Number(monto) });
    }
    const mov = await MovimientoEfectivoCaja.create(data);
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

    const { conteoCierre, ventaPorCanal, tipFacturado, comentario } = req.body;
    if (!conteoCierre) return res.status(400).json({ error: 'Falta el conteo de cierre' });

    turno.estado = 'CERRADO';
    turno.conteoCierre = conteoCierre;
    turno.ventaPorCanal = {
      LOCAL: Number(ventaPorCanal?.LOCAL) || 0,
      LLEVAR: Number(ventaPorCanal?.LLEVAR) || 0,
      DELIVERY: Number(ventaPorCanal?.DELIVERY) || 0,
      COMERCIAL: Number(ventaPorCanal?.COMERCIAL) || 0,
      OTROS: Number(ventaPorCanal?.OTROS) || 0,
    };
    turno.tipFacturado = Number(tipFacturado) || 0;
    turno.cerradoPor = req.user.username || '';
    turno.fechaCierre = new Date();
    if (comentario !== undefined) turno.comentario = comentario;
    await turno.save();
    res.json(turno);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Envíos (transferencias de custodia Caja→Oficina/Banco, Oficina→Banco) ─
router.post('/envios', async (req, res) => {
  try {
    const { operacion, origen, origenTurnoId, moneda, montoEnviado, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['CAJA', 'OFICINA'].includes(origen)) return res.status(400).json({ error: 'Origen inválido' });
    if (!['PEN', 'USD'].includes(moneda) || !montoEnviado) return res.status(400).json({ error: 'Faltan moneda/monto' });

    const r = rol(req.user);
    if (origen === 'CAJA' && !['ADMIN', 'CAJA'].includes(r)) return res.status(403).json({ error: 'Rol sin permiso para enviar desde Caja' });
    if (origen === 'OFICINA' && !['ADMIN', 'OFICINA'].includes(r)) return res.status(403).json({ error: 'Rol sin permiso para enviar desde Oficina' });

    let destino;
    if (origen === 'OFICINA') {
      destino = 'BANCO';
    } else {
      const { tieneOficina } = await configDe(operacion);
      destino = tieneOficina ? 'OFICINA' : 'BANCO';
      if (!origenTurnoId) return res.status(400).json({ error: 'Falta el turno de origen' });
      const turno = await TurnoCaja.findById(origenTurnoId);
      if (!turno || turno.estado !== 'ABIERTO') return res.status(400).json({ error: 'El turno de origen no está abierto' });
    }

    const envio = await EnvioEfectivo.create({
      operacion, origen,
      origenTurnoId: origen === 'CAJA' ? origenTurnoId : null,
      destino, moneda, montoEnviado: Number(montoEnviado),
      enviadoPor: req.user.username || '', comentario: comentario || '',
    });
    res.json(envio);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/envios/pendientes', async (req, res) => {
  try {
    const { operacion, destino } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!['OFICINA', 'BANCO'].includes(destino)) return res.status(400).json({ error: 'Destino inválido' });

    const r = rol(req.user);
    if (destino === 'OFICINA' && !['ADMIN', 'OFICINA'].includes(r)) return res.status(403).json({ error: 'Sin permiso' });
    if (destino === 'BANCO' && !['ADMIN', 'BACKOFFICE'].includes(r)) return res.status(403).json({ error: 'Sin permiso' });

    const envios = await EnvioEfectivo.find({ operacion, destino, estado: 'ENVIADO' }).sort({ fechaEnvio: 1 }).lean();
    res.json(envios);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/envios/:id/confirmar', async (req, res) => {
  try {
    const envio = await EnvioEfectivo.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (envio.estado !== 'ENVIADO') return res.status(400).json({ error: 'El envío ya fue confirmado' });

    const r = rol(req.user);
    if (envio.destino === 'OFICINA' && !['ADMIN', 'OFICINA'].includes(r)) return res.status(403).json({ error: 'Sin permiso' });
    if (envio.destino === 'BANCO' && !['ADMIN', 'BACKOFFICE'].includes(r)) return res.status(403).json({ error: 'Sin permiso' });

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
router.get('/oficina/dia', requireRol('OFICINA', 'CONTROL', 'BACKOFFICE'), async (req, res) => {
  try {
    const { operacion, fecha } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
    const f = new Date(fecha);
    const fSiguiente = new Date(f.getTime() + 86400000);
    const [cierre, recibidos, enviados] = await Promise.all([
      CierreOficinaDiario.findOne({ operacion, fecha: f }).lean(),
      EnvioEfectivo.find({ operacion, destino: 'OFICINA', estado: 'CONFIRMADO', fechaConfirmacion: { $gte: f, $lt: fSiguiente } }).lean(),
      EnvioEfectivo.find({ operacion, origen: 'OFICINA', fechaEnvio: { $gte: f, $lt: fSiguiente } }).lean(),
    ]);
    res.json({ cierre, recibidos, enviados });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/oficina/dia/cerrar', requireRol('OFICINA'), async (req, res) => {
  try {
    const { operacion, fecha, conteoCierre, comentario } = req.body;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha || !conteoCierre) return res.status(400).json({ error: 'Faltan datos' });
    const cierre = await CierreOficinaDiario.findOneAndUpdate(
      { operacion, fecha: new Date(fecha) },
      { $set: {
          conteoCierre, cerradoPor: req.user.username || '', fechaCierre: new Date(),
          ...(comentario !== undefined && { comentario }),
        } },
      { new: true, upsert: true }
    );
    res.json(cierre);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Control (solo lectura: saldo inicial + movimientos + saldo calculado vs conteo) ──
router.get('/control/turno/:turnoId', requireRol('CONTROL'), async (req, res) => {
  try {
    const turno = await TurnoCaja.findById(req.params.turnoId).lean();
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    if (!checkOpAccess(req.user, turno.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const [movimientos, envios] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: turno._id }).sort({ fechaRegistro: 1 }).lean(),
      EnvioEfectivo.find({ origenTurnoId: turno._id }).sort({ fechaEnvio: 1 }).lean(),
    ]);

    const saldo = {};
    ['PEN', 'USD'].forEach(mon => {
      const key = mon.toLowerCase();
      let s = sumaConteo(turno.conteoApertura, key);
      movimientos.forEach(m => {
        if (m.tipo === 'CAMBIO_MONEDA') {
          if (m.monedaIngreso === mon) s += m.montoIngreso;
          if (m.monedaEgreso === mon) s -= m.montoEgreso;
        } else if (m.moneda === mon) {
          s += m.monto;
        }
      });
      envios.forEach(e => { if (e.moneda === mon) s -= e.montoEnviado; });
      const conteo = turno.conteoCierre ? sumaConteo(turno.conteoCierre, key) : null;
      saldo[mon] = { saldoCalculado: s, conteo, diferencia: conteo === null ? null : conteo - s };
    });

    res.json({ turno, movimientos, envios, saldo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/control/oficina', requireRol('CONTROL'), async (req, res) => {
  try {
    const { operacion, fecha } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
    const f = new Date(fecha);
    const fSiguiente = new Date(f.getTime() + 86400000);
    const [cierre, recibidos, enviados] = await Promise.all([
      CierreOficinaDiario.findOne({ operacion, fecha: f }).lean(),
      EnvioEfectivo.find({ operacion, destino: 'OFICINA', estado: 'CONFIRMADO', fechaConfirmacion: { $gte: f, $lt: fSiguiente } }).lean(),
      EnvioEfectivo.find({ operacion, origen: 'OFICINA', fechaEnvio: { $gte: f, $lt: fSiguiente } }).lean(),
    ]);

    const saldo = {};
    ['PEN', 'USD'].forEach(mon => {
      let s = 0;
      recibidos.forEach(e => { if (e.moneda === mon) s += e.montoConfirmado; });
      enviados.forEach(e => { if (e.moneda === mon) s -= e.montoEnviado; });
      const conteo = cierre?.conteoCierre ? sumaConteo(cierre.conteoCierre, mon.toLowerCase()) : null;
      saldo[mon] = { saldoCalculado: s, conteo, diferencia: conteo === null ? null : conteo - s };
    });

    res.json({ cierre, recibidos, enviados, saldo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Back Office (resumen mensual, solo lectura) ──────────────────────────
router.get('/backoffice/resumen', requireRol('BACKOFFICE'), async (req, res) => {
  try {
    const { operacion, anioMes } = req.query;
    if (!operacion || !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!anioMes) return res.status(400).json({ error: 'Falta el mes (YYYY-MM)' });
    const [anio, mes] = anioMes.split('-').map(Number);
    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 1);

    const turnos = await TurnoCaja.find({ operacion, fecha: { $gte: desde, $lt: hasta } }).sort({ fecha: 1 }).lean();
    const turnoIds = turnos.map(t => t._id);
    const [movimientos, enviosTurnos] = await Promise.all([
      MovimientoEfectivoCaja.find({ turnoId: { $in: turnoIds } }).lean(),
      EnvioEfectivo.find({ origenTurnoId: { $in: turnoIds } }).lean(),
    ]);
    const movPorTurno = {};
    movimientos.forEach(m => {
      const k = String(m.turnoId);
      (movPorTurno[k] || (movPorTurno[k] = [])).push(m);
    });
    const enviosPorTurno = {};
    enviosTurnos.forEach(e => {
      const k = String(e.origenTurnoId);
      (enviosPorTurno[k] || (enviosPorTurno[k] = [])).push(e);
    });

    const vacioPorTipo = () => ({ VENTA_PEN: 0, VENTA_USD: 0, TIP_COMERCIAL_PEN: 0, TIP_COMERCIAL_USD: 0, TIP_TIENDA_PEN: 0, TIP_TIENDA_USD: 0 });
    const vacioCanal = () => ({ LOCAL: 0, LLEVAR: 0, DELIVERY: 0, COMERCIAL: 0, OTROS: 0 });
    const vacioCuadreMoneda = () => ({ apertura: 0, ingresos: 0, enviado: 0, saldoCalculado: 0, conteoCierre: 0, diferencia: null });
    const vacioCuadre = () => ({ PEN: vacioCuadreMoneda(), USD: vacioCuadreMoneda() });

    // Agrupa por día (la fecha del turno, no del movimiento — un turno no cruza medianoche en este modelo)
    const porDia = {};
    turnos.forEach(t => {
      const k = ymd(t.fecha);
      if (!porDia[k]) porDia[k] = { fecha: k, porTipo: vacioPorTipo(), ventaPorCanal: vacioCanal(), tipFacturado: 0, turnos: 0, turnosCerrados: 0, cuadre: vacioCuadre() };
      const d = porDia[k];
      d.turnos++;
      if (t.estado === 'CERRADO') d.turnosCerrados++;
      Object.keys(d.ventaPorCanal).forEach(c => { d.ventaPorCanal[c] += t.ventaPorCanal?.[c] || 0; });
      d.tipFacturado += t.tipFacturado || 0;
      (movPorTurno[String(t._id)] || []).forEach(m => {
        if (m.tipo !== 'CAMBIO_MONEDA') {
          const key = `${m.tipo}_${m.moneda}`;
          d.porTipo[key] = (d.porTipo[key] || 0) + m.monto;
        }
      });

      // Cuadre de efectivo por moneda: apertura + ingresos − egresos de cambio − enviado,
      // comparado contra el conteo de cierre (mismo cálculo que /control/turno/:id, sumado
      // por todos los turnos del día).
      ['PEN', 'USD'].forEach(mon => {
        const key = mon.toLowerCase();
        const c = d.cuadre[mon];
        c.apertura += sumaConteo(t.conteoApertura, key);
        (movPorTurno[String(t._id)] || []).forEach(m => {
          if (m.tipo === 'CAMBIO_MONEDA') {
            if (m.monedaIngreso === mon) c.ingresos += m.montoIngreso;
            if (m.monedaEgreso === mon) c.ingresos -= m.montoEgreso;
          } else if (m.moneda === mon) {
            c.ingresos += m.monto;
          }
        });
        (enviosPorTurno[String(t._id)] || []).forEach(e => { if (e.moneda === mon) c.enviado += e.montoEnviado; });
        if (t.estado === 'CERRADO') c.conteoCierre += sumaConteo(t.conteoCierre, key);
      });
    });
    const dias = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
    dias.forEach(d => {
      ['PEN', 'USD'].forEach(mon => {
        const c = d.cuadre[mon];
        c.saldoCalculado = c.apertura + c.ingresos - c.enviado;
        // Si algún turno del día sigue abierto, el conteo de cierre está incompleto — no
        // se puede comparar todavía (se deja la diferencia en null, no un falso cuadre).
        if (d.turnosCerrados < d.turnos) { c.conteoCierre = null; c.diferencia = null; }
        else c.diferencia = c.conteoCierre - c.saldoCalculado;
      });
    });

    const total = { porTipo: vacioPorTipo(), ventaPorCanal: vacioCanal(), tipFacturado: 0, turnosCerrados: 0, cuadre: vacioCuadre() };
    dias.forEach(d => {
      Object.keys(total.porTipo).forEach(k => { total.porTipo[k] += d.porTipo[k]; });
      Object.keys(total.ventaPorCanal).forEach(k => { total.ventaPorCanal[k] += d.ventaPorCanal[k]; });
      total.tipFacturado += d.tipFacturado;
      total.turnosCerrados += d.turnosCerrados;
      ['PEN', 'USD'].forEach(mon => {
        const tc = total.cuadre[mon], dc = d.cuadre[mon];
        tc.apertura += dc.apertura; tc.ingresos += dc.ingresos; tc.enviado += dc.enviado; tc.saldoCalculado += dc.saldoCalculado;
        if (dc.conteoCierre === null) tc.conteoCierre = null;
        else if (tc.conteoCierre !== null) tc.conteoCierre += dc.conteoCierre;
      });
    });
    ['PEN', 'USD'].forEach(mon => {
      const tc = total.cuadre[mon];
      tc.diferencia = tc.conteoCierre === null ? null : tc.conteoCierre - tc.saldoCalculado;
    });

    const depositosPendientes = await EnvioEfectivo.find({ operacion, destino: 'BANCO', estado: 'ENVIADO' }).sort({ fechaEnvio: 1 }).lean();

    res.json({ dias, total, depositosPendientes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

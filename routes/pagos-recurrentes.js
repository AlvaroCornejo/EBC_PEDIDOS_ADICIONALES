const express = require('express');
const auth = require('../middleware/auth');

const PagoRecurrenteTipo         = require('../models/PagoRecurrenteTipo');
const PagoRecurrenteRegla        = require('../models/PagoRecurrenteRegla');
const PagoRecurrenteProgramacion = require('../models/PagoRecurrenteProgramacion');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolPagoRecurrente) return next();
  return res.status(403).json({ error: 'Sin acceso a Pagos Recurrentes' });
}
router.use(requireAccess);

const isProgramador = user => user.role === 'ADMIN' || user.rolPagoRecurrente === 'programador';
const puedeRegistrarPago = user => user.role === 'ADMIN'
  || user.rolPagoRecurrente === 'programador' || user.rolPagoRecurrente === 'registrador';

/** Operaciones autorizadas del usuario (null = todas) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

// ── Generador de ocurrencias ────────────────────────────────────────────────

/** Fecha de la ocurrencia para (año, mes 0-based, diaPago) — ajusta al último día del mes
 *  si diaPago no existe en ese mes (ej. 31 en febrero). */
function fechaOcurrencia(año, mes, diaPago) {
  const ultimoDia = new Date(Date.UTC(año, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(año, mes, Math.min(diaPago, ultimoDia)));
}

/** Genera las ocurrencias pendientes que falten para una regla activa hasta hoy + 6 meses.
 *  Idempotente: el índice único {reglaId,fechaProgramada} evita duplicar si se corre varias
 *  veces (los duplicados del insertMany con ordered:false simplemente se descartan). */
async function asegurarProgramacionFutura(regla) {
  const limite = new Date();
  limite.setUTCMonth(limite.getUTCMonth() + 6);

  const ultima = await PagoRecurrenteProgramacion.findOne({ reglaId: String(regla._id) })
    .sort({ fechaProgramada: -1 }).lean();

  let año, mes;
  if (ultima) {
    año = ultima.fechaProgramada.getUTCFullYear();
    mes = ultima.fechaProgramada.getUTCMonth();
  } else {
    año = regla.fechaInicio.getUTCFullYear();
    mes = regla.fechaInicio.getUTCMonth() - regla.intervaloMeses;
  }

  const nuevas = [];
  let guard = 0;
  while (guard++ < 240) { // tope de seguridad (20 años de mensualidades) para nunca loopear infinito
    mes += regla.intervaloMeses;
    while (mes > 11) { mes -= 12; año += 1; }
    while (mes < 0)  { mes += 12; año -= 1; }
    const fecha = fechaOcurrencia(año, mes, regla.diaPago);
    if (fecha > limite) break;
    if (fecha < regla.fechaInicio) continue;
    nuevas.push({
      reglaId: String(regla._id), operacion: regla.operacion, tipoPago: regla.tipoPago,
      descripcion: regla.descripcion, fechaProgramada: fecha, montoProgramado: regla.montoEstimado,
      registradoPor: regla.creadoPor || '',
    });
  }

  if (nuevas.length) {
    try {
      await PagoRecurrenteProgramacion.insertMany(nuevas, { ordered: false });
    } catch (err) {
      // E11000 por duplicados (índice único reglaId+fechaProgramada) — esperable si se
      // corre dos veces, se ignora; cualquier otro error sí se propaga.
      if (!err.writeErrors && err.code !== 11000) throw err;
    }
  }
}

// ── Tipos de pago (catálogo) ────────────────────────────────────────────────
router.get('/tipos', async (req, res) => {
  try {
    res.json(await PagoRecurrenteTipo.find({ activo: true }).sort({ nombre: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/tipos', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const t = await PagoRecurrenteTipo.create({ nombre });
    res.json(t);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/tipos/:id', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    await PagoRecurrenteTipo.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reglas de recurrencia ────────────────────────────────────────────────────
router.get('/reglas', async (req, res) => {
  try {
    const { operacion } = req.query;
    const ops = opsFilter(req.user);
    const filter = {};
    if (operacion) {
      if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
      filter.operacion = operacion;
    } else if (ops !== null) {
      filter.operacion = { $in: ops };
    }
    res.json(await PagoRecurrenteRegla.find(filter).sort({ operacion: 1, tipoPago: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reglas', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { operacion, tipoPago, descripcion, diaPago, intervaloMeses, montoEstimado, fechaInicio } = req.body;
    if (!operacion || !tipoPago || !diaPago || !montoEstimado || !fechaInicio)
      return res.status(400).json({ error: 'Operación, tipo de pago, día de pago, monto estimado y fecha de inicio son requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const regla = await PagoRecurrenteRegla.create({
      operacion, tipoPago, descripcion: descripcion || '',
      diaPago: Math.min(Math.max(parseInt(diaPago) || 1, 1), 31),
      intervaloMeses: parseInt(intervaloMeses) || 1,
      montoEstimado: parseFloat(montoEstimado) || 0,
      fechaInicio: new Date(fechaInicio),
      creadoPor: req.user.username,
    });
    await asegurarProgramacionFutura(regla);
    res.json(regla);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/reglas/:id', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const regla = await PagoRecurrenteRegla.findById(req.params.id);
    if (!regla) return res.status(404).json({ error: 'Regla no encontrada' });
    if (!checkOpAccess(req.user, regla.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const { descripcion, diaPago, intervaloMeses, montoEstimado, activa } = req.body;
    if (descripcion !== undefined) regla.descripcion = descripcion;
    if (diaPago !== undefined) regla.diaPago = Math.min(Math.max(parseInt(diaPago) || 1, 1), 31);
    if (intervaloMeses !== undefined) regla.intervaloMeses = parseInt(intervaloMeses) || 1;
    if (montoEstimado !== undefined) regla.montoEstimado = parseFloat(montoEstimado) || 0;
    const reactivando = activa === true && !regla.activa;
    if (activa !== undefined) regla.activa = !!activa;
    await regla.save();

    if (regla.activa && reactivando) await asegurarProgramacionFutura(regla);
    res.json(regla);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Programaciones (ocurrencias) ─────────────────────────────────────────────
router.get('/programaciones', async (req, res) => {
  try {
    const { operacion, tipoPago, estado, fechaProgDesde, fechaProgHasta, fechaPagoDesde, fechaPagoHasta } = req.query;
    const ops = opsFilter(req.user);

    if (operacion && !checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    // Mantener la ventana de 6 meses al día para las reglas activas dentro del alcance
    const reglasFilter = { activa: true };
    if (operacion) reglasFilter.operacion = operacion;
    else if (ops !== null) reglasFilter.operacion = { $in: ops };
    const reglasActivas = await PagoRecurrenteRegla.find(reglasFilter);
    await Promise.all(reglasActivas.map(r => asegurarProgramacionFutura(r)));

    const filter = {};
    if (operacion) filter.operacion = operacion;
    else if (ops !== null) filter.operacion = { $in: ops };
    if (tipoPago) filter.tipoPago = tipoPago;
    if (estado) filter.estado = estado;
    if (fechaProgDesde || fechaProgHasta) {
      filter.fechaProgramada = {};
      if (fechaProgDesde) filter.fechaProgramada.$gte = new Date(fechaProgDesde);
      if (fechaProgHasta) filter.fechaProgramada.$lte = new Date(fechaProgHasta + 'T23:59:59');
    }
    if (fechaPagoDesde || fechaPagoHasta) {
      filter.fechaPagoReal = {};
      if (fechaPagoDesde) filter.fechaPagoReal.$gte = new Date(fechaPagoDesde);
      if (fechaPagoHasta) filter.fechaPagoReal.$lte = new Date(fechaPagoHasta + 'T23:59:59');
    }

    const docs = await PagoRecurrenteProgramacion.find(filter).sort({ fechaProgramada: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/programaciones/:id', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const prog = await PagoRecurrenteProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkOpAccess(req.user, prog.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (prog.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se puede editar una ocurrencia pendiente' });

    const { fechaProgramada, montoProgramado } = req.body;
    if (fechaProgramada !== undefined) prog.fechaProgramada = new Date(fechaProgramada);
    if (montoProgramado !== undefined) prog.montoProgramado = parseFloat(montoProgramado) || 0;
    await prog.save();
    res.json(prog);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/programaciones/:id/pagar', async (req, res) => {
  try {
    if (!puedeRegistrarPago(req.user)) return res.status(403).json({ error: 'Sin acceso para registrar pagos' });
    const prog = await PagoRecurrenteProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkOpAccess(req.user, prog.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (prog.estado !== 'pendiente') return res.status(400).json({ error: 'Esta ocurrencia ya no está pendiente' });

    const { fechaPagoReal, montoPagoReal, comentario } = req.body;
    if (!fechaPagoReal || montoPagoReal === undefined)
      return res.status(400).json({ error: 'Fecha y monto de pago requeridos' });

    prog.estado = 'pagado';
    prog.fechaPagoReal = new Date(fechaPagoReal);
    prog.montoPagoReal = parseFloat(montoPagoReal) || 0;
    prog.comentario = comentario || '';
    prog.pagadoPor = req.user.username;
    prog.pagadoEn = new Date();
    await prog.save();
    res.json(prog);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/programaciones/:id/anular', async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const prog = await PagoRecurrenteProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkOpAccess(req.user, prog.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (prog.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se puede anular una ocurrencia pendiente' });

    prog.estado = 'anulado';
    await prog.save();
    res.json(prog);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;

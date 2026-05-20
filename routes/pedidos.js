const express = require('express');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const Pedido = require('../models/Pedido');

const router = express.Router();

router.use(authMiddleware);

// GET /api/pedidos?vista=aprobar|atender|admin
router.get('/', async (req, res) => {
  try {
    const { role, id: userId, operations } = req.user;
    const { vista } = req.query;

    let query = {};
    if (role === 'OPERADOR_SOLICITUD') {
      query.solicitadoPorId = userId;
    } else if (role === 'OPERADOR_APROBACION') {
      query.operacion = { $in: operations };
    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      query.operacion = { $in: operations };
      query.estado = { $in: ['APROBADO', 'ATENDIDO'] };
    }
    // ADMIN: no filter

    if (vista === 'aprobar') query.estado = { $in: ['SOLICITADO', 'REVISAR'] };
    if (vista === 'atender') query.estado = { $in: ['APROBADO', 'ATENDIDO'] };

    const pedidos = await Pedido.find(query).lean();
    pedidos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(pedidos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pedidos
router.post('/', async (req, res) => {
  try {
    const { role } = req.user;
    if (!['ADMIN', 'OPERADOR_SOLICITUD'].includes(role)) return res.status(403).json({ error: 'No autorizado' });
    const { operacion, fechaPedido, lineas } = req.body;
    if (!operacion || !fechaPedido || !lineas?.length) return res.status(400).json({ error: 'Datos incompletos' });

    const pedido = new Pedido({
      id: uuidv4(),
      operacion,
      fechaPedido,
      estado: 'SOLICITADO',
      solicitadoPorId: req.user.id,
      solicitadoPorNombre: req.user.username,
      aprobadoPorId: null, aprobadoPorNombre: null,
      atendidoPorId: null, atendidoPorNombre: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineas: lineas.map(l => ({ ...l, id: l.id || uuidv4(), estadoLinea: 'PENDIENTE', comentarioAprobador: '', estadoAtencion: 'PENDIENTE' }))
    });

    await pedido.save();
    res.json(pedido.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pedidos/:id
router.put('/:id', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ id: req.params.id });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { role } = req.user;
    const { lineas, resubmit } = req.body;

    if (role === 'OPERADOR_SOLICITUD' || (role === 'ADMIN' && req.body.accion === 'editar')) {
      if (!['SOLICITADO', 'REVISAR'].includes(pedido.estado)) {
        return res.status(403).json({ error: 'No se puede editar en este estado' });
      }
      if (lineas) {
        if (pedido.estado === 'REVISAR') {
          // Preserve APROBADO/RECHAZADO lines; only update REVISAR/PENDIENTE
          const lockedIds = new Set(pedido.lineas.filter(l => ['APROBADO','RECHAZADO'].includes(l.estadoLinea)).map(l => l.id));
          const updatedMap = Object.fromEntries(lineas.map(l => [l.id, l]));
          pedido.lineas = pedido.lineas.map(existing =>
            lockedIds.has(existing.id) ? existing : { ...existing.toObject(), ...updatedMap[existing.id], id: existing.id, estadoLinea: existing.estadoLinea, comentarioAprobador: existing.comentarioAprobador }
          );
          // Add new lines
          const existingIds = new Set(pedido.lineas.map(l => l.id));
          lineas.filter(l => !existingIds.has(l.id)).forEach(l => {
            pedido.lineas.push({ ...l, id: l.id || uuidv4(), estadoLinea: 'PENDIENTE', comentarioAprobador: '', estadoAtencion: 'PENDIENTE' });
          });
        } else {
          pedido.lineas = lineas.map(l => ({ ...l, id: l.id || uuidv4(), estadoLinea: l.estadoLinea || 'PENDIENTE', comentarioAprobador: l.comentarioAprobador || '', estadoAtencion: l.estadoAtencion || 'PENDIENTE' }));
        }
      }
      if (resubmit && pedido.estado === 'REVISAR') pedido.estado = 'SOLICITADO';

    } else if (role === 'OPERADOR_APROBACION' || role === 'ADMIN') {
      if (!lineas?.length) return res.status(400).json({ error: 'Se requieren las líneas con estados' });
      const invalid = lineas.some(l => !['APROBADO', 'RECHAZADO', 'REVISAR'].includes(l.estadoLinea));
      if (invalid) return res.status(400).json({ error: 'Todas las líneas deben tener un estado asignado' });

      pedido.lineas = pedido.lineas.map(existing => {
        const upd = lineas.find(l => l.id === existing.id);
        return upd ? { ...existing.toObject(), estadoLinea: upd.estadoLinea, comentarioAprobador: upd.comentarioAprobador || '' } : existing;
      });

      const lineaEstados = pedido.lineas.map(l => l.estadoLinea || 'PENDIENTE');
      if (lineaEstados.some(e => e === 'REVISAR')) pedido.estado = 'REVISAR';
      else if (lineaEstados.every(e => e === 'RECHAZADO')) pedido.estado = 'RECHAZADO';
      else pedido.estado = 'APROBADO';

      pedido.aprobadoPorId = req.user.id;
      pedido.aprobadoPorNombre = req.user.username;

    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      if (pedido.estado !== 'APROBADO') return res.status(403).json({ error: 'Solo se atienden pedidos aprobados' });
      if (!lineas?.length) return res.status(400).json({ error: 'Se requieren las líneas con estado de atención' });

      const gestionRol = role === 'OPERADOR_PLANTA' ? 'PLANTA' : 'COMPRAS';
      const lineaMap = Object.fromEntries(lineas.map(l => [l.id, l]));
      pedido.lineas = pedido.lineas.map(existing => {
        if ((existing.gestion || 'COMPRAS') !== gestionRol) return existing;
        const upd = lineaMap[existing.id];
        return upd ? { ...existing.toObject(), estadoAtencion: upd.estadoAtencion || existing.estadoAtencion || 'PENDIENTE' } : existing;
      });
      const lineasAprobadas = pedido.lineas.filter(l => l.estadoLinea === 'APROBADO');
      const todasAtendidas = lineasAprobadas.length > 0 && lineasAprobadas.every(l => l.estadoAtencion === 'ATENDIDO');
      pedido.estado = todasAtendidas ? 'ATENDIDO' : 'APROBADO';
      pedido.atendidoPorId = req.user.id;
      pedido.atendidoPorNombre = req.user.username;

    } else {
      return res.status(403).json({ error: 'No autorizado' });
    }

    pedido.updatedAt = new Date().toISOString();
    pedido.markModified('lineas');
    await pedido.save();
    res.json(pedido.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

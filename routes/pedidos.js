const express = require('express');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const Pedido = require('../models/Pedido');
const Config = require('../models/Config');
const { sendPush } = require('../utils/sendPush');

const router = express.Router();
router.use(authMiddleware);

// ─── Helper: leer config ──────────────────────────────────────────
async function getConfig() {
  const docs = await Config.find({}).lean();
  const cfg = { maxVariacion: 10 };
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

// ─── Helper: auto-aprobación por línea ───────────────────────────
function aplicarAutoAprobacion(lineas, maxVariacion) {
  const factor = (maxVariacion || 10) / 100;
  for (const linea of lineas) {
    if (linea.estadoLinea === 'APROBADO' || linea.estadoLinea === 'RECHAZADO') continue;
    const varA = (linea.semanaAnterior || {}).variacion || 0;
    if (varA <= 0) continue;
    const lote = linea.loteCompra || 0;
    const sugerido = lote > 0 ? Math.ceil(varA / lote) * lote : varA;
    const limite = sugerido * (1 + factor);
    const cant = linea.cantidadSolicitada || 0;
    if (cant > 0 && cant <= limite) {
      linea.estadoLinea = 'APROBADO';
      linea.autoAprobado = true;
      linea.comentarioAprobador = `Auto-aprobado (cant. ${cant} ≤ límite ${limite.toFixed(2)})`;
    }
  }
}

// ─── Helper: estado del pedido según líneas ───────────────────────
function calcEstadoPedido(lineas) {
  const estados = lineas.map(l => l.estadoLinea || 'PENDIENTE');
  if (estados.some(e => e === 'REVISAR'))    return 'REVISAR';
  if (estados.every(e => e === 'RECHAZADO')) return 'RECHAZADO';
  return 'APROBADO';
}

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
    // ADMIN: sin filtro

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

    const cfg = await getConfig();
    const lineasMapped = lineas.map(l => ({
      ...l,
      id:                  l.id || uuidv4(),
      estadoLinea:         'PENDIENTE',
      autoAprobado:        false,
      comentarioAprobador: '',
      estadoAtencion:      'PENDIENTE',
      loteCompra:          l.loteCompra || 0
    }));

    // Aplicar auto-aprobación (#6)
    aplicarAutoAprobacion(lineasMapped, cfg.maxVariacion);

    const todosAprobados = lineasMapped.every(l => l.estadoLinea === 'APROBADO');

    const pedido = new Pedido({
      id: uuidv4(),
      operacion,
      fechaPedido,
      estado:               todosAprobados ? 'APROBADO' : 'SOLICITADO',
      solicitadoPorId:      req.user.id,
      solicitadoPorNombre:  req.user.username,
      aprobadoPorId:        todosAprobados ? req.user.id : null,
      aprobadoPorNombre:    todosAprobados ? 'Auto-aprobado' : null,
      atendidoPorId:        null,
      atendidoPorNombre:    null,
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
      lineas:               lineasMapped
    });

    await pedido.save();
    res.json(pedido.toObject());

    // Notificar aprobadores si el pedido no fue auto-aprobado totalmente
    if (pedido.estado === 'SOLICITADO') {
      sendPush(
        { role: 'OPERADOR_APROBACION', operations: operacion },
        { title: '📝 Nueva solicitud pendiente', body: `${operacion} — ${req.user.username} (${lineasMapped.length} línea${lineasMapped.length !== 1 ? 's' : ''})`, url: '/#aprobar' }
      );
      sendPush(
        { role: 'ADMIN' },
        { title: '📝 Nueva solicitud pendiente', body: `${operacion} — ${req.user.username}`, url: '/#aprobar' }
      );
    }
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
          // Preservar líneas bloqueadas (APROBADO/RECHAZADO)
          const lockedIds = new Set(
            pedido.lineas.filter(l => ['APROBADO', 'RECHAZADO'].includes(l.estadoLinea)).map(l => l.id)
          );
          const updatedMap = Object.fromEntries(lineas.map(l => [l.id, l]));
          pedido.lineas = pedido.lineas.map(existing => {
            if (lockedIds.has(existing.id)) return existing;
            const upd = updatedMap[existing.id];
            if (!upd) return existing;
            return {
              ...existing.toObject(), ...upd,
              id:                  existing.id,
              estadoLinea:         existing.estadoLinea,
              autoAprobado:        existing.autoAprobado,
              comentarioAprobador: existing.comentarioAprobador,
              costoUnitario:       existing.costoUnitario  // Preservar costo original (#10)
            };
          });
          // Agregar nuevas líneas
          const existingIds = new Set(pedido.lineas.map(l => l.id));
          lineas.filter(l => !existingIds.has(l.id)).forEach(l => {
            pedido.lineas.push({ ...l, id: l.id || uuidv4(), estadoLinea: 'PENDIENTE', autoAprobado: false, comentarioAprobador: '', estadoAtencion: 'PENDIENTE', loteCompra: l.loteCompra || 0 });
          });
        } else {
          // Estado SOLICITADO: reemplazar lineas preservando costo original (#10)
          const existingMap = Object.fromEntries(pedido.lineas.map(l => [l.id, l]));
          pedido.lineas = lineas.map(l => ({
            ...l,
            id:                  l.id || uuidv4(),
            estadoLinea:         l.estadoLinea || 'PENDIENTE',
            autoAprobado:        l.autoAprobado || false,
            comentarioAprobador: l.comentarioAprobador || '',
            estadoAtencion:      l.estadoAtencion || 'PENDIENTE',
            loteCompra:          l.loteCompra || 0,
            costoUnitario:       existingMap[l.id]?.costoUnitario ?? l.costoUnitario  // #10
          }));
        }
      }
      if (resubmit && pedido.estado === 'REVISAR') {
        const cfg = await getConfig();
        // Re-aplicar auto-aprobación a líneas PENDIENTE/REVISAR
        const lineasParaAprobar = pedido.lineas.filter(l => !['APROBADO', 'RECHAZADO'].includes(l.estadoLinea));
        aplicarAutoAprobacion(lineasParaAprobar, cfg.maxVariacion);
        pedido.estado = 'SOLICITADO';
        const todosAprobados = pedido.lineas.every(l => l.estadoLinea === 'APROBADO');
        if (todosAprobados) {
          pedido.estado = 'APROBADO';
          pedido.aprobadoPorId = req.user.id;
          pedido.aprobadoPorNombre = 'Auto-aprobado';
        }
      }

    } else if (role === 'OPERADOR_APROBACION' || role === 'ADMIN') {
      if (!lineas?.length) return res.status(400).json({ error: 'Se requieren las líneas con estados' });
      const invalid = lineas.some(l => !['APROBADO', 'RECHAZADO', 'REVISAR'].includes(l.estadoLinea));
      if (invalid) return res.status(400).json({ error: 'Todas las líneas deben tener un estado asignado' });

      pedido.lineas = pedido.lineas.map(existing => {
        // Líneas auto-aprobadas: el aprobador no puede cambiarlas (#6)
        if (existing.autoAprobado) return existing;
        const upd = lineas.find(l => l.id === existing.id);
        return upd
          ? { ...existing.toObject(), estadoLinea: upd.estadoLinea, comentarioAprobador: upd.comentarioAprobador || '' }
          : existing;
      });

      pedido.estado = calcEstadoPedido(pedido.lineas);
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
        if (!upd) return existing;
        // No se puede des-atender (#7)
        const nuevoEstado = existing.estadoAtencion === 'ATENDIDO'
          ? 'ATENDIDO'
          : (upd.estadoAtencion || existing.estadoAtencion || 'PENDIENTE');
        return { ...existing.toObject(), estadoAtencion: nuevoEstado };
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

    // ── Push notifications post-guardado ──────────────────────────
    const op = pedido.operacion;
    const solId = pedido.solicitadoPorId;
    if (role === 'OPERADOR_APROBACION' || (role === 'ADMIN' && req.body.lineas?.[0]?.estadoLinea)) {
      const nuevoEstado = pedido.estado;
      if (nuevoEstado === 'APROBADO') {
        sendPush({ userId: solId },
          { title: '✅ Pedido aprobado', body: `Tu solicitud de ${op} fue aprobada`, url: '/#mis-pedidos' });
        sendPush({ role: 'OPERADOR_ATENCION', operations: op },
          { title: '🚚 Pedido listo para atender', body: `${op} — aprobado por ${req.user.username}`, url: '/#atender' });
        sendPush({ role: 'OPERADOR_PLANTA', operations: op },
          { title: '🚚 Pedido listo para atender', body: `${op} — aprobado por ${req.user.username}`, url: '/#atender' });
      } else if (nuevoEstado === 'RECHAZADO') {
        sendPush({ userId: solId },
          { title: '❌ Pedido rechazado', body: `Tu solicitud de ${op} fue rechazada`, url: '/#mis-pedidos' });
      } else if (nuevoEstado === 'REVISAR') {
        sendPush({ userId: solId },
          { title: '🔄 Pedido requiere revisión', body: `Tu solicitud de ${op} necesita ajustes`, url: '/#solicitar' });
      }
    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      if (pedido.estado === 'ATENDIDO') {
        sendPush({ userId: solId },
          { title: '📦 Pedido atendido', body: `Tu solicitud de ${op} fue atendida`, url: '/#mis-pedidos' });
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/pedidos/:id  — solo ADMIN
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const pedido = await Pedido.findOneAndDelete({ id: req.params.id });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

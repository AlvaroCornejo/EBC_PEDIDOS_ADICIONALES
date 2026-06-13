const express = require('express');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const Movimiento = require('../models/Movimiento');
const Item = require('../models/Item');

const router = express.Router();
router.use(authMiddleware);

const ALL_OPS = ['AASI', 'CDLAO', 'CDL28', 'CORP', 'DOSIMETRIA', 'PREP', 'GBADC', 'GBCFR', 'GBCFR2', 'GBCRP', 'GBGOL', 'GBSRQ', 'GBPLANTA'];

const FLUJOS = ['BAJA', 'CONSUMO', 'TRANSFERENCIA', '86'];
const ACCESO_FIELD = { BAJA: 'accesoBajas', CONSUMO: 'accesoConsumos', TRANSFERENCIA: 'accesoTransferencias', '86': 'acceso86' };
const TIPOS = {
  BAJA:    ['MANIPULACIÓN', 'CALIDAD', 'VENCIMIENTO'],
  CONSUMO: ['CONSUMO TIENDAS', 'RANCHO', 'PRUEBAS'],
};

// Acceso al flujo: ADMIN siempre; resto requiere el checkbox acceso<Flujo>
function checkAccess(req, res, flujo) {
  if (!FLUJOS.includes(flujo)) { res.status(400).json({ error: 'Flujo inválido' }); return false; }
  if (req.user.role === 'ADMIN') return true;
  if (!req.user[ACCESO_FIELD[flujo]]) { res.status(403).json({ error: 'No autorizado para este flujo' }); return false; }
  return true;
}

// Rol efectivo del usuario para el flujo (BCT comparten rolBCT, 86 usa rol86)
function rolPara(user, flujo) {
  if (user.role === 'ADMIN') return 'REGISTRO';
  return flujo === '86' ? user.rol86 : user.rolBCT;
}

// Operaciones a las que el usuario puede transferir
function destinosPermitidos(user) {
  return user.role === 'ADMIN' ? ALL_OPS : (user.transferenciaDestinos || []);
}

// ── GET /api/movimientos/operaciones?flujo= ─────────────────────────────────
router.get('/operaciones', (req, res) => {
  const { flujo } = req.query;
  if (!checkAccess(req, res, flujo)) return;
  const operaciones = req.user.role === 'ADMIN' ? ALL_OPS : (req.user.operations || []);
  const result = { operaciones };
  if (flujo === 'TRANSFERENCIA') result.destinos = req.user.role === 'ADMIN' ? ALL_OPS : (req.user.transferenciaDestinos || []);
  res.json(result);
});

// ── GET /api/movimientos?flujo=&operacion=&estado=&desde=&hasta= ────────────
router.get('/', async (req, res) => {
  try {
    const { flujo, operacion, estado, desde, hasta } = req.query;
    if (!checkAccess(req, res, flujo)) return;

    const filter = { flujo };
    const isAdmin = req.user.role === 'ADMIN';
    const userOps = req.user.operations || [];

    if (operacion) {
      if (!isAdmin && !userOps.includes(operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
      filter.operacion = operacion;
    } else if (!isAdmin) {
      filter.operacion = { $in: userOps };
    }

    if (flujo !== '86' && estado) filter.estado = estado;
    if (rolPara(req.user, flujo) === 'SOLICITUD') filter.creadoPorId = req.user.id;

    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }

    const registros = await Movimiento.find(filter).sort({ fecha: -1 }).limit(2000).lean();
    res.json(registros);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/movimientos ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { flujo, operacion, operacionDestino, fecha, item, tipo, cantidad, comentarios } = req.body;
    if (!checkAccess(req, res, flujo)) return;

    const rol = rolPara(req.user, flujo);
    const puedeCrear = flujo === '86' ? rol === 'REGISTRO' : ['SOLICITUD', 'REGISTRO'].includes(rol);
    if (!puedeCrear) return res.status(403).json({ error: 'No autorizado para registrar' });

    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (req.user.role !== 'ADMIN' && !(req.user.operations || []).includes(operacion)) {
      return res.status(403).json({ error: 'Operación no autorizada' });
    }
    if (!item) return res.status(400).json({ error: 'Ítem requerido' });

    const doc = {
      id: uuidv4(),
      flujo,
      operacion,
      fecha: fecha ? new Date(fecha) : new Date(),
      item: Number(item),
      comentarios: comentarios || '',
      creadoPorId: req.user.id,
      creadoPorNombre: req.user.username,
    };

    if (flujo === 'TRANSFERENCIA') {
      if (!operacionDestino) return res.status(400).json({ error: 'Operación destino requerida' });
      if (operacionDestino === operacion) return res.status(400).json({ error: 'La operación destino debe ser distinta de la origen' });
      if (!destinosPermitidos(req.user).includes(operacionDestino)) return res.status(400).json({ error: 'Operación destino inválida' });
      doc.operacionDestino = operacionDestino;
    }

    if (flujo === 'BAJA' || flujo === 'CONSUMO') {
      if (!TIPOS[flujo].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
      doc.tipo = tipo;
    }

    if (flujo !== '86') {
      const cant = Number(cantidad);
      if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });
      doc.cantidad = Math.round(cant * 10000) / 10000;
      doc.estado = 'REGISTRADO';
    }

    const itemDoc = await Item.findOne({ operacion, item: String(item) }).lean();
    if (itemDoc) doc.itemNombre = itemDoc.nombre;

    const registro = await Movimiento.create(doc);
    res.json(registro);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/movimientos/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const registro = await Movimiento.findOne({ id: req.params.id });
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
    if (!checkAccess(req, res, registro.flujo)) return;

    const rol = rolPara(req.user, registro.flujo);
    if (rol === 'CONSULTA') return res.status(403).json({ error: 'Solo lectura' });
    if (rol === 'SOLICITUD' && registro.creadoPorId !== req.user.id) {
      return res.status(403).json({ error: 'Solo puede editar sus propios registros' });
    }
    if (registro.flujo !== '86' && registro.estado === 'PROCESADO' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'No se puede modificar un registro procesado' });
    }

    const { operacionDestino, fecha, item, tipo, cantidad, comentarios } = req.body;
    if (fecha !== undefined) registro.fecha = new Date(fecha);
    if (comentarios !== undefined) registro.comentarios = comentarios;

    if (item !== undefined) {
      registro.item = Number(item);
      const itemDoc = await Item.findOne({ operacion: registro.operacion, item: String(item) }).lean();
      registro.itemNombre = itemDoc ? itemDoc.nombre : '';
    }

    if (registro.flujo === 'TRANSFERENCIA' && operacionDestino !== undefined) {
      if (operacionDestino === registro.operacion) return res.status(400).json({ error: 'La operación destino debe ser distinta de la origen' });
      if (!destinosPermitidos(req.user).includes(operacionDestino)) return res.status(400).json({ error: 'Operación destino inválida' });
      registro.operacionDestino = operacionDestino;
    }

    if ((registro.flujo === 'BAJA' || registro.flujo === 'CONSUMO') && tipo !== undefined) {
      if (!TIPOS[registro.flujo].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
      registro.tipo = tipo;
    }

    if (registro.flujo !== '86' && cantidad !== undefined) {
      const cant = Number(cantidad);
      if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });
      registro.cantidad = Math.round(cant * 10000) / 10000;
    }

    registro.updatedAt = new Date();
    await registro.save();
    res.json(registro);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/movimientos/:id/procesar ───────────────────────────────────────
router.put('/:id/procesar', async (req, res) => {
  try {
    const registro = await Movimiento.findOne({ id: req.params.id });
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
    if (!checkAccess(req, res, registro.flujo)) return;
    if (registro.flujo === '86') return res.status(400).json({ error: 'El flujo 86 no tiene procesamiento' });

    const rol = rolPara(req.user, registro.flujo);
    if (rol !== 'REGISTRO') return res.status(403).json({ error: 'No autorizado para procesar' });
    if (registro.estado !== 'REGISTRADO') return res.status(400).json({ error: 'El registro ya fue procesado' });

    registro.estado = 'PROCESADO';
    registro.procesadoPorId = req.user.id;
    registro.procesadoPorNombre = req.user.username;
    registro.procesadoEn = new Date();
    registro.updatedAt = new Date();
    await registro.save();
    res.json(registro);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/movimientos/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const registro = await Movimiento.findOne({ id: req.params.id });
    if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
    if (!checkAccess(req, res, registro.flujo)) return;

    const rol = rolPara(req.user, registro.flujo);
    if (rol === 'CONSULTA') return res.status(403).json({ error: 'Solo lectura' });
    if (rol === 'SOLICITUD' && registro.creadoPorId !== req.user.id) {
      return res.status(403).json({ error: 'Solo puede eliminar sus propios registros' });
    }
    if (registro.flujo !== '86' && registro.estado === 'PROCESADO' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'No se puede eliminar un registro procesado' });
    }

    await Movimiento.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const auth = require('../middleware/auth');

const RecetaCosteo          = require('../models/RecetaCosteo');
const RecetaCosteoDetalle   = require('../models/RecetaCosteoDetalle');
const RecetaCambioSolicitud = require('../models/RecetaCambioSolicitud');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.puedeVerCosteoRecetas || (req.user.rolCambioReceta || []).length) return next();
  return res.status(403).json({ error: 'Sin acceso al Costeo de Recetas' });
}
router.use(requireAccess);

function puedeSolicitar(user) {
  return user.role === 'ADMIN' || (user.rolCambioReceta || []).includes('solicitante');
}
function puedeAprobar(user) {
  return user.role === 'ADMIN' || (user.rolCambioReceta || []).includes('aprobador');
}
function puedeRegistrar(user) {
  return user.role === 'ADMIN' || (user.rolCambioReceta || []).includes('registrador');
}

/** Operaciones autorizadas del usuario (null = todas) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

/**
 * Semáforo por % de desviación entre el costo de receta y el costo real de producción.
 * Verde ≤5%, amarillo ≤15%, rojo mayor. 'gris' si no hay costo de receta (división por 0).
 */
function calcSemaforo(costo, costoReal) {
  const pct = costo ? Math.abs(costoReal - costo) / costo : null;
  if (pct === null) return 'gris';
  if (pct <= 0.05) return 'verde';
  if (pct <= 0.15) return 'amarillo';
  return 'rojo';
}

// ── GET /operaciones ────────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const ops = opsFilter(req.user);
    const filter = ops === null ? {} : { operacion: { $in: ops } };
    const disponibles = await RecetaCosteo.distinct('operacion', filter);
    res.json(disponibles.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /grupos?operacion= ────────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const grupos = await RecetaCosteo.distinct('grupo', { operacion });
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /resumen?operacion=&grupo=&item=&nombre=&semaforo= ─────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const { operacion, grupo, item, nombre, semaforo } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const filter = { operacion };
    if (grupo) filter.grupo = grupo;
    if (item) filter.item = parseInt(item);
    if (nombre) filter.nombre = { $regex: nombre.trim(), $options: 'i' };

    const docs = await RecetaCosteo.find(filter).sort({ grupo: 1, nombre: 1 }).lean();
    let filas = docs.map(d => ({
      grupo: d.grupo, item: d.item, nombre: d.nombre,
      costo: d.costo, costoReal: d.costoReal, batch: d.batch,
      semaforo: calcSemaforo(d.costo, d.costoReal),
      desviacionPct: d.costo ? (d.costoReal - d.costo) / d.costo * 100 : null,
    }));
    if (semaforo) filas = filas.filter(f => f.semaforo === semaforo);

    res.json(filas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /detalle?item=&operacion= ───────────────────────────────────────────
router.get('/detalle', async (req, res) => {
  try {
    const { operacion } = req.query;
    const item = parseInt(req.query.item);
    if (!item || !operacion) return res.status(400).json({ error: 'Ítem y operación requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const [resumen, insumos] = await Promise.all([
      RecetaCosteo.findOne({ item, operacion }).lean(),
      RecetaCosteoDetalle.find({ item, operacion }).sort({ costo: -1 }).lean(),
    ]);
    if (!resumen) return res.status(404).json({ error: 'Ítem no encontrado' });

    const totalCanal = canal => insumos.filter(i => i[canal]).reduce((s, i) => s + i.costo, 0);

    res.json({
      item, operacion,
      grupo: resumen.grupo, nombre: resumen.nombre, batch: resumen.batch,
      costo: resumen.costo, costoReal: resumen.costoReal,
      semaforo: calcSemaforo(resumen.costo, resumen.costoReal),
      totales: { mesa: totalCanal('mesa'), llevar: totalCanal('llevar'), delivery: totalCanal('delivery') },
      insumos: insumos.map(i => ({
        insumo: i.insumo, nombreInsumo: i.nombreInsumo, cantidad: i.cantidad,
        unitario: i.unitario, costo: i.costo, mesa: i.mesa, llevar: i.llevar, delivery: i.delivery,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /insumos?operacion= — catálogo de insumos ya usados en alguna receta
// de esa operación (para el autocomplete de "insumo existente" al armar una
// solicitud de cambio) ───────────────────────────────────────────────────────
router.get('/insumos', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const docs = await RecetaCosteoDetalle.aggregate([
      { $match: { operacion } },
      { $sort: { insumo: 1 } },
      { $group: { _id: '$insumo', nombreInsumo: { $first: '$nombreInsumo' }, unitario: { $first: '$unitario' } } },
    ]);
    res.json(docs.map(d => ({ insumo: d._id, nombreInsumo: d.nombreInsumo, unitario: d.unitario })).sort((a, b) => a.insumo - b.insumo));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Solicitudes de cambio de receta ─────────────────────────────────────────
// GET /solicitudes?operacion=&estado=&item=
router.get('/solicitudes', async (req, res) => {
  try {
    if (!puedeSolicitar(req.user) && !puedeAprobar(req.user) && !puedeRegistrar(req.user)) return res.status(403).json({ error: 'Sin acceso a Solicitudes de Cambio' });
    const { operacion, estado, item } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const filter = { operacion };
    if (estado) filter.estado = estado;
    if (item) filter.item = parseInt(item);
    const docs = await RecetaCambioSolicitud.find(filter).sort({ solicitadoEn: -1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /solicitudes — crear una solicitud de cambio (solicitante)
router.post('/solicitudes', async (req, res) => {
  try {
    if (!puedeSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso para solicitar cambios de receta' });
    const { operacion, item, lineas } = req.body;
    if (!operacion || !item) return res.status(400).json({ error: 'Operación e ítem requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (!Array.isArray(lineas) || !lineas.length) return res.status(400).json({ error: 'La solicitud no tiene cambios' });

    const resumen = await RecetaCosteo.findOne({ item, operacion }).lean();
    if (!resumen) return res.status(404).json({ error: 'Ítem no encontrado' });

    const doc = await RecetaCambioSolicitud.create({
      operacion, sociedad: resumen.sociedad, item, itemNombre: resumen.nombre, grupo: resumen.grupo,
      lineas: lineas.map(l => ({
        accion: l.accion, insumo: l.insumo || undefined, insumoNombre: l.insumoNombre || '',
        esInsumoNuevo: !!l.esInsumoNuevo,
        cantidadAnterior: l.cantidadAnterior, cantidadNueva: l.cantidadNueva,
        sinCosto: !!l.sinCosto, costoSolicitado: l.costoSolicitado, comentario: l.comentario || '',
      })),
      solicitadoPor: req.user.username,
    });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /solicitudes/:id/aprobar — aprueba y genera solicitudes automáticas en
// cascada para las recetas que usan este ítem como insumo (nivel superior).
router.put('/solicitudes/:id/aprobar', async (req, res) => {
  try {
    if (!puedeAprobar(req.user)) return res.status(403).json({ error: 'Sin permiso para aprobar cambios de receta' });
    const sol = await RecetaCambioSolicitud.findById(req.params.id);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!checkOpAccess(req.user, sol.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (sol.estado !== 'pendiente') return res.status(400).json({ error: 'La solicitud ya fue procesada' });

    sol.estado = 'aprobado';
    sol.aprobadoPor = req.user.username;
    sol.aprobadoEn = new Date();
    sol.comentarioAprobador = req.body.comentario || '';
    await sol.save();

    // Cascada: recetas que usan este ítem como insumo dentro de la misma operación.
    const padres = await RecetaCosteoDetalle.distinct('item', { operacion: sol.operacion, insumo: sol.item });
    const nuevas = [];
    for (const padreItem of padres.filter(p => p !== sol.item)) {
      const yaExiste = await RecetaCambioSolicitud.findOne({
        operacion: sol.operacion, item: padreItem, estado: 'pendiente', automatico: true, origenSolicitudId: sol._id,
      });
      if (yaExiste) continue;
      const resumenPadre = await RecetaCosteo.findOne({ item: padreItem, operacion: sol.operacion }).lean();
      if (!resumenPadre) continue;
      nuevas.push({
        operacion: sol.operacion, sociedad: resumenPadre.sociedad, item: padreItem,
        itemNombre: resumenPadre.nombre, grupo: resumenPadre.grupo,
        lineas: [],
        automatico: true, origenSolicitudId: sol._id, origenItem: sol.item,
        solicitadoPor: req.user.username,
      });
    }
    if (nuevas.length) await RecetaCambioSolicitud.insertMany(nuevas);

    res.json({ ok: true, cascada: nuevas.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /solicitudes/:id/rechazar — requiere comentario
router.put('/solicitudes/:id/rechazar', async (req, res) => {
  try {
    if (!puedeAprobar(req.user)) return res.status(403).json({ error: 'Sin permiso para aprobar cambios de receta' });
    const { comentario } = req.body;
    if (!comentario) return res.status(400).json({ error: 'El comentario es obligatorio para rechazar' });
    const sol = await RecetaCambioSolicitud.findById(req.params.id);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!checkOpAccess(req.user, sol.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (sol.estado !== 'pendiente') return res.status(400).json({ error: 'La solicitud ya fue procesada' });

    sol.estado = 'rechazado';
    sol.aprobadoPor = req.user.username;
    sol.aprobadoEn = new Date();
    sol.comentarioAprobador = comentario;
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /solicitudes/:id/registrar — último paso: marca que el cambio ya se
// anotó en el ERP (solo desde 'aprobado').
router.put('/solicitudes/:id/registrar', async (req, res) => {
  try {
    if (!puedeRegistrar(req.user)) return res.status(403).json({ error: 'Sin permiso para registrar cambios de receta en el ERP' });
    const sol = await RecetaCambioSolicitud.findById(req.params.id);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!checkOpAccess(req.user, sol.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (sol.estado !== 'aprobado') return res.status(400).json({ error: 'Solo se puede registrar una solicitud ya aprobada' });

    sol.estado = 'registrado';
    sol.registradoPor = req.user.username;
    sol.registradoEn = new Date();
    sol.comentarioRegistrador = req.body.comentario || '';
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

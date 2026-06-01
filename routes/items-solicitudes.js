const express    = require('express');
const auth       = require('../middleware/auth');
const ItemsMaestro   = require('../models/ItemsMaestro');
const ItemsRef       = require('../models/ItemsRef');
const ItemsSolicitud = require('../models/ItemsSolicitud');

const router = express.Router();
router.use(auth);

// Verificar que el usuario tiene algún itemsRol
function requireItemsAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.itemsRol) return next();
  return res.status(403).json({ error: 'Sin acceso a Creación de Ítems' });
}
router.use(requireItemsAccess);

const canSolicitar = u => u.role === 'ADMIN' || ['solicitante','admin'].includes(u.itemsRol);
const canValidar   = u => u.role === 'ADMIN' || ['validador','admin'].includes(u.itemsRol);
const canRegistrar = u => u.role === 'ADMIN' || ['registrador','admin'].includes(u.itemsRol);

/** Filtro de operaciones para el CATÁLOGO (solicitantes solo ven sus ops) */
function opsFilter(user) {
  if (user.role === 'ADMIN' || user.itemsRol === 'admin') return {};
  // Validadores y registradores ven el catálogo completo
  if (['validador','registrador'].includes(user.itemsRol)) return {};
  const ops = user.operations || [];
  if (!ops.length) return { operacion: '__ninguna__' };
  return { operacion: { $in: ops } };
}

/** Filtro de operaciones para SOLICITUDES (todos filtran por sus ops asignadas) */
function solOpsFilter(user) {
  if (user.role === 'ADMIN' || user.itemsRol === 'admin') return {};
  const ops = user.operations || [];
  if (!ops.length) return { operacion: '__ninguna__' };
  return { operacion: { $in: ops } };
}

/** Operaciones permitidas para el usuario (array, null = todas) */
function userOps(user) {
  if (user.role === 'ADMIN' || user.itemsRol === 'admin') return null;
  return user.operations || [];
}


// ── Catálogo ──────────────────────────────────────────────────────────────────
// GET /api/items-sol/catalogo?q=&linea=&familia=&subFamilia=&tipoItem=&unidad=&page=
// Filtra por operaciones del usuario, agrupa por ítem (sin duplicados)
router.get('/catalogo', async (req, res) => {
  try {
    const { q, linea, familia, subFamilia, tipoItem, unidad, page = 1 } = req.query;
    const PER = 50;

    // Filtro por operaciones autorizadas
    const match = { ...opsFilter(req.user) };
    if (q)          match.nombre     = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (linea)      match.linea      = parseInt(linea);
    if (familia)    match.familia    = parseInt(familia);
    if (subFamilia) match.subFamilia = parseInt(subFamilia);
    if (tipoItem)   match.tipoItem   = tipoItem;
    if (unidad)     match.unidad     = unidad;

    // Agrupar por item para evitar duplicados (mismo item en varias ops)
    const pipeline = [
      { $match: match },
      { $group: {
          _id:          '$item',
          nombre:       { $first: '$nombre' },
          tipoItem:     { $first: '$tipoItem' },
          linea:        { $first: '$linea' },
          familia:      { $first: '$familia' },
          subFamilia:   { $first: '$subFamilia' },
          unidad:       { $first: '$unidad' },
          codigoInterno:{ $first: '$codigoInterno' },
          operaciones:  { $addToSet: '$operacion' },
      }},
      { $sort: { nombre: 1 } },
    ];

    const [countResult, items] = await Promise.all([
      ItemsMaestro.aggregate([...pipeline, { $count: 'total' }]),
      ItemsMaestro.aggregate([...pipeline, { $skip: (+page-1)*PER }, { $limit: PER }]),
    ]);
    const total = countResult[0]?.total || 0;
    res.json({
      items: items.map(i => ({ ...i, item: i._id })),
      total, page: +page, pages: Math.ceil(total / PER),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/refs — todas las tablas de referencia de una vez
router.get('/refs', async (req, res) => {
  try {
    const all = await ItemsRef.find().lean();
    const out = {};
    for (const r of all) {
      if (!out[r.tipo]) out[r.tipo] = [];
      out[r.tipo].push(r);
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/refs/familias?linea=X
router.get('/refs/familias', async (req, res) => {
  try {
    const { linea } = req.query;
    const filter = { tipo: 'familia' };
    if (linea) filter.linea = parseInt(linea);
    const rows = await ItemsRef.find(filter).sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/refs/sub-familias?linea=X&familia=Y
router.get('/refs/sub-familias', async (req, res) => {
  try {
    const { linea, familia } = req.query;
    const filter = { tipo: 'sub_familia' };
    if (linea)   filter.linea   = parseInt(linea);
    if (familia) filter.familia = parseInt(familia);
    const rows = await ItemsRef.find(filter).sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/catalogo/:item — detalle de un ítem para "copiar"
router.get('/catalogo/:item', async (req, res) => {
  try {
    const filter = { item: parseInt(req.params.item), ...opsFilter(req.user) };
    const it = await ItemsMaestro.findOne(filter).lean();
    if (!it) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json({ ...it, item: it.item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Solicitudes ───────────────────────────────────────────────────────────────
// GET /api/items-sol — lista según rol y operaciones autorizadas
router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const opFilter = solOpsFilter(u);         // validadores/registradores ven todas las ops
    let baseFilter = { ...opFilter };

    if (canValidar(u) || canRegistrar(u)) {
      // Validador/registrador ven todas (dentro de sus ops) excepto borradores ajenos
      baseFilter.$or = [{ estado: { $ne: 'borrador' } }, { creadoPor: u.username }];
    } else {
      // Solicitante: solo las propias
      baseFilter.creadoPor = u.username;
    }
    const sols = await ItemsSolicitud.find(baseFilter).sort({ creadoEn: -1 }).lean();
    res.json(sols);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/mis-operaciones — operaciones disponibles para el usuario
router.get('/mis-operaciones', async (req, res) => {
  try {
    const ops = userOps(req.user);
    res.json(ops); // null = todas (admin), array = permitidas
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/items-sol — crear solicitud
router.post('/', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { operacion, observacion, items } = req.body;
    if (!operacion) return res.status(400).json({ error: 'Selecciona la operación' });
    if (!items?.length) return res.status(400).json({ error: 'Agrega al menos un ítem' });
    // Verificar que la operación está autorizada
    const ops = userOps(req.user);
    if (ops !== null && !ops.includes(operacion))
      return res.status(403).json({ error: 'Operación no autorizada' });
    const sol = await ItemsSolicitud.create({
      operacion,
      creadoPor: req.user.username,
      observacion: observacion || '',
      items,
    });
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items-sol/:id
router.get('/:id', async (req, res) => {
  try {
    const sol = await ItemsSolicitud.findById(req.params.id).lean();
    if (!sol) return res.status(404).json({ error: 'No encontrada' });
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items-sol/:id — editar solicitud (borrador, pendiente o rechazado)
router.put('/:id', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol) return res.status(404).json({ error: 'No encontrada' });
    const editables = ['borrador', 'pendiente', 'rechazado'];
    if (!editables.includes(sol.estado) || (sol.creadoPor !== req.user.username && req.user.role !== 'ADMIN'))
      return res.status(403).json({ error: 'No se puede editar en este estado' });
    const { observacion, items } = req.body;
    if (observacion !== undefined) sol.observacion = observacion;
    if (items !== undefined) sol.items = items;
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/items-sol/:id/enviar
router.post('/:id/enviar', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol || !['borrador','pendiente','rechazado'].includes(sol.estado))
      return res.status(400).json({ error: 'No disponible' });
    if (!sol.items.length) return res.status(400).json({ error: 'Sin ítems' });
    sol.estado = 'pendiente';
    sol.enviadoEn = new Date();
    // Limpiar validación previa si se re-envía tras rechazo
    if (sol.estado === 'rechazado') { sol.validadoPor = undefined; sol.validadoEn = undefined; sol.comentarioValidador = undefined; }
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/items-sol/:id/cancelar (devolver a borrador)
router.post('/:id/cancelar', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') return res.status(400).json({ error: 'No disponible' });
    sol.estado = 'borrador';
    sol.enviadoEn = undefined;
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/items-sol/:id
router.delete('/:id', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'borrador') return res.status(400).json({ error: 'Solo se pueden eliminar borradores' });
    await sol.deleteOne();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items-sol/:id/validar — validador guarda cambios + aprueba/rechaza
router.put('/:id/validar', async (req, res) => {
  if (!canValidar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') return res.status(400).json({ error: 'No disponible' });
    const { accion, comentarioValidador, items } = req.body;
    if (!['aprobar','rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });
    // Actualizar datos de cada ítem validado
    if (items) {
      for (const upd of items) {
        const it = sol.items.id(upd._id);
        if (!it) continue;
        ['nombreVal','tipoItemVal','lineaVal','familiaVal','subFamiliaVal','unidadVal','grupoCompra','comentarioItem']
          .forEach(f => { if (upd[f] !== undefined) it[f] = upd[f]; });
      }
    }
    sol.estado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
    sol.validadoPor = req.user.username;
    sol.validadoEn  = new Date();
    sol.comentarioValidador = comentarioValidador || '';
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items-sol/:id/items/:iid/registrar — registrador asigna código ERP
router.put('/:id/items/:iid/registrar', async (req, res) => {
  if (!canRegistrar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await ItemsSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'aprobado') return res.status(400).json({ error: 'No disponible' });
    const it = sol.items.id(req.params.iid);
    if (!it) return res.status(404).json({ error: 'Ítem no encontrado' });
    it.codigoErp   = req.body.codigoErp || '';
    it.registradoEn = new Date();
    // Si todos tienen código ERP → completado
    if (sol.items.every(i => i.codigoErp)) sol.estado = 'completado';
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

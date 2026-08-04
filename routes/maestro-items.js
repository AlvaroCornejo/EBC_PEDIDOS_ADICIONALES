const express = require('express');
const auth = require('../middleware/auth');

const MaestroLinea         = require('../models/MaestroLinea');
const MaestroFamilia       = require('../models/MaestroFamilia');
const MaestroSubFamilia    = require('../models/MaestroSubFamilia');
const MaestroTipoItem      = require('../models/MaestroTipoItem');
const MaestroUM            = require('../models/MaestroUM');
const MaestroCuenta        = require('../models/MaestroCuenta');
const MaestroItem          = require('../models/MaestroItem');
const MaestroItemSociedad  = require('../models/MaestroItemSociedad');
const MaestroItemSolicitud = require('../models/MaestroItemSolicitud');

const router = express.Router();
router.use(auth);

// Verificar que el usuario tiene algún rolMaestroItems
function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolMaestroItems) return next();
  return res.status(403).json({ error: 'Sin acceso al Maestro de Ítems' });
}
router.use(requireAccess);

const canSolicitar = u => u.role === 'ADMIN' || ['solicitante', 'admin'].includes(u.rolMaestroItems);
const canValidar   = u => u.role === 'ADMIN' || ['validador', 'admin'].includes(u.rolMaestroItems);
const canRegistrar = u => u.role === 'ADMIN' || ['registrador', 'admin'].includes(u.rolMaestroItems);

/** Sociedades autorizadas del usuario para el Maestro de Ítems (null = todas) */
function socsAccess(user) {
  if (user.role === 'ADMIN' || user.rolMaestroItems === 'admin') return null;
  return user.sociedadesMaestros || [];
}
function checkSocAccess(user, sociedad) {
  const socs = socsAccess(user);
  if (socs === null) return true;
  return socs.includes(sociedad);
}

const escRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CAMPOS_CUENTA = ['cuentaInventario', 'cuentaGasto', 'cuentaCostoVenta', 'cuentaVenta'];

// Agrega tipoItemNombre/lineaNombre/familiaNombre/subFamiliaNombre a una lista de ítems
// (o de solicitudes, que tienen los mismos campos de código) sin un $lookup por fila.
async function resolverNombres(items) {
  const tipos = new Set(), lineas = new Set(), fams = new Set(), subs = new Set();
  items.forEach(it => {
    if (it.tipoItem)   tipos.add(it.tipoItem);
    if (it.linea)      lineas.add(it.linea);
    if (it.linea && it.familia) fams.add(`${it.linea}|${it.familia}`);
    if (it.linea && it.familia && it.subFamilia) subs.add(`${it.linea}|${it.familia}|${it.subFamilia}`);
  });
  const [tiposDocs, lineasDocs, famDocs, subDocs] = await Promise.all([
    tipos.size  ? MaestroTipoItem.find({ codigo: { $in: [...tipos] } }).lean() : [],
    lineas.size ? MaestroLinea.find({ codigo: { $in: [...lineas] } }).lean() : [],
    fams.size   ? MaestroFamilia.find({ $or: [...fams].map(k => { const [linea, familia] = k.split('|'); return { linea, familia }; }) }).lean() : [],
    subs.size   ? MaestroSubFamilia.find({ $or: [...subs].map(k => { const [linea, familia, subFamilia] = k.split('|'); return { linea, familia, subFamilia }; }) }).lean() : [],
  ]);
  const tipoMap = Object.fromEntries(tiposDocs.map(d => [d.codigo, d.nombre]));
  const lineaMap = Object.fromEntries(lineasDocs.map(d => [d.codigo, d.nombre]));
  const famMap = Object.fromEntries(famDocs.map(d => [`${d.linea}|${d.familia}`, d.nombre]));
  const subMap = Object.fromEntries(subDocs.map(d => [`${d.linea}|${d.familia}|${d.subFamilia}`, d.nombre]));
  return items.map(it => ({
    ...it,
    tipoItemNombre: tipoMap[it.tipoItem] || '',
    lineaNombre:    lineaMap[it.linea] || '',
    familiaNombre:  famMap[`${it.linea}|${it.familia}`] || '',
    subFamiliaNombre: subMap[`${it.linea}|${it.familia}|${it.subFamilia}`] || '',
  }));
}

// ── Referencias ──────────────────────────────────────────────────────────────
router.get('/refs', async (req, res) => {
  try {
    const [lineas, tiposItem, ums] = await Promise.all([
      MaestroLinea.find().sort({ codigo: 1 }).lean(),
      MaestroTipoItem.find().sort({ codigo: 1 }).lean(),
      MaestroUM.find().sort({ codigo: 1 }).lean(),
    ]);
    res.json({ lineas, tiposItem, ums });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/refs/familias', async (req, res) => {
  try {
    const { linea } = req.query;
    const filter = {};
    if (linea) filter.linea = linea;
    const rows = await MaestroFamilia.find(filter).sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/refs/sub-familias', async (req, res) => {
  try {
    const { linea, familia } = req.query;
    const filter = {};
    if (linea)   filter.linea   = linea;
    if (familia) filter.familia = familia;
    const rows = await MaestroSubFamilia.find(filter).sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /cuentas?q= — autocomplete por código o nombre (máx. 30 resultados)
router.get('/cuentas', async (req, res) => {
  try {
    const term = (req.query.q || '').trim();
    if (term.length < 2) return res.json([]);
    const filter = /^\d+$/.test(term)
      ? { $expr: { $regexMatch: { input: { $toString: '$cuenta' }, regex: term } } }
      : { nombre: { $regex: escRegex(term), $options: 'i' } };
    const rows = await MaestroCuenta.find(filter).sort({ cuenta: 1 }).limit(30).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/siguiente-item', async (req, res) => {
  try {
    const max = await MaestroItem.findOne().sort({ item: -1 }).lean();
    res.json({ siguiente: (max?.item || 0) + 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Catálogo ──────────────────────────────────────────────────────────────────
// GET /items?sociedad=&q=&tipoItem=&linea=&familia=&subFamilia=&asignados=true|false&page=
router.get('/items', async (req, res) => {
  try {
    const { sociedad, q, tipoItem, linea, familia, subFamilia, asignados = 'true', page = 1 } = req.query;
    if (!sociedad) return res.status(400).json({ error: 'Sociedad requerida' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    const PER = 50;

    const and = [];
    if (tipoItem)   and.push({ tipoItem });
    if (linea)      and.push({ linea });
    if (familia)    and.push({ familia });
    if (subFamilia) and.push({ subFamilia });
    if (q) {
      const term = q.trim();
      if (/^\d+$/.test(term)) and.push({ item: Number(term) });
      else and.push({ nombre: { $regex: escRegex(term), $options: 'i' } });
    }

    const asignadosIds = await MaestroItemSociedad.distinct('item', { sociedadCodigo: sociedad });
    if (asignados === 'false') {
      and.push({ item: { $nin: asignadosIds } });
      const lineasOcultas = await MaestroLinea.distinct('codigo', { ver: 'S' });
      if (lineasOcultas.length) and.push({ linea: { $nin: lineasOcultas } });
    } else {
      and.push({ item: { $in: asignadosIds } });
    }

    const match = { $and: and };
    const [total, items] = await Promise.all([
      MaestroItem.countDocuments(match),
      MaestroItem.find(match).sort({ nombre: 1 }).skip((+page - 1) * PER).limit(PER).lean(),
    ]);
    res.json({ items: await resolverNombres(items), total, page: +page, pages: Math.ceil(total / PER) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /items-buscar?q= — búsqueda global de ítems (cualquier sociedad), para "copiar de..."
router.get('/items-buscar', async (req, res) => {
  try {
    const term = (req.query.q || '').trim();
    if (term.length < 2) return res.json([]);
    const filter = /^\d+$/.test(term)
      ? { item: Number(term) }
      : { nombre: { $regex: escRegex(term), $options: 'i' } };
    const rows = await MaestroItem.find(filter).sort({ nombre: 1 }).limit(20).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /items/:item — detalle (para "copiar")
router.get('/items/:item', async (req, res) => {
  try {
    const it = await MaestroItem.findOne({ item: Number(req.params.item) }).lean();
    if (!it) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json(it);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Solicitudes ───────────────────────────────────────────────────────────────
router.get('/solicitudes', async (req, res) => {
  try {
    const u = req.user;
    const filter = {};
    const socs = socsAccess(u);
    if (socs !== null) filter.sociedad = { $in: socs };
    if (canValidar(u) || canRegistrar(u)) {
      filter.$or = [{ estado: { $ne: 'borrador' } }, { creadoPor: u.username }];
    } else {
      filter.creadoPor = u.username;
    }
    const sols = await MaestroItemSolicitud.find(filter).sort({ creadoEn: -1 }).lean();
    res.json(sols);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/solicitudes', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const { sociedad, origenItem, nombre, tipoItem, linea, familia, subFamilia, um,
            cuentaInventario, cuentaGasto, cuentaCostoVenta, cuentaVenta } = req.body;
    if (!sociedad) return res.status(400).json({ error: 'Selecciona la sociedad' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    const sol = await MaestroItemSolicitud.create({
      sociedad, origenItem: origenItem || null,
      nombre: nombre || '', tipoItem: tipoItem || '', linea: linea || '', familia: familia || '', subFamilia: subFamilia || '', um: um || '',
      cuentaInventario: cuentaInventario || null, cuentaGasto: cuentaGasto || null,
      cuentaCostoVenta: cuentaCostoVenta || null, cuentaVenta: cuentaVenta || null,
      creadoPor: req.user.username,
    });
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/solicitudes/:id', async (req, res) => {
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id).lean();
    if (!sol) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, sol.sociedad)) return res.status(403).json({ error: 'Sin acceso' });
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /solicitudes/:id — editar en borrador, pendiente o rechazado
router.put('/solicitudes/:id', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    if (!sol) return res.status(404).json({ error: 'No encontrada' });
    const editables = ['borrador', 'pendiente', 'rechazado'];
    if (!editables.includes(sol.estado) || (sol.creadoPor !== req.user.username && req.user.role !== 'ADMIN'))
      return res.status(403).json({ error: 'No se puede editar en este estado' });
    const campos = ['nombre', 'tipoItem', 'linea', 'familia', 'subFamilia', 'um', ...CAMPOS_CUENTA];
    campos.forEach(c => { if (req.body[c] !== undefined) sol[c] = req.body[c]; });
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/solicitudes/:id/enviar', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    if (!sol || !['borrador', 'pendiente', 'rechazado'].includes(sol.estado))
      return res.status(400).json({ error: 'No disponible' });
    if (!sol.nombre) return res.status(400).json({ error: 'Falta el nombre del ítem' });
    sol.estado = 'pendiente';
    sol.enviadoEn = new Date();
    sol.validadoPor = undefined; sol.validadoEn = undefined; sol.comentarioValidador = undefined;
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/solicitudes/:id/cancelar', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') return res.status(400).json({ error: 'No disponible' });
    sol.estado = 'borrador';
    sol.enviadoEn = undefined;
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/solicitudes/:id', async (req, res) => {
  if (!canSolicitar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    const eliminables = ['borrador', 'pendiente', 'rechazado'];
    if (!sol || !eliminables.includes(sol.estado)) return res.status(400).json({ error: 'Solo se pueden eliminar solicitudes no aprobadas' });
    if (sol.creadoPor !== req.user.username && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Sin permiso' });
    await sol.deleteOne();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /solicitudes/:id/validar — valida las 4 cuentas contra el plan contable, aprueba o rechaza
router.put('/solicitudes/:id/validar', async (req, res) => {
  if (!canValidar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'pendiente') return res.status(400).json({ error: 'No disponible' });
    if (!checkSocAccess(req.user, sol.sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });
    const { accion, comentarioValidador } = req.body;
    if (!['aprobar', 'rechazar'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });

    if (accion === 'aprobar') {
      for (const campo of CAMPOS_CUENTA) {
        if (req.body[campo] !== undefined) sol[campo] = req.body[campo] || null;
        if (!sol[campo]) return res.status(400).json({ error: `Falta la cuenta: ${campo}` });
        const existe = await MaestroCuenta.exists({ cuenta: Number(sol[campo]) });
        if (!existe) return res.status(400).json({ error: `La cuenta ${sol[campo]} no existe en el plan contable (${campo})` });
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

// PUT /solicitudes/:id/registrar — registrador asigna el código ERP final
router.put('/solicitudes/:id/registrar', async (req, res) => {
  if (!canRegistrar(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  try {
    const sol = await MaestroItemSolicitud.findById(req.params.id);
    if (!sol || sol.estado !== 'aprobado') return res.status(400).json({ error: 'No disponible' });
    if (!checkSocAccess(req.user, sol.sociedad)) return res.status(403).json({ error: 'Sociedad no autorizada' });

    const itemCod = Number(req.body.itemAsignado);
    if (!itemCod) return res.status(400).json({ error: 'Código de ítem requerido' });
    const yaExiste = await MaestroItem.exists({ item: itemCod });
    if (yaExiste) return res.status(400).json({ error: `El ítem ${itemCod} ya existe` });

    await MaestroItem.create({
      item: itemCod, nombre: sol.nombre, tipoItem: sol.tipoItem, linea: sol.linea,
      familia: sol.familia, subFamilia: sol.subFamilia, um: sol.um,
      cuentaInventario: sol.cuentaInventario, cuentaGasto: sol.cuentaGasto,
      cuentaCostoVenta: sol.cuentaCostoVenta, cuentaVenta: sol.cuentaVenta,
    });
    await MaestroItemSociedad.updateOne(
      { item: itemCod, sociedadCodigo: sol.sociedad },
      { $setOnInsert: { item: itemCod, sociedadCodigo: sol.sociedad } },
      { upsert: true }
    );

    sol.itemAsignado  = itemCod;
    sol.estado        = 'completado';
    sol.registradoPor = req.user.username;
    sol.registradoEn  = new Date();
    await sol.save();
    res.json(sol);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

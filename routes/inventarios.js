const express = require('express');
const auth = require('../middleware/auth');

const InventarioDiario = require('../models/InventarioDiario');
const Item = require('../models/Item');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.accesoInventarios) return next();
  return res.status(403).json({ error: 'Sin acceso a Inventarios Diarios' });
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

// ── GET /operaciones — operaciones autorizadas que tienen inventario cargado ──
router.get('/operaciones', async (req, res) => {
  try {
    const disponibles = await InventarioDiario.distinct('operacion');
    const ops = opsFilter(req.user);
    const filtradas = ops === null ? disponibles : disponibles.filter(o => ops.includes(o));
    res.json(filtradas.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /almacenes?operacion= ────────────────────────────────────────────
router.get('/almacenes', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const almacenes = await InventarioDiario.distinct('almacen', { operacion });
    res.json(almacenes.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /resumen?operacion=&almacen= — conteo, saldo y diferencia por ítem ──
router.get('/resumen', async (req, res) => {
  try {
    const { operacion, almacen } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const filter = { operacion };
    if (almacen) filter.almacen = almacen;
    const docs = await InventarioDiario.find(filter).sort({ almacen: 1, item: 1 }).lean();

    const nombres = new Map((await Item.find({ operacion, item: { $in: [...new Set(docs.map(d => d.item))] } }, 'item nombre').lean())
      .map(i => [i.item, i.nombre]));

    res.json(docs.map(d => ({
      almacen: d.almacen, item: d.item, nombre: nombres.get(d.item) || '',
      conteo: d.conteo, saldo: d.saldo, diferencia: d.conteo - d.saldo,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

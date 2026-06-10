const express = require('express');
const authMiddleware = require('../middleware/auth');
const CompraItem   = require('../models/CompraItem');
const CompraPareto = require('../models/CompraPareto');
const CompraRoc    = require('../models/CompraRoc');

const router = express.Router();
router.use(authMiddleware);

// Acceso: ADMIN, o usuario con al menos una sociedad asignada en sociedadesCompra
function checkAccess(req, res) {
  const ok = req.user.role === 'ADMIN'
    || (Array.isArray(req.user.sociedadesCompra) && req.user.sociedadesCompra.length > 0);
  if (!ok) { res.status(403).json({ error: 'No autorizado para consultar precios' }); return false; }
  return true;
}

// GET /api/compras/operaciones
// ADMIN ve todas las operaciones del pareto; otros solo las de sus sociedades permitidas
router.get('/operaciones', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const esAdmin = req.user.role === 'ADMIN';
    const allOps = await CompraPareto.distinct('operacion');
    if (esAdmin) return res.json(allOps.filter(Boolean).sort());
    // No-admin: cruzar con operaciones reales de sus sociedades permitidas en CompraRoc
    const permitidas = req.user.sociedadesCompra || [];
    const rocOps = await CompraRoc.distinct('operacion', { sociedad: { $in: permitidas } });
    res.json(allOps.filter(op => op && rocOps.includes(op)).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/grupos-item?operacion=AASI
// Devuelve grupos (clasificación amplia) de los items con pareto para esa operacion
router.get('/grupos-item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion } = req.query;
    let grupos;
    if (operacion) {
      const itemsConPareto = await CompraPareto.distinct('item', { operacion });
      grupos = await CompraItem.distinct('grupo', { item: { $in: itemsConPareto } });
    } else {
      grupos = await CompraItem.distinct('grupo');
    }
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/grupos?operacion=AASI&grupoItem=ALIMENTOS
// Devuelve grupoCompra filtrado por operacion y opcionalmente por grupo
router.get('/grupos', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, grupoItem } = req.query;
    const itemFilter = {};
    if (grupoItem) itemFilter.grupo = grupoItem;
    let grupos;
    if (operacion) {
      const itemsConPareto = await CompraPareto.distinct('item', { operacion });
      grupos = await CompraItem.distinct('grupoCompra', { item: { $in: itemsConPareto }, ...itemFilter });
    } else {
      grupos = await CompraItem.distinct('grupoCompra', itemFilter);
    }
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/items?operacion=AASI&grupoItem=ALIMENTOS&grupo=ABARROTES&pareto=80
// Devuelve items ordenados por participación desc, con flag isPareto y resumen "otros"
router.get('/items', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, grupo, grupoItem, pareto = '80' } = req.query;
    const pct = Math.min(Math.max(parseFloat(pareto) / 100, 0), 1);

    // Pareto data para la operacion, ordenado de mayor a menor participación
    const paretoQuery = {};
    if (operacion) paretoQuery.operacion = operacion;
    const paretoData = await CompraPareto.find(paretoQuery).sort({ basePareto: -1 }).lean();

    // Maestro de items (con filtro de grupo si aplica)
    const itemQuery = {};
    if (grupoItem) itemQuery.grupo = grupoItem;
    if (grupo)     itemQuery.grupoCompra = grupo;
    const itemsArr = await CompraItem.find(itemQuery).lean();
    const itemMap = {};
    itemsArr.forEach(i => { itemMap[i.item] = i; });

    // Calcular total pareto del grupo (para normalizar % dentro del grupo)
    let totalGrupoPareto = 0;
    for (const p of paretoData) {
      if (itemMap[p.item]) totalGrupoPareto += p.basePareto;
    }
    if (totalGrupoPareto === 0) return res.json({ items: [], otros: { count: 0, pct: 0 } });

    // Acumular hasta alcanzar el % objetivo dentro del grupo
    let cumulative = 0;
    const result = [];
    let otrosCount = 0;
    let otrosPareto = 0;

    for (const p of paretoData) {
      const item = itemMap[p.item];
      if (!item) continue;
      const pctGrupo = p.basePareto / totalGrupoPareto;
      const prevCumulative = cumulative;
      cumulative += pctGrupo;
      if (prevCumulative < pct) {
        result.push({
          item:         item.item,
          nombre:       item.nombre,
          grupoCompra:  item.grupoCompra,
          grupo:        item.grupo,
          grupoFamilia: item.grupoFamilia,
          pctGrupo,
          pctGrupoAcum: cumulative,
          pctTotal:     p.basePareto,
          isPareto:     true,
        });
      } else {
        otrosCount++;
        otrosPareto += pctGrupo;
      }
    }

    res.json({ items: result, otros: { count: otrosCount, pct: otrosPareto } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/precios/:item?operacion=AASI&desde=2025-01-01
// Compras del item en esa operacion desde una fecha dada
router.get('/precios/:item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, desde } = req.query;
    const itemId = parseInt(req.params.item);
    const query = { item: itemId };
    if (operacion) query.operacion = operacion;
    if (desde) {
      const desdeDate = new Date(desde);
      if (!isNaN(desdeDate)) query.fecha = { $gte: desdeDate };
    }
    const compras = await CompraRoc.find(query).sort({ fecha: -1 }).limit(5000).lean();
    res.json(compras.map(c => ({
      fecha:          c.fecha,
      sociedad:       c.sociedad,
      operacion:      c.operacion,
      almacen:        c.almacen,
      cantidad:       c.cantidad,
      importe:        c.importe,
      precioUnitario: c.cantidad > 0 ? c.importe / c.cantidad : null,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/total/:item?operacion=AASI — importe total histórico del item en la operacion
router.get('/total/:item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const itemId = parseInt(req.params.item);
    const { operacion } = req.query;
    const match = { item: itemId };
    if (operacion) match.operacion = operacion;
    const agg = await CompraRoc.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$importe' }, cant: { $sum: 1 } } },
    ]);
    res.json({ total: agg[0]?.total ?? null, registros: agg[0]?.cant ?? 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/muestra?operacion=AASI — muestra algunos registros para diagnóstico
router.get('/muestra', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion } = req.query;
    const filter = operacion ? { operacion } : {};
    const [ops, muestra, totalRoc] = await Promise.all([
      CompraRoc.distinct('operacion'),
      CompraRoc.find(filter).sort({ fecha: -1 }).limit(5).lean(),
      CompraRoc.countDocuments(filter),
    ]);
    res.json({ operaciones: ops.slice(0, 30), muestra, totalRoc });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/status — cuántos registros hay importados
router.get('/status', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const [items, pareto, roc] = await Promise.all([
      CompraItem.countDocuments(),
      CompraPareto.countDocuments(),
      CompraRoc.countDocuments(),
    ]);
    const ultimaCompra = await CompraRoc.findOne().sort({ fecha: -1 }).lean();
    res.json({ items, pareto, roc, ultimaFecha: ultimaCompra?.fecha || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

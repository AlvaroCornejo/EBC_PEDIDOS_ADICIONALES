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

// Helper: dado un nombre de operación, devuelve las sociedades a las que pertenece
// (restringidas a las permitidas del usuario si no es admin).
async function socsDeOperacion(operacion, permitidas) {
  const q = { operacion };
  if (permitidas) q.sociedad = { $in: permitidas };
  return CompraRoc.distinct('sociedad', q);
}

// GET /api/compras/operaciones — ADMIN ve todas; otros solo las de sus sociedades asignadas
router.get('/operaciones', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const esAdmin = req.user.role === 'ADMIN';
    const permitidas = esAdmin ? null : (req.user.sociedadesCompra || []);
    const query = permitidas ? { sociedad: { $in: permitidas } } : {};
    const ops = await CompraRoc.distinct('operacion', query);
    res.json(ops.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mantenemos /sociedades por compatibilidad con código existente
router.get('/sociedades', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const esAdmin = req.user.role === 'ADMIN';
    const permitidas = esAdmin ? null : (req.user.sociedadesCompra || []);
    const query = permitidas ? { sociedad: { $in: permitidas } } : {};
    const socs = await CompraRoc.distinct('sociedad', query);
    res.json(socs.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/grupos-item?operacion=GBSRQ
// Devuelve valores distintos del campo "grupo" filtrado por operacion (→ sociedad)
router.get('/grupos-item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, sociedad } = req.query;
    const esAdmin = req.user.role === 'ADMIN';
    const permitidas = esAdmin ? null : (req.user.sociedadesCompra || []);
    let grupos;
    const filtro = operacion || sociedad;
    if (filtro) {
      const socs = operacion
        ? await socsDeOperacion(operacion, permitidas)
        : (permitidas ? [sociedad].filter(s => permitidas.includes(s)) : [sociedad]);
      const itemsConPareto = await CompraPareto.distinct('item', { sociedad: { $in: socs } });
      grupos = await CompraItem.distinct('grupo', { item: { $in: itemsConPareto } });
    } else {
      grupos = await CompraItem.distinct('grupo');
    }
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/grupos?operacion=GBSRQ&grupoItem=ALIMENTOS
// Devuelve grupoCompra filtrado por operacion (→ sociedad) y opcionalmente por grupo
router.get('/grupos', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, sociedad, grupoItem } = req.query;
    const esAdmin = req.user.role === 'ADMIN';
    const permitidas = esAdmin ? null : (req.user.sociedadesCompra || []);
    let itemFilter = {};
    if (grupoItem) itemFilter.grupo = grupoItem;
    let grupos;
    const filtro = operacion || sociedad;
    if (filtro) {
      const socs = operacion
        ? await socsDeOperacion(operacion, permitidas)
        : (permitidas ? [sociedad].filter(s => permitidas.includes(s)) : [sociedad]);
      const itemsConPareto = await CompraPareto.distinct('item', { sociedad: { $in: socs } });
      grupos = await CompraItem.distinct('grupoCompra', { item: { $in: itemsConPareto }, ...itemFilter });
    } else {
      grupos = await CompraItem.distinct('grupoCompra', itemFilter);
    }
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/items?operacion=GBSRQ&grupoItem=ALIMENTOS&grupo=ABARROTES&pareto=80
// Devuelve items ordenados por participación desc, con flag isPareto y resumen "otros"
router.get('/items', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, sociedad, grupo, grupoItem, pareto = '80' } = req.query;
    const esAdmin = req.user.role === 'ADMIN';
    const permitidas = esAdmin ? null : (req.user.sociedadesCompra || []);
    const pct = Math.min(Math.max(parseFloat(pareto) / 100, 0), 1);

    // Pareto data para la operacion/sociedad, ordenado de mayor a menor participación
    const paretoQuery = {};
    if (operacion) {
      const socs = await socsDeOperacion(operacion, permitidas);
      if (socs.length) paretoQuery.sociedad = { $in: socs };
    } else if (sociedad) {
      paretoQuery.sociedad = sociedad;
    }
    const paretoData = await CompraPareto.find(paretoQuery).sort({ basePareto: -1 }).lean();

    // Maestro de items (con filtro de grupo si aplica)
    const itemQuery = {};
    if (grupoItem) itemQuery.grupo = grupoItem;   // clasificación amplia (ALIMENTOS, etc.)
    if (grupo)     itemQuery.grupoCompra = grupo;  // subgrupo (ABARROTES, etc.)
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
      const pctGrupo = p.basePareto / totalGrupoPareto; // % relativo al grupo
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

// GET /api/compras/precios/:item?operacion=GBSRQ&desde=2025-01-01
// Compras del item desde una fecha dada (precio unitario = importe / cantidad)
router.get('/precios/:item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { operacion, sociedad, desde } = req.query;
    const itemId = parseInt(req.params.item);

    const query = { item: itemId };
    if (operacion) query.operacion = operacion;
    else if (sociedad) query.sociedad = sociedad;
    if (desde) {
      const desdeDate = new Date(desde);
      if (!isNaN(desdeDate)) query.fecha = { $gte: desdeDate };
    }

    const compras = await CompraRoc.find(query)
      .sort({ fecha: -1 })
      .limit(5000)
      .lean();

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

// GET /api/compras/total/:item?operacion=GBSRQ — importe total histórico del item
router.get('/total/:item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const itemId = parseInt(req.params.item);
    const { operacion, sociedad } = req.query;
    const match = { item: itemId };
    if (operacion) match.operacion = operacion;
    else if (sociedad) match.sociedad = sociedad;
    const agg = await CompraRoc.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$importe' }, cant: { $sum: 1 } } },
    ]);
    res.json({ total: agg[0]?.total ?? null, registros: agg[0]?.cant ?? 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/muestra?sociedad=GB — muestra algunos registros reales para diagnóstico
router.get('/muestra', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { sociedad } = req.query;
    const filter = sociedad ? { sociedad } : {};
    const [socs, ops, muestra, totalRoc] = await Promise.all([
      CompraRoc.distinct('sociedad'),
      CompraRoc.distinct('operacion', filter),
      CompraRoc.find(filter).sort({ fecha: -1 }).limit(5).lean(),
      CompraRoc.countDocuments(filter),
    ]);
    res.json({ sociedades: socs, operaciones: ops.slice(0, 30), muestra, totalRoc });
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

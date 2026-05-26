const express = require('express');
const authMiddleware = require('../middleware/auth');
const CompraItem   = require('../models/CompraItem');
const CompraPareto = require('../models/CompraPareto');
const CompraRoc    = require('../models/CompraRoc');

const router = express.Router();
router.use(authMiddleware);

// Acceso: ADMIN, CONSULTA_PRECIO, o cualquier rol con puedeConsultarPrecios=true
function checkAccess(req, res) {
  const ok = req.user.role === 'ADMIN'
    || req.user.role === 'CONSULTA_PRECIO'
    || req.user.puedeConsultarPrecios === true;
  if (!ok) { res.status(403).json({ error: 'No autorizado para consultar precios' }); return false; }
  return true;
}

// GET /api/compras/grupos?sociedad=ERSAC
// Si se pasa sociedad, solo devuelve grupos que tienen items con datos Pareto para esa sociedad
router.get('/grupos', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { sociedad } = req.query;
    let grupos;
    if (sociedad) {
      const itemsConPareto = await CompraPareto.distinct('item', { sociedad });
      grupos = await CompraItem.distinct('grupoCompra', { item: { $in: itemsConPareto } });
    } else {
      grupos = await CompraItem.distinct('grupoCompra');
    }
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/sociedades
router.get('/sociedades', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const socs = await CompraRoc.distinct('sociedad');
    res.json(socs.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/compras/items?sociedad=100&grupo=ABARROTES&pareto=80
// Devuelve items ordenados por participación desc, con flag isPareto y resumen "otros"
router.get('/items', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { sociedad, grupo, pareto = '80' } = req.query;
    const pct = Math.min(Math.max(parseFloat(pareto) / 100, 0), 1);

    // Pareto data para la sociedad, ordenado de mayor a menor participación
    const paretoQuery = {};
    if (sociedad) paretoQuery.sociedad = sociedad;
    const paretoData = await CompraPareto.find(paretoQuery).sort({ basePareto: -1 }).lean();

    // Maestro de items (con filtro de grupo si aplica)
    const itemQuery = {};
    if (grupo) itemQuery.grupoCompra = grupo;
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

// GET /api/compras/precios/:item?sociedad=100&n=10
// Últimas N compras del item (precio unitario = importe / cantidad)
router.get('/precios/:item', async (req, res) => {
  if (!checkAccess(req, res)) return;
  try {
    const { sociedad, n = '10' } = req.query;
    const itemId = parseInt(req.params.item);
    const limit  = Math.min(parseInt(n) || 10, 200);

    const query = { item: itemId };
    if (sociedad) query.sociedad = sociedad;

    const compras = await CompraRoc.find(query)
      .sort({ fecha: -1 })
      .limit(limit)
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

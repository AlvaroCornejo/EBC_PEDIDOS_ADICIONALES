const express = require('express');
const authMiddleware   = require('../middleware/auth');
const KardexBajaVenta = require('../models/KardexBajaVenta');
const CompraItem       = require('../models/CompraItem');

const router = express.Router();
router.use(authMiddleware);

function opsFilter(user, operacionParam) {
  const userOps = user.role === 'ADMIN' ? null : (user.operations || []);
  if (operacionParam) {
    if (userOps && !userOps.includes(operacionParam)) return null;
    return { operacion: operacionParam };
  }
  return userOps ? { operacion: { $in: userOps } } : {};
}

// ── GET /api/bajas/operaciones ────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const filter = opsFilter(req.user, null);
    if (!filter) return res.json([]);
    const ops = await KardexBajaVenta.distinct('operacion', filter);
    res.json(ops.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bajas/evolucion — tendencia semanal ──────────────────────────────
// ?operacion=X&semanas=N
// Devuelve los últimos N añosem con datos, suma baja y venta, calcula % KPI
router.get('/evolucion', async (req, res) => {
  try {
    const { operacion, semanas: semsQ } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nSems = Math.min(parseInt(semsQ) || 13, 104);

    const agg = await KardexBajaVenta.aggregate([
      { $match: filter },
      { $group: {
          _id:       '$añosem',
          año:       { $first: '$año' },
          semana:    { $first: '$semana' },
          bajaCant:  { $sum: '$bajaCant' },
          bajaImp:   { $sum: '$bajaImp' },
          ventaCant: { $sum: '$ventaCant' },
          ventaImp:  { $sum: '$ventaImp' },
      }},
      { $sort: { _id: -1 } },
      { $limit: nSems },
      { $sort: { _id:  1 } }
    ]);

    res.json(agg.map(r => ({
      añosem:    r._id,
      label:     `S${r.semana}/${r.año}`,
      bajaCant:  r.bajaCant,
      bajaImp:   r.bajaImp,
      ventaCant: r.ventaCant,
      ventaImp:  r.ventaImp,
      pctKpi:    r.ventaImp > 0 ? (r.bajaImp / r.ventaImp * 100) : null,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bajas/por-item — ranking de ítems ────────────────────────────────
// ?operacion=X&semanas=N
// Agrupa por item (últimos N sem con datos), join con nombre desde CompraItem
router.get('/por-item', async (req, res) => {
  try {
    const { operacion, semanas: semsQ } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nSems = Math.min(parseInt(semsQ) || 13, 104);

    // Semanas más recientes con datos
    const semsConDatos = await KardexBajaVenta.distinct('añosem', filter);
    const semsSet = semsConDatos.sort((a, b) => b - a).slice(0, nSems);

    const agg = await KardexBajaVenta.aggregate([
      { $match: { ...filter, añosem: { $in: semsSet } } },
      { $group: {
          _id:       '$item',
          bajaCant:  { $sum: '$bajaCant' },
          bajaImp:   { $sum: '$bajaImp' },
          ventaCant: { $sum: '$ventaCant' },
          ventaImp:  { $sum: '$ventaImp' },
      }},
      // Join con maestro de ítems
      { $lookup: {
          from:         'compraitems',
          localField:   '_id',
          foreignField: 'item',
          as:           'maestro'
      }},
      { $addFields: {
          nombre:      { $ifNull: [{ $arrayElemAt: ['$maestro.nombre',      0] }, ''] },
          grupoCompra: { $ifNull: [{ $arrayElemAt: ['$maestro.grupoCompra', 0] }, ''] },
      }},
      { $project: { maestro: 0 } },
      { $sort: { bajaImp: -1 } },
    ]);

    res.json(agg.map(r => ({
      item:       r._id,
      nombre:     r.nombre,
      grupoCompra:r.grupoCompra,
      bajaCant:   r.bajaCant,
      bajaImp:    r.bajaImp,
      ventaCant:  r.ventaCant,
      ventaImp:   r.ventaImp,
      pctKpi:     r.ventaImp > 0 ? (r.bajaImp / r.ventaImp * 100) : null,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bajas/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const filter = opsFilter(req.user, null);
    if (!filter) return res.json({ total: 0 });
    const total  = await KardexBajaVenta.countDocuments(filter);
    const ultima = await KardexBajaVenta.findOne(filter).sort({ añosem: -1 }).lean();
    res.json({ total, ultimaAñosem: ultima?.añosem || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const authMiddleware = require('../middleware/auth');
const ComparativoOC = require('../models/ComparativoOC');

const router = express.Router();
router.use(authMiddleware);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.puedeVerComparativo) return next();
  return res.status(403).json({ error: 'Sin acceso a Comparativo OC' });
}
router.use(requireAccess);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Últimos N añosem desde hoy */
function ultimosAñoSem(n) {
  const hoy = new Date();
  const resultados = [];
  let año = hoy.getFullYear();
  let sem = getISOWeek(hoy);
  for (let i = 0; i < n; i++) {
    resultados.push(año * 100 + sem);
    sem--;
    if (sem < 1) { año--; sem = 52; }
  }
  return resultados;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}

/** Filtro de operaciones según perfil del usuario */
function opsFilter(user, operacionParam) {
  const userOps = user.role === 'ADMIN' ? null : (user.operations || []);
  if (operacionParam) {
    if (userOps && !userOps.includes(operacionParam)) return null; // sin acceso
    return { operacion: operacionParam };
  }
  return userOps ? { operacion: { $in: userOps } } : {};
}

// ── GET /api/comparativo/operaciones ─────────────────────────────────────────
// Operaciones que tienen datos reales (filtrado por acceso del usuario)
router.get('/operaciones', async (req, res) => {
  try {
    const filter = opsFilter(req.user, null);
    if (!filter) return res.json([]);
    const ops = await ComparativoOC.distinct('operacion', filter);
    res.json(ops.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/comparativo/grupos?operacion=X ───────────────────────────────────
// Grupos de compra disponibles
router.get('/grupos', async (req, res) => {
  try {
    const filter = opsFilter(req.user, req.query.operacion);
    if (!filter) return res.json([]);
    const grupos = await ComparativoOC.distinct('grupoCompra', filter);
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/comparativo/resumen ──────────────────────────────────────────────
// Resumen por ítem: OC vs Real, % cumplimiento, últimas N semanas
// ?operacion=GBPLANTA&grupoCompra=ABARROTES&semanas=8
router.get('/resumen', async (req, res) => {
  try {
    const { operacion, grupoCompra, semanas: semsQ, añosem: añosemExacto } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    let matchFilter;
    if (añosemExacto) {
      matchFilter = { ...filter, añosem: parseInt(añosemExacto) };
    } else {
      const nSems = Math.min(parseInt(semsQ) || 8, 52);
      const semsRango = ultimosAñoSem(nSems);
      const desde = Math.min(...semsRango);
      const hasta = Math.max(...semsRango);
      matchFilter = { ...filter, añosem: { $gte: desde, $lte: hasta } };
    }
    if (grupoCompra) matchFilter.grupoCompra = grupoCompra;

    const agg = await ComparativoOC.aggregate([
      { $match: matchFilter },
      { $group: {
          _id:          { item: '$item', operacion: '$operacion' },
          nombre:       { $first: '$nombre' },
          grupoCompra:  { $first: '$grupoCompra' },
          grupo:        { $first: '$grupo' },
          cantidadReal: { $sum: '$cantidadReal' },
          importeReal:  { $sum: '$importeReal' },
          cantidadOC:   { $sum: '$cantidadOC' },
          importeOC:    { $sum: '$importeOC' },
          cantidadOCOT: { $sum: '$cantidadOCOT' },
          importeOCOT:  { $sum: '$importeOCOT' },
          semanas:      { $addToSet: '$añosem' }
      }},
      { $sort: { importeOC: -1 } }
    ]);

    const result = agg.map(r => {
      const ocTotal   = r.cantidadOC + r.cantidadOCOT;
      const impOCTotal = r.importeOC + r.importeOCOT;
      const pctCumpl  = ocTotal > 0 ? (r.cantidadReal / ocTotal) * 100 : null;
      return {
        item:         r._id.item,
        operacion:    r._id.operacion,
        nombre:       r.nombre,
        grupoCompra:  r.grupoCompra,
        grupo:        r.grupo,
        cantidadReal: r.cantidadReal,
        importeReal:  r.importeReal,
        cantidadOC:   r.cantidadOC,
        importeOC:    r.importeOC,
        cantidadOCOT: r.cantidadOCOT,
        importeOCOT:  r.importeOCOT,
        ocTotal,
        impOCTotal,
        pctCumplimiento: pctCumpl != null ? Math.round(pctCumpl * 10) / 10 : null,
        diferencia:   r.importeReal - impOCTotal,
        nSemanas:     r.semanas.length
      };
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/comparativo/evolucion ─────────────────────────────────────────────
// Evolución semanal OC vs Real para un ítem o grupo
// ?operacion=X&item=151&semanas=13
router.get('/evolucion', async (req, res) => {
  try {
    const { operacion, item, grupoCompra, semanas: semsQ } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nSems = Math.min(parseInt(semsQ) || 13, 52);
    const semsRango = ultimosAñoSem(nSems);
    const desde = Math.min(...semsRango);
    const hasta = Math.max(...semsRango);

    const matchFilter = { ...filter, añosem: { $gte: desde, $lte: hasta } };
    if (item)       matchFilter.item = String(item);
    if (grupoCompra) matchFilter.grupoCompra = grupoCompra;

    const agg = await ComparativoOC.aggregate([
      { $match: matchFilter },
      { $group: {
          _id:          '$añosem',
          cantidadReal: { $sum: '$cantidadReal' },
          importeReal:  { $sum: '$importeReal' },
          cantidadOC:   { $sum: '$cantidadOC' },
          importeOC:    { $sum: '$importeOC' },
          cantidadOCOT: { $sum: '$cantidadOCOT' },
          importeOCOT:  { $sum: '$importeOCOT' }
      }},
      { $sort: { _id: 1 } }
    ]);

    res.json(agg.map(r => ({
      añosem:       r._id,
      año:          Math.floor(r._id / 100),
      semana:       r._id % 100,
      label:        `S${r._id % 100}/${Math.floor(r._id / 100)}`,
      cantidadReal: r.cantidadReal,
      importeReal:  r.importeReal,
      cantidadOC:   r.cantidadOC + r.cantidadOCOT,
      importeOC:    r.importeOC + r.importeOCOT,
      pctCumplimiento: (r.cantidadOC + r.cantidadOCOT) > 0
        ? Math.round((r.cantidadReal / (r.cantidadOC + r.cantidadOCOT)) * 1000) / 10
        : null
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/comparativo/stats ─────────────────────────────────────────────────
// Estadísticas generales: total docs, última semana disponible
router.get('/stats', async (req, res) => {
  try {
    const filter = opsFilter(req.user, req.query.operacion);
    if (!filter) return res.json({ total: 0 });
    const [total, ultima] = await Promise.all([
      ComparativoOC.countDocuments(filter),
      ComparativoOC.findOne(filter).sort({ añosem: -1 }).select('añosem').lean()
    ]);
    res.json({ total, ultimaAñosem: ultima?.añosem || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

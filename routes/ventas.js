const express = require('express');
const authMiddleware = require('../middleware/auth');
const VentasTip = require('../models/VentasTip');

const router = express.Router();
router.use(authMiddleware);

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/** Filtro de operaciones según perfil del usuario */
function opsFilter(user, operacionParam) {
  const userOps = user.role === 'ADMIN' ? null : (user.operations || []);
  if (operacionParam) {
    if (userOps && !userOps.includes(operacionParam)) return null;
    return { operacion: operacionParam };
  }
  return userOps ? { operacion: { $in: userOps } } : {};
}

// ── GET /api/ventas/operaciones ───────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const filter = opsFilter(req.user, null);
    if (!filter) return res.json([]);
    const ops = await VentasTip.distinct('operacion', filter);
    res.json(ops.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/ventas/evolucion — semanal ──────────────────────────────────────
// Devuelve las últimas N semanas con datos reales (sin importar qué tan antiguas)
router.get('/evolucion', async (req, res) => {
  try {
    const { operacion, semanas: semsQ } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nSems = Math.min(parseInt(semsQ) || 13, 104);

    const agg = await VentasTip.aggregate([
      { $match: filter },
      { $group: {
          _id:         '$añosem',
          año:         { $first: '$año' },
          semana:      { $first: '$semana' },
          ventaBruta:  { $sum: '$ventaBruta' },
          ventaNeta:   { $sum: '$ventaNeta' },
          tipEfectivo: { $sum: '$tipEfectivo' },
          tipTC:       { $sum: '$tipTC' }
      }},
      { $sort: { _id: -1 } },
      { $limit: nSems },
      { $sort: { _id:  1 } }   // reordenar ascendente para gráfico
    ]);

    res.json(agg.map(r => ({
      añosem:      r._id,
      año:         r.año,
      semana:      r.semana,
      label:       `S${r.semana}/${r.año}`,
      ventaBruta:  r.ventaBruta,
      ventaNeta:   r.ventaNeta,
      tipEfectivo: r.tipEfectivo,
      tipTC:       r.tipTC,
      tipTotal:    r.tipEfectivo + r.tipTC
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/ventas/evolucion-mes — mensual ───────────────────────────────────
// Devuelve los últimos N meses con datos reales
router.get('/evolucion-mes', async (req, res) => {
  try {
    const { operacion, meses: mesQ } = req.query;
    const filter = opsFilter(req.user, operacion);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nMeses = Math.min(parseInt(mesQ) || 12, 60);

    const agg = await VentasTip.aggregate([
      { $match: { ...filter, añomes: { $gt: 0 } } },   // excluir registros sin añomes
      { $group: {
          _id:         '$añomes',
          añoN:        { $first: '$añoN' },
          mesN:        { $first: '$mesN' },
          ventaBruta:  { $sum: '$ventaBruta' },
          ventaNeta:   { $sum: '$ventaNeta' },
          tipEfectivo: { $sum: '$tipEfectivo' },
          tipTC:       { $sum: '$tipTC' }
      }},
      { $sort: { _id: -1 } },
      { $limit: nMeses },
      { $sort: { _id:  1 } }
    ]);

    res.json(agg.map(r => ({
      añomes:      r._id,
      añoN:        r.añoN,
      mesN:        r.mesN,
      label:       `${MESES[(r.mesN || 1) - 1]}/${r.añoN}`,
      ventaBruta:  r.ventaBruta,
      ventaNeta:   r.ventaNeta,
      tipEfectivo: r.tipEfectivo,
      tipTC:       r.tipTC,
      tipTotal:    r.tipEfectivo + r.tipTC
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/ventas/por-sede — semanal ───────────────────────────────────────
router.get('/por-sede', async (req, res) => {
  try {
    const { semanas: semsQ } = req.query;
    const filter = opsFilter(req.user, null);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nSems = Math.min(parseInt(semsQ) || 13, 104);

    // Obtener las N semanas más recientes con datos
    const semsConDatos = await VentasTip.distinct('añosem', filter);
    const semsSet = semsConDatos.sort((a,b) => b - a).slice(0, nSems).sort((a,b) => a - b);

    const agg = await VentasTip.aggregate([
      { $match: { ...filter, añosem: { $in: semsSet } } },
      { $group: {
          _id:         { operacion: '$operacion', añosem: '$añosem' },
          ventaBruta:  { $sum: '$ventaBruta' },
          ventaNeta:   { $sum: '$ventaNeta' },
          tipEfectivo: { $sum: '$tipEfectivo' },
          tipTC:       { $sum: '$tipTC' }
      }},
      { $sort: { '_id.operacion': 1, '_id.añosem': 1 } }
    ]);

    const semanas = semsSet.map(as => ({
      id:    as,
      label: `S${as % 100}/${Math.floor(as / 100)}`
    }));

    const byOp = {};
    for (const r of agg) {
      const op = r._id.operacion;
      if (!byOp[op]) byOp[op] = {};
      const tipTotal = r.tipEfectivo + r.tipTC;
      byOp[op][r._id.añosem] = {
        ventaBruta: r.ventaBruta, ventaNeta: r.ventaNeta,
        tipEfectivo: r.tipEfectivo, tipTC: r.tipTC, tipTotal,
        pctTip: r.ventaBruta > 0 ? (tipTotal / r.ventaBruta * 100) : 0
      };
    }

    const sedes = Object.entries(byOp).sort(([a],[b]) => a.localeCompare(b))
      .map(([operacion, datos]) => ({ operacion, datos }));

    res.json({ semanas, sedes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/ventas/por-sede-mes — mensual ────────────────────────────────────
router.get('/por-sede-mes', async (req, res) => {
  try {
    const { meses: mesQ } = req.query;
    const filter = opsFilter(req.user, null);
    if (!filter) return res.status(403).json({ error: 'Sin acceso' });

    const nMeses = Math.min(parseInt(mesQ) || 12, 60);

    // Obtener los N meses más recientes con datos
    const mesesConDatos = await VentasTip.distinct('añomes', { ...filter, añomes: { $gt: 0 } });
    const mesesSet = mesesConDatos.sort((a,b) => b - a).slice(0, nMeses).sort((a,b) => a - b);

    const agg = await VentasTip.aggregate([
      { $match: { ...filter, añomes: { $in: mesesSet } } },
      { $group: {
          _id:         { operacion: '$operacion', añomes: '$añomes' },
          añoN:        { $first: '$añoN' },
          mesN:        { $first: '$mesN' },
          ventaBruta:  { $sum: '$ventaBruta' },
          ventaNeta:   { $sum: '$ventaNeta' },
          tipEfectivo: { $sum: '$tipEfectivo' },
          tipTC:       { $sum: '$tipTC' }
      }},
      { $sort: { '_id.operacion': 1, '_id.añomes': 1 } }
    ]);

    const semanas = mesesSet.map(am => ({
      id:    am,
      label: `${MESES[(am % 100) - 1]}/${Math.floor(am / 100)}`
    }));

    const byOp = {};
    for (const r of agg) {
      const op = r._id.operacion;
      if (!byOp[op]) byOp[op] = {};
      const tipTotal = r.tipEfectivo + r.tipTC;
      byOp[op][r._id.añomes] = {
        ventaBruta: r.ventaBruta, ventaNeta: r.ventaNeta,
        tipEfectivo: r.tipEfectivo, tipTC: r.tipTC, tipTotal,
        pctTip: r.ventaBruta > 0 ? (tipTotal / r.ventaBruta * 100) : 0
      };
    }

    const sedes = Object.entries(byOp).sort(([a],[b]) => a.localeCompare(b))
      .map(([operacion, datos]) => ({ operacion, datos }));

    res.json({ semanas, sedes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/ventas/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const filter = opsFilter(req.user, null);
    if (!filter) return res.json({ total: 0 });
    const [total, ultima] = await Promise.all([
      VentasTip.countDocuments(filter),
      VentasTip.findOne(filter).sort({ añosem: -1 }).select('añosem').lean()
    ]);
    res.json({ total, ultimaAñosem: ultima?.añosem || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

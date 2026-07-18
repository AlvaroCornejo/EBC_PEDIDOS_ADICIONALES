const express = require('express');
const authMiddleware = require('../middleware/auth');
const Eerr = require('../models/Eerr');

const router = express.Router();
router.use(authMiddleware);

function canAccess(user) {
  return user.role === 'ADMIN' || !!user.accesoEERR;
}

// Unidades autorizadas para el usuario
function unidadesAuth(user, requested) {
  const authorized = user.role === 'ADMIN'
    ? requested  // admin puede ver cualquiera
    : (user.operacionesEERR || []).filter(u => !requested.length || requested.includes(u));
  return authorized;
}

// GET /unidades — lista de unidades disponibles (filtradas por permiso)
router.get('/unidades', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const todas = await Eerr.distinct('unidad');
    const auth = req.user.role === 'ADMIN'
      ? todas
      : (req.user.operacionesEERR || []).filter(u => todas.includes(u));
    res.json(auth.sort());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /resumen — agrega SOLES por GRUPO, columnas por operacion o año
// Query: periodoDesde, periodoHasta, unidades (csv), cols (operacion|anio)
router.get('/resumen', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const periodoDesde = parseInt(req.query.periodoDesde) || 0;
    const periodoHasta = parseInt(req.query.periodoHasta) || 999999;
    const cols = req.query.cols === 'anio' ? 'anio' : 'operacion';

    const unidadesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const unidades = req.user.role === 'ADMIN'
      ? unidadesReq
      : (req.user.operacionesEERR || []).filter(u => !unidadesReq.length || unidadesReq.includes(u));

    const match = {
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      ...(unidades.length && { unidad: { $in: unidades } }),
    };

    let columnas, datos;

    if (cols === 'operacion') {
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { grupo: '$grupo', unidad: '$unidad' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.unidad': 1 } },
      ]);

      // Collect column order
      const colSet = new Set();
      agg.forEach(r => colSet.add(r._id.unidad));
      columnas = [...colSet].sort();

      // Pivot
      const map = {};
      agg.forEach(r => {
        if (!map[r._id.grupo]) map[r._id.grupo] = {};
        map[r._id.grupo][r._id.unidad] = (map[r._id.grupo][r._id.unidad] || 0) + r.soles;
      });
      datos = Object.entries(map).map(([grupo, vals]) => ({ grupo, ...vals }));

    } else {
      // anio
      const agg = await Eerr.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              grupo: '$grupo',
              anio: { $floor: { $divide: ['$periodo', 100] } },
            },
            soles: { $sum: '$soles' },
          },
        },
        { $sort: { '_id.anio': 1 } },
      ]);

      const anioSet = new Set();
      agg.forEach(r => anioSet.add(r._id.anio));
      columnas = [...anioSet].sort().map(String);

      const map = {};
      agg.forEach(r => {
        if (!map[r._id.grupo]) map[r._id.grupo] = {};
        const k = String(r._id.anio);
        map[r._id.grupo][k] = (map[r._id.grupo][k] || 0) + r.soles;
      });
      datos = Object.entries(map).map(([grupo, vals]) => ({ grupo, ...vals }));
    }

    res.json({ columnas, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /detalle — desglose por persona para un grupo específico
// Query: grupo, periodoDesde, periodoHasta, unidades (csv), cols (operacion|anio)
router.get('/detalle', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const { grupo } = req.query;
    if (!grupo) return res.status(400).json({ error: 'Falta grupo' });

    const periodoDesde = parseInt(req.query.periodoDesde) || 0;
    const periodoHasta = parseInt(req.query.periodoHasta) || 999999;
    const cols = req.query.cols === 'anio' ? 'anio' : 'operacion';

    const unidadesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const unidades = req.user.role === 'ADMIN'
      ? unidadesReq
      : (req.user.operacionesEERR || []).filter(u => !unidadesReq.length || unidadesReq.includes(u));

    const match = {
      grupo,
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      ...(unidades.length && { unidad: { $in: unidades } }),
    };

    let columnas, datos;

    if (cols === 'operacion') {
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { persona: '$persona', unidad: '$unidad' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.unidad': 1, '_id.persona': 1 } },
      ]);

      const colSet = new Set();
      agg.forEach(r => colSet.add(r._id.unidad));
      columnas = [...colSet].sort();

      const map = {};
      agg.forEach(r => {
        const p = r._id.persona || '(sin proveedor)';
        if (!map[p]) map[p] = {};
        map[p][r._id.unidad] = (map[p][r._id.unidad] || 0) + r.soles;
      });
      datos = Object.entries(map)
        .map(([persona, vals]) => ({ persona, ...vals }))
        .sort((a, b) => {
          const ta = columnas.reduce((s, c) => s + (a[c] || 0), 0);
          const tb = columnas.reduce((s, c) => s + (b[c] || 0), 0);
          return tb - ta;
        });

    } else {
      const agg = await Eerr.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              persona: '$persona',
              anio: { $floor: { $divide: ['$periodo', 100] } },
            },
            soles: { $sum: '$soles' },
          },
        },
        { $sort: { '_id.anio': 1, '_id.persona': 1 } },
      ]);

      const anioSet = new Set();
      agg.forEach(r => anioSet.add(r._id.anio));
      columnas = [...anioSet].sort().map(String);

      const map = {};
      agg.forEach(r => {
        const p = r._id.persona || '(sin proveedor)';
        if (!map[p]) map[p] = {};
        const k = String(r._id.anio);
        map[p][k] = (map[p][k] || 0) + r.soles;
      });
      datos = Object.entries(map)
        .map(([persona, vals]) => ({ persona, ...vals }))
        .sort((a, b) => {
          const ta = columnas.reduce((s, c) => s + (a[c] || 0), 0);
          const tb = columnas.reduce((s, c) => s + (b[c] || 0), 0);
          return tb - ta;
        });
    }

    res.json({ columnas, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

const express = require('express');
const authMiddleware = require('../middleware/auth');
const Eerr = require('../models/Eerr');

const router = express.Router();
router.use(authMiddleware);

function canAccess(user) {
  return user.role === 'ADMIN' || !!user.accesoEERR;
}

// GET /sedes — lista de sedes disponibles (filtradas por permiso)
router.get('/unidades', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const todas = await Eerr.distinct('sede');
    const auth = req.user.role === 'ADMIN'
      ? todas
      : (req.user.operations || []).filter(u => todas.includes(u));
    res.json(auth.sort());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /resumen — agrega SOLES por GRUPO, columnas por sede o año
// Query: periodoDesde, periodoHasta, unidades (csv), cols (operacion|anio)
router.get('/resumen', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const periodoDesde = parseInt(req.query.periodoDesde) || 0;
    const periodoHasta = parseInt(req.query.periodoHasta) || 999999;
    const cols = ['anio','mes'].includes(req.query.cols) ? req.query.cols : 'operacion';

    const sedesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const sedes = req.user.role === 'ADMIN'
      ? sedesReq
      : (req.user.operations || []).filter(u => !sedesReq.length || sedesReq.includes(u));

    const match = {
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      ...(sedes.length && { sede: { $in: sedes } }),
    };

    let columnas, datos;

    if (cols === 'operacion') {
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { grupo: '$grupo', sede: '$sede' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.sede': 1 } },
      ]);

      const colSet = new Set();
      agg.forEach(r => colSet.add(r._id.sede));
      columnas = [...colSet].sort();

      const map = {};
      agg.forEach(r => {
        if (!map[r._id.grupo]) map[r._id.grupo] = {};
        map[r._id.grupo][r._id.sede] = (map[r._id.grupo][r._id.sede] || 0) + r.soles;
      });
      datos = Object.entries(map).map(([grupo, vals]) => ({ grupo, ...vals }));

    } else if (cols === 'anio') {
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

    } else {
      // mes
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { grupo: '$grupo', periodo: '$periodo' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.periodo': 1 } },
      ]);

      const periodoSet = new Set();
      agg.forEach(r => periodoSet.add(String(r._id.periodo)));
      columnas = [...periodoSet].sort();

      const map = {};
      agg.forEach(r => {
        const k = String(r._id.periodo);
        if (!map[r._id.grupo]) map[r._id.grupo] = {};
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

    // Accept single grupo or comma-separated grupos (for subtotal drill-down)
    const grupoList = req.query.grupos
      ? req.query.grupos.split(',').map(g => g.trim()).filter(Boolean)
      : req.query.grupo ? [req.query.grupo] : [];
    if (!grupoList.length) return res.status(400).json({ error: 'Falta grupo' });
    const grupoFilter = grupoList.length === 1 ? grupoList[0] : { $in: grupoList };

    const periodoDesde = parseInt(req.query.periodoDesde) || 0;
    const periodoHasta = parseInt(req.query.periodoHasta) || 999999;
    const cols = ['anio','mes'].includes(req.query.cols) ? req.query.cols : 'operacion';

    const sedesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const sedes = req.user.role === 'ADMIN'
      ? sedesReq
      : (req.user.operations || []).filter(u => !sedesReq.length || sedesReq.includes(u));

    const match = {
      grupo: grupoFilter,
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      ...(sedes.length && { sede: { $in: sedes } }),
    };

    let columnas, datos;

    if (cols === 'operacion') {
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { persona: '$persona', sede: '$sede' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.sede': 1, '_id.persona': 1 } },
      ]);

      const colSet = new Set();
      agg.forEach(r => colSet.add(r._id.sede));
      columnas = [...colSet].sort();

      const map = {};
      agg.forEach(r => {
        const p = r._id.persona || '(sin proveedor)';
        if (!map[p]) map[p] = {};
        map[p][r._id.sede] = (map[p][r._id.sede] || 0) + r.soles;
      });
      datos = Object.entries(map)
        .map(([persona, vals]) => ({ persona, ...vals }))
        .sort((a, b) => {
          const ta = columnas.reduce((s, c) => s + (a[c] || 0), 0);
          const tb = columnas.reduce((s, c) => s + (b[c] || 0), 0);
          return tb - ta;
        });

    } else if (cols === 'anio') {
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

    } else {
      // mes
      const agg = await Eerr.aggregate([
        { $match: match },
        { $group: { _id: { persona: '$persona', periodo: '$periodo' }, soles: { $sum: '$soles' } } },
        { $sort: { '_id.periodo': 1, '_id.persona': 1 } },
      ]);

      const periodoSet = new Set();
      agg.forEach(r => periodoSet.add(String(r._id.periodo)));
      columnas = [...periodoSet].sort();

      const map = {};
      agg.forEach(r => {
        const p = r._id.persona || '(sin proveedor)';
        if (!map[p]) map[p] = {};
        const k = String(r._id.periodo);
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

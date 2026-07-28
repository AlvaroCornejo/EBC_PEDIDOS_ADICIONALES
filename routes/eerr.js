const express = require('express');
const authMiddleware = require('../middleware/auth');
const Eerr = require('../models/Eerr');
const CostoVenta = require('../models/CostoVenta');

const router = express.Router();
router.use(authMiddleware);

function canAccess(user) {
  return user.role === 'ADMIN' || !!user.accesoEERR;
}

// GET /sedes — lista de sedes disponibles (filtradas por permiso)
router.get('/unidades', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const todas = (await Eerr.distinct('sede')).filter(s => (s || '').trim());
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

    // Sin sedes seleccionadas = sin datos (no "todas por defecto"); $in:[] no matchea nada.
    const sedesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const sedes = req.user.role === 'ADMIN'
      ? sedesReq
      : (req.user.operations || []).filter(u => sedesReq.includes(u));

    const match = {
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      sede: { $in: sedes },
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

    // Sin sedes seleccionadas = sin datos (no "todas por defecto"); $in:[] no matchea nada.
    const sedesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const sedes = req.user.role === 'ADMIN'
      ? sedesReq
      : (req.user.operations || []).filter(u => sedesReq.includes(u));

    const match = {
      grupo: grupoFilter,
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      sede: { $in: sedes },
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

// Agrega CostoVenta por una llave (nombreOp o nombreItem) x columna (sede/año/mes),
// igual que /detalle pero sobre la colección CostoVenta. El signo se respeta tal cual
// viene del archivo fuente (no se invierte).
async function aggCostoVenta(match, cols, keyField, keyLabel) {
  let columnas, datos;

  if (cols === 'operacion') {
    const agg = await CostoVenta.aggregate([
      { $match: match },
      { $group: { _id: { key: `$${keyField}`, sede: '$sede' }, soles: { $sum: '$soles' } } },
      { $sort: { '_id.sede': 1 } },
    ]);
    const colSet = new Set();
    agg.forEach(r => colSet.add(r._id.sede));
    columnas = [...colSet].sort();
    const map = {};
    agg.forEach(r => {
      const k = r._id.key || `(sin ${keyLabel})`;
      if (!map[k]) map[k] = {};
      map[k][r._id.sede] = (map[k][r._id.sede] || 0) + r.soles;
    });
    datos = Object.entries(map).map(([k, vals]) => ({ [keyLabel]: k, ...vals }));

  } else if (cols === 'anio') {
    const agg = await CostoVenta.aggregate([
      { $match: match },
      { $group: { _id: { key: `$${keyField}`, anio: { $floor: { $divide: ['$periodo', 100] } } }, soles: { $sum: '$soles' } } },
      { $sort: { '_id.anio': 1 } },
    ]);
    const anioSet = new Set();
    agg.forEach(r => anioSet.add(r._id.anio));
    columnas = [...anioSet].sort().map(String);
    const map = {};
    agg.forEach(r => {
      const k = r._id.key || `(sin ${keyLabel})`;
      if (!map[k]) map[k] = {};
      const c = String(r._id.anio);
      map[k][c] = (map[k][c] || 0) + r.soles;
    });
    datos = Object.entries(map).map(([k, vals]) => ({ [keyLabel]: k, ...vals }));

  } else {
    // mes
    const agg = await CostoVenta.aggregate([
      { $match: match },
      { $group: { _id: { key: `$${keyField}`, periodo: '$periodo' }, soles: { $sum: '$soles' } } },
      { $sort: { '_id.periodo': 1 } },
    ]);
    const periodoSet = new Set();
    agg.forEach(r => periodoSet.add(String(r._id.periodo)));
    columnas = [...periodoSet].sort();
    const map = {};
    agg.forEach(r => {
      const k = r._id.key || `(sin ${keyLabel})`;
      if (!map[k]) map[k] = {};
      const c = String(r._id.periodo);
      map[k][c] = (map[k][c] || 0) + r.soles;
    });
    datos = Object.entries(map).map(([k, vals]) => ({ [keyLabel]: k, ...vals }));
  }

  datos.sort((a, b) => {
    const ta = columnas.reduce((s, c) => s + Math.abs(a[c] || 0), 0);
    const tb = columnas.reduce((s, c) => s + Math.abs(b[c] || 0), 0);
    return tb - ta;
  });

  return { columnas, datos };
}

// GET /detalle-op — detalle adicional (fuente: EBC EERR COSTO VENTA.xlsx) por NOMBRE OP,
// con columnas por sede/año/mes según "cols" (igual que /detalle)
// Query: grupo(s), periodoDesde, periodoHasta, unidades (csv), cols (operacion|anio|mes)
router.get('/detalle-op', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });

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
      : (req.user.operations || []).filter(u => sedesReq.includes(u));

    const match = {
      grupo: grupoFilter,
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      sede: { $in: sedes },
    };

    const { columnas, datos } = await aggCostoVenta(match, cols, 'nombreOp', 'nombreOp');
    res.json({ columnas, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /detalle-item — detalle adicional (fuente: EBC EERR COSTO VENTA.xlsx) por NOMBRE ITEM
// dentro de un NOMBRE OP específico, con columnas por sede/año/mes.
// Query: grupo(s), nombreOp, periodoDesde, periodoHasta, unidades (csv), cols (operacion|anio|mes)
router.get('/detalle-item', async (req, res) => {
  try {
    if (!canAccess(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const grupoList = req.query.grupos
      ? req.query.grupos.split(',').map(g => g.trim()).filter(Boolean)
      : req.query.grupo ? [req.query.grupo] : [];
    if (!grupoList.length) return res.status(400).json({ error: 'Falta grupo' });
    const grupoFilter = grupoList.length === 1 ? grupoList[0] : { $in: grupoList };

    if (!req.query.nombreOp) return res.status(400).json({ error: 'Falta nombreOp' });

    const periodoDesde = parseInt(req.query.periodoDesde) || 0;
    const periodoHasta = parseInt(req.query.periodoHasta) || 999999;
    const cols = ['anio','mes'].includes(req.query.cols) ? req.query.cols : 'operacion';

    const sedesReq = req.query.unidades
      ? req.query.unidades.split(',').map(u => u.trim()).filter(Boolean)
      : [];
    const sedes = req.user.role === 'ADMIN'
      ? sedesReq
      : (req.user.operations || []).filter(u => sedesReq.includes(u));

    const match = {
      grupo: grupoFilter,
      nombreOp: req.query.nombreOp,
      periodo: { $gte: periodoDesde, $lte: periodoHasta },
      sede: { $in: sedes },
    };

    const { columnas, datos } = await aggCostoVenta(match, cols, 'nombreItem', 'nombreItem');
    res.json({ columnas, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

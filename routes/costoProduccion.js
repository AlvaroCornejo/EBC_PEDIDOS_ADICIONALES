const express = require('express');
const auth = require('../middleware/auth');

const User = require('../models/User');
const CostoProduccion = require('../models/CostoProduccion');

const router = express.Router();
router.use(auth);

// Acceso resuelto en vivo contra la base (no desde el JWT, que dura 24 h): así un cambio
// de permiso o de áreas en Admin → Usuarios rige de inmediato.
// req.cp.areas: null = todas (ADMIN o sin restricción), o la lista de áreas permitidas.
router.use(async (req, res, next) => {
  try {
    const u = await User.findOne({ id: req.user.id }, 'role accesoCostoProduccion areasCostoProduccion').lean();
    if (!u) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (u.role === 'ADMIN') { req.cp = { areas: null }; return next(); }
    if (!u.accesoCostoProduccion) return res.status(403).json({ error: 'Sin acceso a Costo de Producción' });
    req.cp = { areas: u.areasCostoProduccion?.length ? u.areasCostoProduccion : null };
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
});
const filtroAreas = (req) => (req.cp.areas ? { area: { $in: req.cp.areas } } : {});

// ── GET /areas — catálogo de áreas cargadas (para el form de usuarios; solo ADMIN) ──
router.get('/areas', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    res.json((await CostoProduccion.distinct('area')).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /datos?anio= ─────────────────────────────────────────────────────────
// Devuelve los ítems del año con sus meses, solo de las áreas permitidas. Los
// indicadores (desviación ponderada, semáforo, impacto en S/) se calculan en el
// navegador: son ~200 ítems × ≤12 meses.
router.get('/datos', async (req, res) => {
  try {
    const f = filtroAreas(req);
    const anios = (await CostoProduccion.distinct('anio', f)).sort((a, b) => b - a);
    const anio = Number(req.query.anio) || anios[0];
    if (!anio || !anios.includes(anio)) return res.json({ anios, anio: null, meses: [], areas: [], items: [], cargadoEn: null });

    const docs = await CostoProduccion.find({ ...f, anio }).sort({ area: 1, item: 1, mes: 1 }).lean();
    const porItem = new Map();
    let cargadoEn = null;
    for (const d of docs) {
      const k = `${d.area}|${d.item}`;
      if (!porItem.has(k)) porItem.set(k, { item: d.item, nombre: d.nombre, area: d.area, unidad: d.unidad, costoReceta: d.costoReceta, meses: {} });
      porItem.get(k).meses[d.mes] = { cantidad: d.cantidad, costoReal: d.costoReal };
      if (!cargadoEn || d.cargadoEn > cargadoEn) cargadoEn = d.cargadoEn;
    }
    res.json({
      anios, anio,
      meses: [...new Set(docs.map(d => d.mes))].sort((a, b) => a - b),
      areas: [...new Set(docs.map(d => d.area))].sort(),
      items: [...porItem.values()],
      cargadoEn,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

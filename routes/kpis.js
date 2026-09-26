const express = require('express');
const authMiddleware = require('../middleware/auth');
const KpiArea = require('../models/KpiArea');
const { resolverAcceso, requiereAcceso, soloAdmin } = require('../utils/kpiAcceso');

// Indicadores de Gestión del Back Office (GAF). Montado en /api/kpis.
// Todo acceso a datos pasa por req.kpi (utils/kpiAcceso.js), resuelto en vivo.
const router = express.Router();
router.use(authMiddleware);

// GET /mi-acceso — no exige acceso (el frontend lo usa para decidir si muestra el menú).
router.get('/mi-acceso', async (req, res) => {
  try {
    const acc = await resolverAcceso(req.user.id);
    if (!acc || (!acc.esAdmin && acc.lectura.size === 0)) return res.json({ acceso: false });
    const areas = await KpiArea.find({ codigo: { $in: [...acc.lectura] } }).sort({ orden: 1 }).lean();
    res.json({
      acceso: true,
      esAdmin: acc.esAdmin,
      esLector: acc.esLector,
      areas: areas.map(a => ({
        codigo: a.codigo, nombre: a.nombre,
        nivel: acc.captura.has(a.codigo) ? 'CAPTURA' : 'LECTURA',
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(requiereAcceso);

// ─── Áreas ────────────────────────────────────────────────────────
// ADMIN ve todas (incluidas inactivas, para poder reactivarlas); el resto solo las suyas.
router.get('/areas', async (req, res) => {
  try {
    const filtro = req.kpi.esAdmin ? {} : { codigo: { $in: [...req.kpi.lectura] } };
    res.json(await KpiArea.find(filtro).sort({ orden: 1, codigo: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/areas', soloAdmin, async (req, res) => {
  try {
    const { codigo, nombre, orden } = req.body;
    if (!codigo?.trim() || !nombre?.trim()) return res.status(400).json({ error: 'Código y nombre son obligatorios' });
    if (await KpiArea.exists({ codigo: codigo.trim().toUpperCase() })) return res.status(400).json({ error: 'Ya existe un área con ese código' });
    const area = await KpiArea.create({ codigo, nombre, orden: Number(orden) || 0 });
    res.json(area);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// El código no se edita (lo referencian usuarios y KPIs). Sin DELETE: solo se desactiva.
router.put('/areas/:codigo', soloAdmin, async (req, res) => {
  try {
    const { nombre, orden, activo } = req.body;
    const update = {
      ...(nombre !== undefined && { nombre: String(nombre).trim() }),
      ...(orden  !== undefined && { orden: Number(orden) || 0 }),
      ...(activo !== undefined && { activo: !!activo }),
    };
    if (update.nombre === '') return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    const area = await KpiArea.findOneAndUpdate({ codigo: req.params.codigo }, update, { returnDocument: 'after' });
    if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    res.json(area);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

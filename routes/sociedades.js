const express = require('express');
const authMiddleware = require('../middleware/auth');
const Sociedad  = require('../models/Sociedad');
const Operacion = require('../models/Operacion');
const User      = require('../models/User');

const router = express.Router();
const adminOnly = (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Solo administradores' });

router.use(authMiddleware);

// GET / — catálogo completo (sociedades con sus operaciones anidadas). Sin gate de rol:
// cualquier usuario autenticado lo necesita para poblar sus propios dropdowns/checkboxes
// (reemplaza las listas fijas ALL_OPS/ALL_SOCS_COMPRA que antes vivían en public/app.js).
router.get('/', async (req, res) => {
  try {
    const [sociedades, operaciones] = await Promise.all([
      Sociedad.find().sort({ codigo: 1 }).lean(),
      Operacion.find().sort({ codigo: 1 }).lean(),
    ]);
    const porSociedad = {};
    operaciones.forEach(o => {
      (porSociedad[o.sociedadCodigo] || (porSociedad[o.sociedadCodigo] = [])).push(o);
    });
    res.json(sociedades.map(s => ({ ...s, operaciones: porSociedad[s.codigo] || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sociedades (admin) ──────────────────────────────────────────────
router.post('/', adminOnly, async (req, res) => {
  try {
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Faltan código o nombre' });
    const existe = await Sociedad.findOne({ codigo: codigo.trim() });
    if (existe) return res.status(400).json({ error: 'Ya existe una sociedad con ese código' });
    const s = await Sociedad.create({ codigo: codigo.trim(), nombre: nombre.trim() });
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Operaciones (admin) — rutas con prefijo /operaciones montadas ANTES de las rutas
// genéricas /:id de sociedades, para que Express no confunda "operaciones" con un :id.
router.post('/:sociedadId/operaciones', adminOnly, async (req, res) => {
  try {
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Faltan código o nombre' });
    const sociedad = await Sociedad.findById(req.params.sociedadId);
    if (!sociedad) return res.status(404).json({ error: 'Sociedad no encontrada' });
    const existe = await Operacion.findOne({ codigo: codigo.trim() });
    if (existe) return res.status(400).json({ error: 'Ya existe una operación con ese código' });
    const o = await Operacion.create({ codigo: codigo.trim(), nombre: nombre.trim(), sociedadCodigo: sociedad.codigo });
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/operaciones/:id', adminOnly, async (req, res) => {
  try {
    const { nombre, igvPct, rcPct } = req.body;
    const update = {};
    if (nombre !== undefined) {
      if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
      update.nombre = nombre.trim();
    }
    if (igvPct !== undefined) update.igvPct = Number(igvPct) || 0;
    if (rcPct !== undefined) update.rcPct = Number(rcPct) || 0;
    const o = await Operacion.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!o) return res.status(404).json({ error: 'No encontrada' });
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/operaciones/:id', adminOnly, async (req, res) => {
  try {
    const o = await Operacion.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'No encontrada' });
    const enUso = await User.countDocuments({ operations: o.codigo });
    if (enUso) return res.status(400).json({ error: `${enUso} usuario(s) tienen esta operación asignada` });
    await o.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sociedades (admin) — genéricas /:id, deben ir DESPUÉS de /operaciones/:id ──────
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
    const s = await Sociedad.findByIdAndUpdate(req.params.id, { nombre: nombre.trim() }, { new: true });
    if (!s) return res.status(404).json({ error: 'No encontrada' });
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const s = await Sociedad.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'No encontrada' });
    const tieneOps = await Operacion.countDocuments({ sociedadCodigo: s.codigo });
    if (tieneOps) return res.status(400).json({ error: `Tiene ${tieneOps} operación(es) asociada(s); elimínelas primero` });
    await s.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

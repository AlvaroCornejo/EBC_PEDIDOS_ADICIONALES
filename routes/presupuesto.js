const express = require('express');
const auth = require('../middleware/auth');

const Presupuesto = require('../models/Presupuesto');
const Eerr = require('../models/Eerr');

const router = express.Router();
router.use(auth);

// Acceso: ADMIN (edita todo) o `rolPresupuesto` = 'ver' | 'editar', limitado a sus `operations`.
function rolDe(user) { return user.role === 'ADMIN' ? 'editar' : (['ver', 'editar'].includes(user.rolPresupuesto) ? user.rolPresupuesto : ''); }
function puedeVer(user, operacion) {
  if (!rolDe(user)) return false;
  return user.role === 'ADMIN' || (user.operations || []).includes(operacion);
}
function puedeEditar(user, operacion) { return rolDe(user) === 'editar' && puedeVer(user, operacion); }

router.use((req, res, next) => rolDe(req.user) ? next() : res.status(403).json({ error: 'Sin acceso a Presupuesto' }));

const anioDe = v => { const a = parseInt(v); return a >= 2000 && a <= 2100 ? a : null; };

// GET /operaciones — operaciones que el usuario puede ver, con indicador de edición
router.get('/operaciones', async (req, res) => {
  try {
    const ops = req.user.role === 'ADMIN' ? null : (req.user.operations || []);
    res.json({ operaciones: ops, rol: rolDe(req.user) });   // null = todas (el cliente usa el catálogo)
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /?operacion=&anio= — presupuesto guardado (vacío si todavía no existe)
router.get('/', async (req, res) => {
  try {
    const { operacion } = req.query, anio = anioDe(req.query.anio);
    if (!operacion || !anio) return res.status(400).json({ error: 'Operación y año requeridos' });
    if (!puedeVer(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const doc = await Presupuesto.findOne({ operacion, anio }).lean();
    res.json({
      operacion, anio, puedeEditar: puedeEditar(req.user, operacion),
      cvPct: doc?.cvPct || Array(12).fill(0), partidas: doc?.partidas || [],
      actualizadoPor: doc?.actualizadoPor || '', actualizadoEn: doc?.actualizadoEn || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const doce = arr => Array.from({ length: 12 }, (_, i) => num(Array.isArray(arr) ? arr[i] : 0));

// PUT /?operacion=&anio= — guarda el presupuesto completo (solo editores)
router.put('/', async (req, res) => {
  try {
    const { operacion } = req.query, anio = anioDe(req.query.anio);
    if (!operacion || !anio) return res.status(400).json({ error: 'Operación y año requeridos' });
    if (!puedeEditar(req.user, operacion)) return res.status(403).json({ error: 'Sin permiso para editar este presupuesto' });

    const partidasIn = Array.isArray(req.body?.partidas) ? req.body.partidas : [];
    if (partidasIn.length > 400) return res.status(400).json({ error: 'Demasiadas partidas' });
    const vistos = new Set();
    const partidas = partidasIn.map(p => ({
      id: String(p.id || '').slice(0, 60), rubro: String(p.rubro || '').slice(0, 60),
      nombre: String(p.nombre || '').slice(0, 120), esAyB: !!p.esAyB, montos: doce(p.montos),
    })).filter(p => p.id && p.rubro);
    for (const p of partidas) { if (vistos.has(p.id)) return res.status(400).json({ error: 'Partida duplicada' }); vistos.add(p.id); }
    const cvPct = doce(req.body?.cvPct);
    if (cvPct.some(v => v < 0 || v > 100)) return res.status(400).json({ error: 'El % de costo de venta debe estar entre 0 y 100' });

    const doc = await Presupuesto.findOneAndUpdate(
      { operacion, anio },
      { operacion, anio, cvPct, partidas, actualizadoPor: req.user.username || '', actualizadoEn: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    res.json({ ok: true, actualizadoPor: doc.actualizadoPor, actualizadoEn: doc.actualizadoEn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /real?operacion=&anio= — PL real de la operación: soles por grupo y mes (clave '01'..'12').
// El cliente arma subtotales y calculados con la misma estructura del PL.
router.get('/real', async (req, res) => {
  try {
    const { operacion } = req.query, anio = anioDe(req.query.anio);
    if (!operacion || !anio) return res.status(400).json({ error: 'Operación y año requeridos' });
    if (!puedeVer(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const agg = await Eerr.aggregate([
      { $match: { sede: operacion, periodo: { $gte: anio * 100 + 1, $lte: anio * 100 + 12 } } },
      { $group: { _id: { grupo: '$grupo', periodo: '$periodo' }, soles: { $sum: '$soles' } } },
    ]);
    const datos = {};
    agg.forEach(r => {
      const mes = String(r._id.periodo).slice(4, 6);
      (datos[r._id.grupo] = datos[r._id.grupo] || {})[mes] = r.soles;
    });
    res.json({ operacion, anio, datos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

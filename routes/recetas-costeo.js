const express = require('express');
const auth = require('../middleware/auth');

const RecetaCosteo        = require('../models/RecetaCosteo');
const RecetaCosteoDetalle = require('../models/RecetaCosteoDetalle');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.puedeVerCosteoRecetas) return next();
  return res.status(403).json({ error: 'Sin acceso al Costeo de Recetas' });
}
router.use(requireAccess);

/** Operaciones autorizadas del usuario (null = todas) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

/**
 * Semáforo por % de desviación entre el costo de receta y el costo real de producción.
 * Verde ≤5%, amarillo ≤15%, rojo mayor. 'gris' si no hay costo de receta (división por 0).
 */
function calcSemaforo(costo, costoReal) {
  const pct = costo ? Math.abs(costoReal - costo) / costo : null;
  if (pct === null) return 'gris';
  if (pct <= 0.05) return 'verde';
  if (pct <= 0.15) return 'amarillo';
  return 'rojo';
}

// ── GET /operaciones ────────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const ops = opsFilter(req.user);
    const filter = ops === null ? {} : { operacion: { $in: ops } };
    const disponibles = await RecetaCosteo.distinct('operacion', filter);
    res.json(disponibles.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /grupos?operacion= ────────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const grupos = await RecetaCosteo.distinct('grupo', { operacion });
    res.json(grupos.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /resumen?operacion=&grupo=&item=&nombre=&semaforo= ─────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const { operacion, grupo, item, nombre, semaforo } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const filter = { operacion };
    if (grupo) filter.grupo = grupo;
    if (item) filter.item = parseInt(item);
    if (nombre) filter.nombre = { $regex: nombre.trim(), $options: 'i' };

    const docs = await RecetaCosteo.find(filter).sort({ grupo: 1, nombre: 1 }).lean();
    let filas = docs.map(d => ({
      grupo: d.grupo, item: d.item, nombre: d.nombre,
      costo: d.costo, costoReal: d.costoReal, batch: d.batch,
      semaforo: calcSemaforo(d.costo, d.costoReal),
      desviacionPct: d.costo ? (d.costoReal - d.costo) / d.costo * 100 : null,
    }));
    if (semaforo) filas = filas.filter(f => f.semaforo === semaforo);

    res.json(filas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /detalle?item=&operacion= ───────────────────────────────────────────
router.get('/detalle', async (req, res) => {
  try {
    const { operacion } = req.query;
    const item = parseInt(req.query.item);
    if (!item || !operacion) return res.status(400).json({ error: 'Ítem y operación requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const [resumen, insumos] = await Promise.all([
      RecetaCosteo.findOne({ item, operacion }).lean(),
      RecetaCosteoDetalle.find({ item, operacion }).sort({ costo: -1 }).lean(),
    ]);
    if (!resumen) return res.status(404).json({ error: 'Ítem no encontrado' });

    const totalCanal = canal => insumos.filter(i => i[canal]).reduce((s, i) => s + i.costo, 0);

    res.json({
      item, operacion,
      grupo: resumen.grupo, nombre: resumen.nombre, batch: resumen.batch,
      costo: resumen.costo, costoReal: resumen.costoReal,
      semaforo: calcSemaforo(resumen.costo, resumen.costoReal),
      totales: { mesa: totalCanal('mesa'), llevar: totalCanal('llevar'), delivery: totalCanal('delivery') },
      insumos: insumos.map(i => ({
        insumo: i.insumo, nombreInsumo: i.nombreInsumo, cantidad: i.cantidad,
        unitario: i.unitario, costo: i.costo, mesa: i.mesa, llevar: i.llevar, delivery: i.delivery,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

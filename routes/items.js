const express = require('express');
const authMiddleware = require('../middleware/auth');
const Item = require('../models/Item');
// Reutilizar los helpers de lectura Excel ya existentes en datos.js
const { readItems, findFile, loadWB } = require('./datos');

const router = express.Router();
router.use(authMiddleware);

// GET /api/items?operacion=AASI  (items activos para autocomplete / solicitud)
router.get('/', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'operacion requerida' });
    const items = await Item.find({ operacion, activo: true }).lean();
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/items/all?operacion=AASI  (admin — incluye inactivos)
router.get('/all', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { operacion } = req.query;
    const query = operacion ? { operacion } : {};
    const items = await Item.find(query).sort({ operacion: 1, item: 1 }).lean();
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/items/sync?operacion=AASI  — solo inserta items nuevos desde Excel
router.post('/sync', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'operacion requerida' });

    const fp = findFile(operacion);
    if (!fp) return res.status(404).json({ error: `No se encontró archivo para ${operacion}` });

    const wb = await loadWB(fp);
    // Usa la misma función readItems que ya usa el sistema (datos.js)
    const excelItems = readItems(wb).map(i => ({
      ...i,
      operacion,
      loteCompra: 1   // default — editable luego en el maestro
    }));

    if (!excelItems.length) return res.status(400).json({ error: 'No se encontraron items en la hoja "Items"' });

    // Bulk upsert: inserta nuevos, actualiza nombre/grupoCompra/gestion de existentes
    // Preserva loteCompra si ya fue configurado manualmente (solo pone default en nuevos)
    const ops = excelItems.map(it => ({
      updateOne: {
        filter: { operacion: it.operacion, item: it.item },
        update: {
          $set:         { nombre: it.nombre, grupoCompra: it.grupoCompra, gestion: it.gestion, activo: true },
          $setOnInsert: { loteCompra: 1 }
        },
        upsert: true
      }
    }));
    const result = await Item.bulkWrite(ops, { ordered: false });
    const insertados  = result.upsertedCount  || 0;
    const actualizados = result.modifiedCount || 0;

    res.json({ total: excelItems.length, insertados, actualizados, existentes: excelItems.length - insertados });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items/bulk?operacion=AASI  — poner lote=1 solo a los que tienen lote=0
router.put('/bulk', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { operacion } = req.query;
    const upd = {};
    if (req.body.loteCompra !== undefined) upd.loteCompra = Number(req.body.loteCompra) || 1;
    if (req.body.gestion    !== undefined) upd.gestion    = req.body.gestion;
    // Solo actualiza items sin lote configurado; preserva los que ya tienen valor
    const filter = operacion ? { operacion, loteCompra: 0 } : { loteCompra: 0 };
    const result = await Item.updateMany(filter, { $set: upd });
    res.json({ updated: result.modifiedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items/:id  — editar loteCompra, gestion, activo
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const upd = {};
    if (req.body.loteCompra !== undefined) upd.loteCompra = Number(req.body.loteCompra) || 0;
    if (req.body.gestion    !== undefined) upd.gestion    = req.body.gestion;
    if (req.body.activo     !== undefined) upd.activo     = Boolean(req.body.activo);
    const item = await Item.findByIdAndUpdate(req.params.id, upd, { new: true });
    if (!item) return res.status(404).json({ error: 'Item no encontrado' });
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/items/:id  — baja lógica
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    await Item.findByIdAndUpdate(req.params.id, { activo: false });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

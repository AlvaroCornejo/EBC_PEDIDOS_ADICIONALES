const express = require('express');
const authMiddleware = require('../middleware/auth');
const Item = require('../models/Item');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const router = express.Router();
router.use(authMiddleware);

const DATA_DIR = path.join(__dirname, '../data');

// ─── Helpers Excel ────────────────────────────────────────────────
function cellVal(row, col) {
  const v = row.getCell(col).value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result  !== undefined) return v.result;
    if (v.richText !== undefined) return v.richText.map(r => r.text).join('');
    return null;
  }
  return v;
}
const str = (row, col) => { const v = cellVal(row, col); return v != null ? String(v).trim() : ''; };
const num = (row, col) => parseFloat(cellVal(row, col)) || 0;

function findFile(operacion) {
  const names = [`${operacion} - ADICIONALES.xlsx`, `${operacion} - Adicionales.xlsx`, `${operacion}.xlsx`];
  for (const n of names) {
    const fp = path.join(DATA_DIR, n);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

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

// POST /api/items/sync?operacion=AASI  — solo inserta items nuevos
router.post('/sync', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'operacion requerida' });

    const fp = findFile(operacion);
    if (!fp) return res.status(404).json({ error: `No se encontró archivo para ${operacion}` });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);
    const sh = wb.getWorksheet('Items');
    if (!sh) return res.status(400).json({ error: 'Hoja "Items" no encontrada en el Excel' });

    const excelItems = [];
    sh.eachRow((row, rn) => {
      if (rn === 1) return;
      const item = str(row, 1);
      if (!item) return;
      excelItems.push({
        operacion,
        item,
        nombre:      str(row, 2),
        grupoCompra: str(row, 3),
        gestion:     str(row, 4) || 'COMPRAS',
        loteCompra:  num(row, 5) || 1   // default 1 si no viene en el Excel
      });
    });

    // Solo inserta items que no existen aún
    let insertados = 0;
    for (const it of excelItems) {
      const exists = await Item.findOne({ operacion: it.operacion, item: it.item });
      if (!exists) {
        await Item.create(it);
        insertados++;
      }
    }

    res.json({ total: excelItems.length, insertados, existentes: excelItems.length - insertados });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/items/bulk?operacion=AASI  — actualizar loteCompra/gestion a todos
router.put('/bulk', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { operacion } = req.query;
    const upd = {};
    if (req.body.loteCompra !== undefined) upd.loteCompra = Number(req.body.loteCompra) || 1;
    if (req.body.gestion    !== undefined) upd.gestion    = req.body.gestion;
    const filter = operacion ? { operacion } : {};
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

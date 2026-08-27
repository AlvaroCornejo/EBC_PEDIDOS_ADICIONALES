const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const Receta  = require('../models/Receta');

router.use(authMiddleware);

// ── Expansión recursiva ──────────────────────────────────────────
function desgloseNodo(recetaMap, item, cantPedida, visited = new Set()) {
  if (visited.has(item)) {
    return { item, descripcion: '(ciclo detectado)', cantPedida, batch: 1, batchesNecesarios: 0, cantidadProducida: 0, subProductos: [], insumosDirectos: [], insumoFinal: true };
  }
  const receta = recetaMap[item];
  if (!receta) {
    return { item, descripcion: '', cantPedida, insumoFinal: true };
  }

  visited = new Set(visited);
  visited.add(item);

  const batch             = receta.batch || 1;
  const batchesNecesarios = Math.ceil(cantPedida / batch);
  const cantidadProducida = batchesNecesarios * batch;

  const subProductos   = [];
  const insumosDirectos = [];

  for (const ing of receta.ingredientes) {
    const cantIng = ing.cantidad * batchesNecesarios;
    if (ing.esSub) {
      subProductos.push(desgloseNodo(recetaMap, ing.item, cantIng, visited));
    } else {
      insumosDirectos.push({
        item:        ing.item,
        descripcion: ing.descripcion,
        cantidad:    cantIng,
        unidad:      ing.unidad,
        areaDescarga:ing.areaDescarga,
      });
    }
  }

  return {
    item,
    descripcion:      receta.descripcion,
    cantPedida,
    batch,
    batchesNecesarios,
    cantidadProducida,
    subProductos,
    insumosDirectos,
  };
}

// Consolida todos los insumos finales del árbol en un mapa plano
function collectInsumos(nodo, acc = {}) {
  for (const ins of (nodo.insumosDirectos || [])) {
    const k = ins.item;
    if (!acc[k]) acc[k] = { item: ins.item, descripcion: ins.descripcion, unidad: ins.unidad, areaDescarga: ins.areaDescarga, cantidad: 0 };
    acc[k].cantidad += ins.cantidad;
  }
  for (const sub of (nodo.subProductos || [])) {
    collectInsumos(sub, acc);
  }
  return acc;
}

// GET /api/recetas/desglose?item=XXXX&cantidad=N
router.get('/desglose', async (req, res) => {
  try {
    const item     = parseInt(req.query.item);
    const cantidad = parseFloat(req.query.cantidad) || 1;
    if (!item) return res.status(400).json({ error: 'Parámetro item requerido' });

    // Cargar todas las recetas en memoria (32K docs pequeños, ~5 MB)
    const recetas = await Receta.find({}, { item: 1, descripcion: 1, batch: 1, ingredientes: 1, _id: 0 }).lean();
    const recetaMap = {};
    recetas.forEach(r => { recetaMap[r.item] = r; });

    if (!recetaMap[item]) {
      return res.json({ item, descripcion: '', cantPedida: cantidad, sinReceta: true, subProductos: [], insumosDirectos: [], resumen: [] });
    }

    const arbol   = desgloseNodo(recetaMap, item, cantidad);
    const insumos = collectInsumos(arbol);
    const resumen = Object.values(insumos).sort((a, b) =>
      (a.areaDescarga || '').localeCompare(b.areaDescarga || '') || (a.descripcion || '').localeCompare(b.descripcion || '')
    );

    res.json({ arbol, resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recetas/item/:item  — datos básicos de un producto
router.get('/item/:item', async (req, res) => {
  try {
    const r = await Receta.findOne({ item: parseInt(req.params.item) }, { _id: 0 }).lean();
    if (!r) return res.status(404).json({ error: 'Sin receta' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recetas/usado-en?item=XXXX — recetas donde este item aparece como
// ingrediente (insumo directo o sub-producto) — la vista inversa de /desglose,
// para saber "¿en qué se transforma/produce este insumo?" desde el Kardex.
router.get('/usado-en', async (req, res) => {
  try {
    const item = parseInt(req.query.item);
    if (!item) return res.status(400).json({ error: 'Parámetro item requerido' });

    const recetas = await Receta.find(
      { 'ingredientes.item': item },
      { item: 1, descripcion: 1, ingredientes: 1, _id: 0 }
    ).lean();

    const usadoEn = recetas.map(r => {
      const ing = r.ingredientes.find(i => i.item === item);
      return {
        item: r.item, descripcion: r.descripcion,
        cantidad: ing?.cantidad || 0, unidad: ing?.unidad || '',
      };
    }).sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''));

    res.json(usadoEn);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/recetas/stats  — cuántas recetas están cargadas
router.get('/stats', async (req, res) => {
  try {
    const total = await Receta.countDocuments();
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

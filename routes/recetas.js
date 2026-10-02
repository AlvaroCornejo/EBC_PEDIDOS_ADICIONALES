const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const Receta  = require('../models/Receta');
const Item    = require('../models/Item');

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

// Explosión consolidada de varios ítems solicitados a la vez. A diferencia de desgloseNodo
// (un ítem, un árbol), aquí se suma primero la demanda de cada sub-producto entre TODOS los
// ítems solicitados y recién entonces se calculan las corridas (batch) — así un mismo
// sub-producto pedido por dos recetas distintas se produce una sola vez, no una por receta.
function explotarConsolidado(recetaMap, solicitados) {
  const demanda = new Map();
  const sinReceta = [];
  const cabecera = new Map();
  for (const s of solicitados) {
    cabecera.set(s.item, { item: s.item, descripcion: s.descripcion || '', cantidad: (cabecera.get(s.item)?.cantidad || 0) + s.cantidad, pedidos: (cabecera.get(s.item)?.pedidos || 0) + (s.pedidos || 1), valor: (cabecera.get(s.item)?.valor || 0) + (s.valor || 0) });
  }
  const orden = [], estado = new Map();
  let ciclo = false;
  const visitar = it => {
    if (estado.get(it) === 2) return;
    if (estado.get(it) === 1) { ciclo = true; return; }
    estado.set(it, 1);
    for (const ing of (recetaMap[it]?.ingredientes || [])) if (ing.esSub && recetaMap[ing.item]) visitar(ing.item);
    estado.set(it, 2);
    orden.push(it);
  };
  for (const c of cabecera.values()) {
    if (!recetaMap[c.item]) { sinReceta.push(c); continue; }
    demanda.set(c.item, (demanda.get(c.item) || 0) + c.cantidad);
    visitar(c.item);
  }
  orden.reverse(); // padres antes que hijos

  const producciones = [], insumos = new Map();
  for (const it of orden) {
    const r = recetaMap[it], dem = demanda.get(it) || 0, batch = r.batch || 1;
    const corridas = Math.ceil(dem / batch - 1e-9);
    producciones.push({ item: it, descripcion: r.descripcion, solicitada: cabecera.get(it)?.cantidad || 0, requerida: dem, batch, corridas, producida: corridas * batch });
    for (const ing of r.ingredientes) {
      const cant = ing.cantidad * corridas;
      if (ing.esSub && recetaMap[ing.item]) { demanda.set(ing.item, (demanda.get(ing.item) || 0) + cant); continue; }
      const k = ing.item;
      if (!insumos.has(k)) insumos.set(k, { item: k, descripcion: ing.descripcion, unidad: ing.unidad, areaDescarga: ing.areaDescarga, cantidad: 0 });
      insumos.get(k).cantidad += cant;
    }
  }
  const porTexto = (a, b) => (a.areaDescarga || '').localeCompare(b.areaDescarga || '') || (a.descripcion || '').localeCompare(b.descripcion || '');
  return {
    solicitado: [...cabecera.values()].sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || '')),
    producciones, insumos: [...insumos.values()].sort(porTexto), sinReceta, ciclo,
  };
}

// POST /api/recetas/explotar  { items: [{ item, cantidad, descripcion?, pedidos? }] }
router.post('/explotar', async (req, res) => {
  try {
    if (!['ADMIN', 'OPERADOR_PLANTA'].includes(req.user.role)) return res.status(403).json({ error: 'Solo Administrador y Planta pueden explotar pedidos' });
    const lista = Array.isArray(req.body?.items) ? req.body.items : [];
    const solicitados = lista
      .map(s => ({ item: parseInt(s.item), cantidad: parseFloat(s.cantidad) || 0, descripcion: String(s.descripcion || ''), pedidos: Number(s.pedidos) || 1, valor: Number(s.valor) || 0 }))
      .filter(s => s.item && s.cantidad > 0);
    if (!solicitados.length) return res.status(400).json({ error: 'No hay ítems de planta con cantidad para explotar' });

    const recetas = await Receta.find({}, { item: 1, descripcion: 1, batch: 1, ingredientes: 1, _id: 0 }).lean();
    const recetaMap = {};
    recetas.forEach(r => { recetaMap[r.item] = r; });
    const out = explotarConsolidado(recetaMap, solicitados);
    // Valorización de producciones e insumos con los costos de la operación PLANTA (hoja Costos
    // de PLANTA - ADICIONALES.xlsx); lo solicitado se valoriza con el costo que trae cada pedido.
    let costos = {}, costosDisponibles = false;
    try {
      const datos = require('./datos'), fp = datos.findFile('PLANTA');
      if (fp) { costos = datos.readCostos(await datos.loadWB(fp)); costosDisponibles = true; }
    } catch (e) { /* sin costos: se devuelve sin valorizar */ }
    const valorar = r => { r.costoUnitario = costos[String(r.item)] || 0; return r; };
    out.producciones.forEach(r => { valorar(r); r.valor = r.requerida * r.costoUnitario; });
    out.insumos.forEach(r => { valorar(r); r.valor = r.cantidad * r.costoUnitario; });
    out.costosDisponibles = costosDisponibles;
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const { operacion } = req.query;
    if (!item) return res.status(400).json({ error: 'Parámetro item requerido' });

    const recetas = await Receta.find(
      { 'ingredientes.item': item },
      { item: 1, descripcion: 1, ingredientes: 1, _id: 0 }
    ).lean();

    // Las recetas son un catálogo global (no tienen operación propia) — se
    // filtran a las que además están catalogadas como ítem en la operación
    // seleccionada, para no mostrar recetas de otras operaciones.
    let permitidos = null;
    if (operacion) {
      const items = await Item.find({ operacion, item: { $in: recetas.map(r => String(r.item)) } }, { item: 1, _id: 0 }).lean();
      permitidos = new Set(items.map(i => i.item));
    }

    const usadoEn = recetas
      .filter(r => !permitidos || permitidos.has(String(r.item)))
      .map(r => {
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

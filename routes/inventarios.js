const express = require('express');
const auth = require('../middleware/auth');

const InventarioDiario = require('../models/InventarioDiario');
const InventarioSemanal = require('../models/InventarioSemanal');
const ItemMaestro = require('../models/ItemMaestro');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.accesoInventarios) return next();
  return res.status(403).json({ error: 'Sin acceso a Inventarios' });
}
router.use(requireAccess);

/** Operaciones autorizadas del usuario (null = todas, solo ADMIN) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

// ── GET /operaciones — operaciones autorizadas que tienen inventario cargado ──
router.get('/operaciones', async (req, res) => {
  try {
    const disponibles = await InventarioDiario.distinct('operacion');
    const ops = opsFilter(req.user);
    const filtradas = ops === null ? disponibles : disponibles.filter(o => ops.includes(o));
    res.json(filtradas.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /almacenes?operacion= ────────────────────────────────────────────
router.get('/almacenes', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const almacenes = await InventarioDiario.distinct('almacen', { operacion });
    res.json(almacenes.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /resumen?operacion=&almacen= — conteo, saldo y diferencia por ítem ──
router.get('/resumen', async (req, res) => {
  try {
    const { operacion, almacen } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const filter = { operacion };
    if (almacen) filter.almacen = almacen;
    const docs = await InventarioDiario.find(filter).sort({ almacen: 1, item: 1 }).lean();

    const nombres = new Map((await ItemMaestro.find({ item: { $in: [...new Set(docs.map(d => d.item))] } }, 'item nombre').lean())
      .map(i => [i.item, i.nombre]));

    res.json(docs.map(d => ({
      almacen: d.almacen, item: d.item, nombre: nombres.get(d.item) || '',
      conteo: d.conteo, saldo: d.saldo, diferencia: d.conteo - d.saldo,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// Inventario Semanal — histórico por semana, agrupado por Grupo (columna GRUPO de MAESTRO_ITEMS)
// ═══════════════════════════════════════════════════════════════════════

// ── GET /semanal/operaciones ─────────────────────────────────────────────
router.get('/semanal/operaciones', async (req, res) => {
  try {
    const disponibles = await InventarioSemanal.distinct('operacion');
    const ops = opsFilter(req.user);
    const filtradas = ops === null ? disponibles : disponibles.filter(o => ops.includes(o));
    res.json(filtradas.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /semanal/almacenes?operacion= ────────────────────────────────────
router.get('/semanal/almacenes', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const almacenes = await InventarioSemanal.distinct('almacen', { operacion });
    res.json(almacenes.sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const claveSemana = (anio, semana) => `${anio}-${String(semana).padStart(2, '0')}`;
const totalDe = porSemana => Object.values(porSemana).reduce((s, v) => s + v, 0);

/** Trae los datos de InventarioSemanal por ítem — compartido por /semanal/grupos y /semanal/resumen. */
async function agregarSemanal(operacion, almacen, campo) {
  const filter = { operacion };
  if (almacen) filter.almacen = almacen;
  const docs = await InventarioSemanal.find(filter).lean();

  const semanasSet = new Map(); // clave -> {anio, semana}
  docs.forEach(d => semanasSet.set(claveSemana(d.anio, d.semana), { anio: d.anio, semana: d.semana }));
  const semanas = [...semanasSet.values()].sort((a, b) => a.anio - b.anio || a.semana - b.semana);

  const maestro = new Map((await ItemMaestro.find({ item: { $in: [...new Set(docs.map(d => d.item))] } }).lean())
    .map(i => [i.item, i]));

  // item -> {nombre, grupo, grupoCompra, porSemana: {clave: valor}}
  // `grupo` (columna GRUPO de MAESTRO_ITEMS) es el filtro que elige el usuario;
  // `grupoCompra` (columna GRUPOCOMPRA) es la que agrupa las filas de la tabla —
  // son dos clasificaciones distintas del mismo ítem, a propósito.
  const porItem = new Map();
  docs.forEach(d => {
    if (!porItem.has(d.item)) {
      const m = maestro.get(d.item);
      porItem.set(d.item, { item: d.item, nombre: m?.nombre || '', grupo: m?.grupo || 'SIN GRUPO', grupoCompra: m?.grupoCompra || 'SIN GRUPO', porSemana: {} });
    }
    const entry = porItem.get(d.item);
    const k = claveSemana(d.anio, d.semana);
    entry.porSemana[k] = (entry.porSemana[k] || 0) + (d[campo] || 0);
  });

  return { semanas, porItem };
}

// ── GET /semanal/grupos?operacion=&almacen= — catálogo de Grupo (para el filtro) ──
router.get('/semanal/grupos', async (req, res) => {
  try {
    const { operacion, almacen } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const { porItem } = await agregarSemanal(operacion, almacen, 'conteo');
    res.json([...new Set([...porItem.values()].map(it => it.grupo))].sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /semanal/resumen?operacion=&almacen=&grupo=&modo=cantidad|importe ──
// El filtro `grupo` (columna GRUPO) elige qué ítems entran; las filas de la
// tabla se agrupan por `grupoCompra` (columna GRUPOCOMPRA) — con drill-down
// a Ítem, ambos ordenados de mayor a menor por su total en el rango.
// Columnas = semana. Suma todos los almacenes de la operación si no se
// especifica uno.
router.get('/semanal/resumen', async (req, res) => {
  try {
    const { operacion, almacen, grupo } = req.query;
    const modo = req.query.modo === 'importe' ? 'importe' : 'cantidad';
    const campo = modo === 'importe' ? 'importe' : 'conteo';
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const { semanas, porItem } = await agregarSemanal(operacion, almacen, campo);

    let items = [...porItem.values()];
    if (grupo) items = items.filter(it => it.grupo === grupo);

    const porGrupoCompra = new Map();
    items.forEach(it => {
      if (!porGrupoCompra.has(it.grupoCompra)) porGrupoCompra.set(it.grupoCompra, { grupoCompra: it.grupoCompra, porSemana: {}, items: [] });
      const g = porGrupoCompra.get(it.grupoCompra);
      g.items.push(it);
      semanas.forEach(s => {
        const k = claveSemana(s.anio, s.semana);
        g.porSemana[k] = (g.porSemana[k] || 0) + (it.porSemana[k] || 0);
      });
    });

    const totalPorSemana = {};
    semanas.forEach(s => {
      const k = claveSemana(s.anio, s.semana);
      totalPorSemana[k] = [...porGrupoCompra.values()].reduce((sum, g) => sum + (g.porSemana[k] || 0), 0);
    });

    const grupos = [...porGrupoCompra.values()]
      .map(g => ({ ...g, items: g.items.sort((a, b) => totalDe(b.porSemana) - totalDe(a.porSemana)) }))
      .sort((a, b) => totalDe(b.porSemana) - totalDe(a.porSemana));

    res.json({
      semanas: semanas.map(s => ({ clave: claveSemana(s.anio, s.semana), anio: s.anio, semana: s.semana })),
      grupos, totalPorSemana,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

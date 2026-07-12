const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const ProyeccionTienda         = require('../models/ProyeccionTienda');
const ProyeccionTiendaSupuesto = require('../models/ProyeccionTiendaSupuesto');

router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolPago) return next();
  return res.status(403).json({ error: 'Sin acceso a Proyección' });
}
router.use(requireAccess);

function isAdmin(req) { return req.user.role === 'ADMIN'; }

function socsUsuario(user) {
  if (user.role === 'ADMIN' || user.rolPago === 'admin') return null;
  return user.sociedadesPago || [];
}

function checkSocAccess(user, compania) {
  const socs = socsUsuario(user);
  if (socs === null) return true;
  return socs.includes(compania);
}

// ── Helpers semana ISO ─────────────────────────────────────────────────────

function isoWeeksInYear(year) {
  const dow = (m, d) => new Date(Date.UTC(year, m - 1, d)).getUTCDay();
  return (dow(1, 1) === 4 || dow(12, 31) === 4) ? 53 : 52;
}

function nextISOWeekCode(yyyyiw) {
  const year = Math.floor(yyyyiw / 100);
  const week = yyyyiw % 100;
  const max  = isoWeeksInYear(year);
  return week < max ? year * 100 + week + 1 : (year + 1) * 100 + 1;
}

function weeksRange(desde, hasta) {
  const weeks = [];
  let w = Number(desde);
  const end = Number(hasta);
  while (w <= end && weeks.length < 520) {
    weeks.push(w);
    w = nextISOWeekCode(w);
  }
  return weeks;
}

// ── Cálculo por semana para una tienda ────────────────────────────────────

function calcSemana(tienda, ventaBruta) {
  if (!ventaBruta) return { ventaBruta: 0, ventaNeta: 0, igv: 0, rc: 0, tip: 0, canales: [] };
  const { igvRate, rcRate, tipRate, canales } = tienda;
  const divisor  = 1 + (igvRate || 0) + (rcRate || 0);
  const ventaNeta = ventaBruta / divisor;
  const igv = ventaNeta * (igvRate || 0);
  const rc  = ventaNeta * (rcRate  || 0);
  const tip = ventaNeta * (tipRate  || 0);
  const canalesCalc = (canales || []).map(c => {
    const monto      = ventaBruta * (c.pct || 0);
    const comision     = c.tipo !== 'efectivo' ? monto * (c.comisionRate    || 0) : 0;
    const igvComision  = c.tipo !== 'efectivo' ? comision * (c.igvComisionRate || 0) : 0;
    return { tipo: c.tipo, nombre: c.nombre || c.tipo, monto, comision, igvComision };
  });
  return { ventaBruta, ventaNeta, igv, rc, tip, canales: canalesCalc };
}

// ── GET /tiendas ──────────────────────────────────────────────────────────

router.get('/tiendas', async (req, res) => {
  try {
    const { compania } = req.query;
    if (!compania) return res.status(400).json({ error: 'Falta compania' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });
    const tiendas = await ProyeccionTienda.find({ compania }).sort({ nombre: 1 }).lean();
    res.json(tiendas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /tiendas ─────────────────────────────────────────────────────────

router.post('/tiendas', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const { compania, nombre, moneda, igvRate, rcRate, tipRate, canales } = req.body;
    if (!compania || !nombre?.trim()) return res.status(400).json({ error: 'Faltan campos requeridos' });
    const tienda = await ProyeccionTienda.create({
      compania, nombre: nombre.trim(),
      moneda:  moneda  || 'PEN',
      igvRate: Number(igvRate) || 0.18,
      rcRate:  Number(rcRate)  || 0.10,
      tipRate: Number(tipRate) || 0.10,
      canales: Array.isArray(canales) ? canales : [],
    });
    res.json(tienda);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /tiendas/:id ──────────────────────────────────────────────────────

router.put('/tiendas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const tienda = await ProyeccionTienda.findById(req.params.id);
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    if (!checkSocAccess(req.user, tienda.compania)) return res.status(403).json({ error: 'Sin acceso' });
    const { nombre, moneda, igvRate, rcRate, tipRate, canales, activa } = req.body;
    if (nombre  !== undefined) tienda.nombre  = String(nombre).trim();
    if (moneda  !== undefined) tienda.moneda  = moneda;
    if (igvRate !== undefined) tienda.igvRate = Number(igvRate);
    if (rcRate  !== undefined) tienda.rcRate  = Number(rcRate);
    if (tipRate !== undefined) tienda.tipRate = Number(tipRate);
    if (activa  !== undefined) tienda.activa  = !!activa;
    if (canales !== undefined) tienda.canales = Array.isArray(canales) ? canales : [];
    await tienda.save();
    res.json(tienda);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /tiendas/:id ───────────────────────────────────────────────────

router.delete('/tiendas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const tienda = await ProyeccionTienda.findById(req.params.id);
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    await ProyeccionTiendaSupuesto.deleteMany({ tiendaId: tienda._id });
    await tienda.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /tiendas/:id/supuestos ────────────────────────────────────────────

router.get('/tiendas/:id/supuestos', async (req, res) => {
  try {
    const tienda = await ProyeccionTienda.findById(req.params.id).lean();
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    if (!checkSocAccess(req.user, tienda.compania)) return res.status(403).json({ error: 'Sin acceso' });
    const supuestos = await ProyeccionTiendaSupuesto.find({ tiendaId: req.params.id })
      .sort({ semana: 1 }).lean();
    res.json(supuestos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /tiendas/:id/supuestos — upsert por semana ──────────────────────

router.post('/tiendas/:id/supuestos', async (req, res) => {
  try {
    const tienda = await ProyeccionTienda.findById(req.params.id).lean();
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    if (!checkSocAccess(req.user, tienda.compania)) return res.status(403).json({ error: 'Sin acceso' });
    const { semana, ventaBruta } = req.body;
    if (!semana || ventaBruta === undefined) return res.status(400).json({ error: 'Faltan semana y ventaBruta' });
    const sup = await ProyeccionTiendaSupuesto.findOneAndUpdate(
      { tiendaId: req.params.id, semana: Number(semana) },
      { $set: { ventaBruta: Number(ventaBruta) } },
      { upsert: true, new: true }
    );
    res.json(sup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /tiendas/:id/supuestos/:semana ─────────────────────────────────

router.delete('/tiendas/:id/supuestos/:semana', async (req, res) => {
  try {
    const tienda = await ProyeccionTienda.findById(req.params.id).lean();
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    if (!checkSocAccess(req.user, tienda.compania)) return res.status(403).json({ error: 'Sin acceso' });
    await ProyeccionTiendaSupuesto.deleteOne({ tiendaId: req.params.id, semana: Number(req.params.semana) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /calculo-tiendas ──────────────────────────────────────────────────

router.get('/calculo-tiendas', async (req, res) => {
  try {
    const { compania, desde, hasta } = req.query;
    if (!compania || !desde || !hasta) return res.status(400).json({ error: 'Faltan compania, desde, hasta' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });

    const semanas = weeksRange(Number(desde), Number(hasta));
    const tiendas = await ProyeccionTienda.find({ compania, activa: true }).lean();
    const tiendaIds = tiendas.map(t => t._id);
    const todosSupuestos = await ProyeccionTiendaSupuesto.find({ tiendaId: { $in: tiendaIds } })
      .sort({ tiendaId: 1, semana: 1 }).lean();

    // Agrupar supuestos por tiendaId (ya vienen ordenados por semana)
    const supuestosPor = {};
    todosSupuestos.forEach(s => {
      const key = String(s.tiendaId);
      (supuestosPor[key] = supuestosPor[key] || []).push(s);
    });

    const resultado = tiendas.map(tienda => {
      const sups = supuestosPor[String(tienda._id)] || [];
      const porSemana = {};
      semanas.forEach(semana => {
        // Step-function: último supuesto con semana <= semana actual
        let ventaBruta = 0;
        for (const s of sups) {
          if (s.semana <= semana) ventaBruta = s.ventaBruta;
          else break;
        }
        porSemana[semana] = calcSemana(tienda, ventaBruta);
      });
      return {
        _id: tienda._id,
        nombre: tienda.nombre,
        moneda: tienda.moneda,
        porSemana,
      };
    });

    res.json({ semanas, tiendas: resultado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

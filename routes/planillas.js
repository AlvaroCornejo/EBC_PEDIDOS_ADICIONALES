const express = require('express');
const auth = require('../middleware/auth');

const Planilla = require('../models/Planilla');
const PlanillaEsperado = require('../models/PlanillaEsperado');
const Operacion = require('../models/Operacion');
const { calcularTrabajador, calcularBolsaOperacion } = require('../utils/planillaCalculo');

const router = express.Router();
router.use(auth);

function esRRHH(user) { return user.role === 'ADMIN' || ['rrhh', 'admin'].includes(user.rolPlanilla); }
function esGAF(user)  { return user.role === 'ADMIN' || ['gaf', 'admin'].includes(user.rolPlanilla); }
function esManagerDe(user, operacion) {
  return user.role === 'ADMIN' || (!!user.accesoPlanillas && (user.operations || []).includes(operacion));
}
function tieneAcceso(user) { return esRRHH(user) || esGAF(user) || !!user.accesoPlanillas; }

router.use((req, res, next) => {
  if (!tieneAcceso(req.user)) return res.status(403).json({ error: 'Sin acceso a Planillas' });
  next();
});

/** Agrega los cálculos derivados (días, bolsa, estimado) a cada trabajador, sin persistirlos. */
function conDerivados(planilla) {
  const obj = planilla.toObject ? planilla.toObject() : planilla;
  const bolsaOperacion = calcularBolsaOperacion(obj);
  const totalPuntos = obj.trabajadores.reduce((s, t) => s + (Number(t.puntos) || 0), 0);
  obj.bolsaOperacion = bolsaOperacion;
  obj.totalPuntos = totalPuntos;
  obj.trabajadores = obj.trabajadores.map(t => ({
    ...t,
    ...calcularTrabajador(t, obj.fechaPago, bolsaOperacion, totalPuntos),
  }));
  return obj;
}

function validarRangos(rangos, campo) {
  if (!Array.isArray(rangos)) throw new Error(`${campo}: debe ser una lista`);
  if (rangos.length > 3) throw new Error(`${campo}: máximo 3 rangos`);
  for (const r of rangos) {
    if (!r.desde || !r.hasta) throw new Error(`${campo}: cada rango necesita desde y hasta`);
    if (new Date(r.hasta) < new Date(r.desde)) throw new Error(`${campo}: "hasta" no puede ser anterior a "desde"`);
  }
}

// ── GET /esperados — catálogo (todos los usuarios con acceso pueden leerlo) ──
router.get('/esperados', async (req, res) => {
  try {
    const docs = await PlanillaEsperado.find({}).sort({ puntos: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/esperados', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { esperado, puntos } = req.body;
    if (!esperado || puntos == null) return res.status(400).json({ error: 'esperado y puntos son requeridos' });
    const doc = await PlanillaEsperado.create({ esperado: String(esperado).trim(), puntos: Number(puntos) });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/esperados/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { esperado, puntos } = req.body;
    const update = {};
    if (esperado !== undefined) update.esperado = String(esperado).trim();
    if (puntos !== undefined) update.puntos = Number(puntos);
    const doc = await PlanillaEsperado.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ error: 'No encontrado' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/esperados/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await PlanillaEsperado.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /operaciones — operaciones visibles según el rol ────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    if (esRRHH(req.user) || esGAF(req.user)) {
      const ops = await Operacion.find({}).sort({ codigo: 1 }).lean();
      return res.json(ops.map(o => o.codigo));
    }
    res.json(req.user.operations || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /?operacion=&mes=&quincena= ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { operacion, mes, quincena } = req.query;
    if (!operacion || !mes || !quincena) return res.status(400).json({ error: 'operacion, mes y quincena son requeridos' });
    if (!esManagerDe(req.user, operacion) && !esRRHH(req.user) && !esGAF(req.user)) {
      return res.status(403).json({ error: 'Operación no autorizada' });
    }
    const planilla = await Planilla.findOne({ operacion, mes: Number(mes), quincena });
    if (!planilla) return res.status(404).json({ error: 'No existe planilla para esa combinación' });
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST / — crea la planilla (RRHH/admin) ──────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!esRRHH(req.user)) return res.status(403).json({ error: 'Solo RRHH puede crear una planilla' });
    const { operacion, mes, quincena, fechaPago, fechaLimiteRRHH, fechaLimiteManager, fechaLimiteGAF, fechaLimiteVoBo } = req.body;
    if (!operacion || !mes || !quincena || !fechaPago || !fechaLimiteRRHH || !fechaLimiteManager || !fechaLimiteGAF || !fechaLimiteVoBo) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    const existe = await Planilla.findOne({ operacion, mes: Number(mes), quincena });
    if (existe) return res.status(400).json({ error: 'Ya existe una planilla para esa operación/mes/quincena' });

    // Trae la planilla de la quincena anterior de esta operación (si existe) y
    // copia sus trabajadores (sin ocurrencias/bolsa), excluyendo cesados.
    let mesAnt = Number(mes), qAnt = quincena === '2Q' ? '1Q' : '2Q';
    if (quincena === '1Q') { mesAnt = mes === 1 ? 12 : mes - 1; }
    const anterior = await Planilla.findOne({ operacion, mes: mesAnt, quincena: qAnt }).lean();
    const trabajadores = (anterior?.trabajadores || [])
      .filter(t => !t.fechaCese)
      .map(t => ({
        codigo: t.codigo, nombre: t.nombre, fechaIngreso: t.fechaIngreso,
        tipoDocumento: t.tipoDocumento, numeroDocumento: t.numeroDocumento,
        basico: t.basico, asignacionFamiliar: t.asignacionFamiliar,
        cargo: t.cargo,
      }));

    const doc = await Planilla.create({
      operacion, mes: Number(mes), quincena, fechaPago, fechaLimiteRRHH, fechaLimiteManager, fechaLimiteGAF, fechaLimiteVoBo,
      creadoPor: req.user.username, trabajadores,
    });
    res.json(conDerivados(doc));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/trabajadores — Paso 1 (RRHH), solo si estado='borrador' ────────
router.put('/:id/trabajadores', async (req, res) => {
  try {
    if (!esRRHH(req.user)) return res.status(403).json({ error: 'Solo RRHH' });
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (planilla.estado !== 'borrador' && req.user.role !== 'ADMIN' && req.user.rolPlanilla !== 'admin') {
      return res.status(400).json({ error: 'La planilla ya no está en Paso 1' });
    }
    const { trabajadores } = req.body;
    if (!Array.isArray(trabajadores)) return res.status(400).json({ error: 'trabajadores debe ser una lista' });
    planilla.trabajadores = trabajadores;
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/pasar-a-manager — RRHH cierra el Paso 1 ────────────────────────
router.put('/:id/pasar-a-manager', async (req, res) => {
  try {
    if (!esRRHH(req.user)) return res.status(403).json({ error: 'Solo RRHH' });
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (planilla.estado !== 'borrador') return res.status(400).json({ error: 'La planilla ya no está en Paso 1' });
    if (!planilla.trabajadores.length) return res.status(400).json({ error: 'Agrega al menos un trabajador' });
    planilla.estado = 'pendienteManager';
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function aplicarOcurrencias(planilla, trabajadores) {
  const porId = new Map(planilla.trabajadores.map(t => [String(t._id), t]));
  for (const upd of trabajadores) {
    const t = porId.get(String(upd._id));
    if (!t) continue;
    ['feriados', 'faltas', 'vacaciones', 'licenciaSinGoce', 'licenciaConGoce', 'descansoMedico'].forEach(campo => {
      if (upd[campo] !== undefined) { validarRangos(upd[campo], campo); t[campo] = upd[campo]; }
    });
    if (upd.extraMonto !== undefined) t.extraMonto = Number(upd.extraMonto) || 0;
    if (upd.extraComentario !== undefined) t.extraComentario = upd.extraComentario;
    if (upd.descuentoMonto !== undefined) t.descuentoMonto = Number(upd.descuentoMonto) || 0;
    if (upd.descuentoComentario !== undefined) t.descuentoComentario = upd.descuentoComentario;
    if (upd.observacion !== undefined) t.observacion = upd.observacion;
  }
}

// ── PUT /:id/ocurrencias — Paso 2 (Manager), solo si estado='pendienteManager' ──
router.put('/:id/ocurrencias', async (req, res) => {
  try {
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (!esManagerDe(req.user, planilla.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (planilla.estado !== 'pendienteManager') return res.status(400).json({ error: 'La planilla ya no está en Paso 2' });
    const { trabajadores } = req.body;
    if (!Array.isArray(trabajadores)) return res.status(400).json({ error: 'trabajadores debe ser una lista' });
    aplicarOcurrencias(planilla, trabajadores);
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /:id/ocurrencias-admin — RRHH/GAF corrigen después del bloqueo ──────
router.put('/:id/ocurrencias-admin', async (req, res) => {
  try {
    if (!esRRHH(req.user) && !esGAF(req.user)) return res.status(403).json({ error: 'Solo RRHH o GAF' });
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    const { trabajadores } = req.body;
    if (!Array.isArray(trabajadores)) return res.status(400).json({ error: 'trabajadores debe ser una lista' });
    aplicarOcurrencias(planilla, trabajadores);
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /:id/manager-ok — Manager da el OK y bloquea el Paso 2 ──────────────
router.put('/:id/manager-ok', async (req, res) => {
  try {
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (!esManagerDe(req.user, planilla.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (planilla.estado !== 'pendienteManager') return res.status(400).json({ error: 'La planilla ya no está en Paso 2' });
    planilla.estado = 'bloqueada';
    planilla.managerOkPor = req.user.username;
    planilla.managerOkEn = new Date();
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/bolsa — Paso 3 (GAF): TIP/RC/%RC + descuentos + esperado por trabajador ──
router.put('/:id/bolsa', async (req, res) => {
  try {
    if (!esGAF(req.user)) return res.status(403).json({ error: 'Solo GAF' });
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (planilla.estado !== 'bloqueada') return res.status(400).json({ error: 'La planilla no está lista para el Paso 3' });

    const { tip, rc, rcPctOperacion, descuentosBolsa, trabajadores } = req.body;
    if (tip !== undefined) planilla.tip = Number(tip) || 0;
    if (rc !== undefined) planilla.rc = Number(rc) || 0;
    if (rcPctOperacion !== undefined) planilla.rcPctOperacion = Number(rcPctOperacion) || 0;
    if (Array.isArray(descuentosBolsa)) {
      planilla.descuentosBolsa = descuentosBolsa.map(d => ({ monto: Number(d.monto) || 0, comentario: d.comentario || '' }));
    }
    if (Array.isArray(trabajadores)) {
      const catalogo = new Map((await PlanillaEsperado.find({}).lean()).map(e => [e.esperado, e.puntos]));
      const porId = new Map(planilla.trabajadores.map(t => [String(t._id), t]));
      for (const upd of trabajadores) {
        const t = porId.get(String(upd._id));
        if (!t || upd.esperado === undefined) continue;
        t.esperado = upd.esperado;
        t.puntos = catalogo.has(upd.esperado) ? catalogo.get(upd.esperado) : 0;
      }
    }
    planilla.estado = 'pendienteVoBo';
    planilla.gafPor = req.user.username;
    planilla.gafEn = new Date();
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/vobo — Paso 4 (Manager) cierra la planilla ─────────────────────
router.put('/:id/vobo', async (req, res) => {
  try {
    const planilla = await Planilla.findById(req.params.id);
    if (!planilla) return res.status(404).json({ error: 'No encontrada' });
    if (!esManagerDe(req.user, planilla.operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    if (planilla.estado !== 'pendienteVoBo') return res.status(400).json({ error: 'La planilla no está lista para el Paso 4' });
    planilla.estado = 'cerrada';
    planilla.voboPor = req.user.username;
    planilla.voboEn = new Date();
    await planilla.save();
    res.json(conDerivados(planilla));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

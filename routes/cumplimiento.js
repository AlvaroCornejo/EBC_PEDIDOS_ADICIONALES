const express = require('express');
const authMiddleware = require('../middleware/auth');
const CumplimientoArea = require('../models/CumplimientoArea');
const CumplimientoActividad = require('../models/CumplimientoActividad');
const User = require('../models/User');

const router = express.Router();
const adminOnly = (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Solo administradores' });

// ── Semanas ISO (YYYYWW) ─────────────────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
  return { week, year: d.getUTCFullYear() };
}
function toSemana(year, week) { return `${year}${String(week).padStart(2, '0')}`; }
function parseSemana(semana) { return { year: Number(String(semana).slice(0, 4)), week: Number(String(semana).slice(4)) }; }
function semanaActual() { const { year, week } = getISOWeek(new Date()); return toSemana(year, week); }
function isoWeeksInYear(year) { return getISOWeek(new Date(Date.UTC(year, 11, 28))).week; }
function mondayOfISOWeek(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return monday;
}
function fechaForDiaSemana(semana, diaSemana) {
  const { year, week } = parseSemana(semana);
  const monday = mondayOfISOWeek(year, week);
  const fecha = new Date(monday);
  fecha.setUTCDate(monday.getUTCDate() + (Number(diaSemana) - 1));
  return fecha;
}
function siguienteSemana(semana) {
  const { year, week } = parseSemana(semana);
  const weeksInYear = isoWeeksInYear(year);
  return week >= weeksInYear ? toSemana(year + 1, 1) : toSemana(year, week + 1);
}

router.use(authMiddleware);

/** Áreas visibles para el usuario actual: todas si es ADMIN, solo las propias si no. */
async function areasVisibles(req) {
  const filtro = req.user.role === 'ADMIN' ? {} : { responsableUserId: req.user.id };
  return CumplimientoArea.find(filtro).sort({ nombre: 1 }).lean();
}

// ── Áreas ────────────────────────────────────────────────────────────
router.get('/areas', async (req, res) => {
  try {
    res.json(await areasVisibles(req));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/areas', adminOnly, async (req, res) => {
  try {
    const { nombre, responsableUserId } = req.body;
    if (!nombre || !responsableUserId) return res.status(400).json({ error: 'Faltan nombre o responsable' });
    const responsable = await User.findOne({ id: responsableUserId });
    if (!responsable) return res.status(400).json({ error: 'Usuario responsable no encontrado' });
    const area = await CumplimientoArea.create({ nombre: nombre.trim(), responsableUserId });
    res.json(area);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/areas/:id', adminOnly, async (req, res) => {
  try {
    const { nombre, responsableUserId, activo } = req.body;
    const update = {};
    if (nombre !== undefined) update.nombre = nombre.trim();
    if (responsableUserId !== undefined) {
      const responsable = await User.findOne({ id: responsableUserId });
      if (!responsable) return res.status(400).json({ error: 'Usuario responsable no encontrado' });
      update.responsableUserId = responsableUserId;
    }
    if (activo !== undefined) update.activo = !!activo;
    const area = await CumplimientoArea.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!area) return res.status(404).json({ error: 'No encontrada' });
    res.json(area);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/areas/:id', adminOnly, async (req, res) => {
  try {
    const area = await CumplimientoArea.findById(req.params.id);
    if (!area) return res.status(404).json({ error: 'No encontrada' });
    const tieneActividades = await CumplimientoActividad.countDocuments({ areaId: String(area._id) });
    if (tieneActividades) {
      area.activo = false;
      await area.save();
      return res.json({ ok: true, desactivada: true });
    }
    await area.deleteOne();
    res.json({ ok: true, eliminada: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Actividades ──────────────────────────────────────────────────────
router.get('/actividades', async (req, res) => {
  try {
    const semana = req.query.semana || semanaActual();
    const areas = await areasVisibles(req);
    const areaIds = areas.map(a => String(a._id));
    const actividades = await CumplimientoActividad.find({ semana, areaId: { $in: areaIds } }).sort({ diaSemana: 1, horaEsperada: 1 }).lean();
    res.json({ semana, areas, actividades });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function requireAreaAdminOrResponsable(req, res, area) {
  if (req.user.role === 'ADMIN') return true;
  if (area.responsableUserId === req.user.id) return true;
  res.status(403).json({ error: 'No tiene acceso a esta área' });
  return false;
}

router.post('/actividades', adminOnly, async (req, res) => {
  try {
    const { areaId, nombre, descripcion, diaSemana, horaEsperada, semana } = req.body;
    if (!areaId || !nombre || !diaSemana) return res.status(400).json({ error: 'Faltan datos' });
    const area = await CumplimientoArea.findById(areaId);
    if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    const sem = semana || semanaActual();
    const actividad = await CumplimientoActividad.create({
      areaId: String(area._id),
      semana: sem,
      nombre: nombre.trim(),
      descripcion: (descripcion || '').trim(),
      diaSemana: Number(diaSemana),
      fecha: fechaForDiaSemana(sem, diaSemana),
      horaEsperada: (horaEsperada || '').trim(),
    });
    res.json(actividad);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/actividades/:id', adminOnly, async (req, res) => {
  try {
    const actividad = await CumplimientoActividad.findById(req.params.id);
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });
    if (actividad.estado !== 'ABIERTA') return res.status(400).json({ error: 'Solo se puede editar una actividad abierta' });
    const { nombre, descripcion, diaSemana, horaEsperada } = req.body;
    if (nombre !== undefined) actividad.nombre = nombre.trim();
    if (descripcion !== undefined) actividad.descripcion = descripcion.trim();
    if (horaEsperada !== undefined) actividad.horaEsperada = horaEsperada.trim();
    if (diaSemana !== undefined) {
      actividad.diaSemana = Number(diaSemana);
      actividad.fecha = fechaForDiaSemana(actividad.semana, diaSemana);
    }
    await actividad.save();
    res.json(actividad);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/actividades/:id', adminOnly, async (req, res) => {
  try {
    const actividad = await CumplimientoActividad.findById(req.params.id);
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });
    await actividad.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/actividades/:id/cerrar', async (req, res) => {
  try {
    const actividad = await CumplimientoActividad.findById(req.params.id);
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });
    const area = await CumplimientoArea.findById(actividad.areaId);
    if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    if (!(await requireAreaAdminOrResponsable(req, res, area))) return;
    if (actividad.estado !== 'ABIERTA') return res.status(400).json({ error: 'La actividad ya está cerrada' });

    actividad.estado = 'CERRADA';
    actividad.comentarioCierre = (req.body.comentario || '').trim();
    actividad.cerradoPor = req.user.id;
    actividad.cerradoEn = new Date();
    await actividad.save();
    res.json(actividad);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/actividades/:id/revisar', adminOnly, async (req, res) => {
  try {
    const { cumplimiento, comentarioAdmin } = req.body;
    if (!['CUMPLIDA', 'NO_CUMPLIDA'].includes(cumplimiento)) return res.status(400).json({ error: 'cumplimiento inválido' });
    const actividad = await CumplimientoActividad.findById(req.params.id);
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });
    if (actividad.estado !== 'CERRADA') return res.status(400).json({ error: 'La actividad debe estar cerrada antes de revisarla' });
    actividad.cumplimiento = cumplimiento;
    actividad.comentarioAdmin = (comentarioAdmin || '').trim();
    actividad.revisadoPor = req.user.id;
    actividad.revisadoEn = new Date();
    await actividad.save();
    res.json(actividad);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Abrir nueva semana ───────────────────────────────────────────────
router.post('/semanas/:semana/abrir-siguiente', adminOnly, async (req, res) => {
  try {
    const semanaActualDoc = req.params.semana;
    const nuevaSemana = siguienteSemana(semanaActualDoc);
    const yaExiste = await CumplimientoActividad.countDocuments({ semana: nuevaSemana });
    if (yaExiste) return res.status(400).json({ error: `La semana ${nuevaSemana} ya tiene actividades` });

    const actividades = await CumplimientoActividad.find({ semana: semanaActualDoc }).lean();
    if (!actividades.length) return res.status(400).json({ error: `La semana ${semanaActualDoc} no tiene actividades para copiar` });

    const nuevas = actividades.map(a => ({
      areaId: a.areaId,
      semana: nuevaSemana,
      nombre: a.nombre,
      descripcion: a.descripcion,
      diaSemana: a.diaSemana,
      fecha: fechaForDiaSemana(nuevaSemana, a.diaSemana),
      horaEsperada: a.horaEsperada,
      estado: 'ABIERTA',
      cumplimiento: '',
    }));
    await CumplimientoActividad.insertMany(nuevas);
    res.json({ ok: true, semana: nuevaSemana, cantidad: nuevas.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

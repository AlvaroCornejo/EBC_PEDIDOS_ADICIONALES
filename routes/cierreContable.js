const express = require('express');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');

const Proceso      = require('../models/Proceso');
const Actividad     = require('../models/Actividad');
const CierreMensual = require('../models/CierreMensual');
const ActividadCierre = require('../models/ActividadCierre');
const AsignacionResponsable = require('../models/AsignacionResponsable');
const AsignacionConsulta    = require('../models/AsignacionConsulta');
const Adjunto       = require('../models/Adjunto');
const DiaNoLaborable = require('../models/DiaNoLaborable');
const Sociedad  = require('../models/Sociedad');
const Operacion = require('../models/Operacion');
const User = require('../models/User');

const fechaLima = require('../utils/fechaLima');
const boxClient = require('../utils/boxClient');
const { sendPush }  = require('../utils/sendPush');
const { sendEmail } = require('../utils/sendEmail');

const router = express.Router();
router.use(authMiddleware);

const adminOnly = (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Solo administradores' });
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Helpers de catálogo / validación ────────────────────────────────────────
async function codigosValidos() {
  const [ops, socs] = await Promise.all([Operacion.distinct('codigo'), Sociedad.distinct('codigo')]);
  return { ops: new Set(ops), socs: new Set(socs) };
}

async function mapaOperacionASociedad() {
  const ops = await Operacion.find().lean();
  const mapa = {};
  ops.forEach(o => { mapa[o.codigo] = o.sociedadCodigo; });
  return mapa;
}

function validarAlcance(body, ops, socs) {
  const { nivelAsignacion, sociedadCodigo, operacionCodigo } = body;
  if (nivelAsignacion === 'SOCIEDAD') {
    if (!sociedadCodigo || !socs.has(sociedadCodigo)) return 'Falta una Sociedad válida';
  } else if (nivelAsignacion === 'OPERACION') {
    if (!operacionCodigo || !ops.has(operacionCodigo)) return 'Falta una Operación válida';
  } else {
    return 'nivelAsignacion debe ser SOCIEDAD u OPERACION';
  }
  return null;
}

function validarScope(body, ops, socs) {
  const { scope, sociedadCodigo, operacionCodigo } = body;
  if (scope === 'SOCIEDAD') {
    if (!sociedadCodigo || !socs.has(sociedadCodigo)) return 'Falta una Sociedad válida';
  } else if (scope === 'OPERACION') {
    if (!operacionCodigo || !ops.has(operacionCodigo)) return 'Falta una Operación válida';
  } else if (scope !== 'TODAS') {
    return 'scope debe ser TODAS, SOCIEDAD u OPERACION';
  }
  return null;
}

function validarReglaVencimiento(regla = {}) {
  if (regla.tipo === 'FECHA_FIJA') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(regla.fecha || '')) return 'Falta una fecha fija válida (YYYY-MM-DD)';
  } else if (regla.tipo === 'DIA_HABIL') {
    if (!Number.isInteger(regla.diaHabil) || regla.diaHabil < 1) return 'diaHabil debe ser un entero ≥ 1';
  } else {
    return 'reglaVencimiento.tipo debe ser FECHA_FIJA o DIA_HABIL';
  }
  return null;
}

// Una asignación (scope/sociedadCodigo/operacionCodigo) ¿cubre esta instancia
// (nivelAsignacion/sociedadCodigo/operacionCodigo)? operacionASociedad resuelve la
// sociedad de una operación para comparar a través de niveles distintos.
function asignacionCubreInstancia(asig, instancia, operacionASociedad) {
  if (asig.scope === 'TODAS') return true;
  if (asig.scope === 'SOCIEDAD') {
    if (instancia.nivelAsignacion === 'SOCIEDAD') return instancia.sociedadCodigo === asig.sociedadCodigo;
    return operacionASociedad[instancia.operacionCodigo] === asig.sociedadCodigo;
  }
  if (asig.scope === 'OPERACION') {
    if (instancia.nivelAsignacion === 'OPERACION') return instancia.operacionCodigo === asig.operacionCodigo;
    return operacionASociedad[asig.operacionCodigo] === instancia.sociedadCodigo;
  }
  return false;
}

async function esResponsableDe(usuarioId, actividadOrigenId, instancia, operacionASociedad) {
  const asignaciones = await AsignacionResponsable.find({ usuarioId, actividadId: actividadOrigenId }).lean();
  return asignaciones.some(a => asignacionCubreInstancia(a, instancia, operacionASociedad));
}

// Usuarios responsables de una instancia puntual (para mostrar en el tablero/detalle y
// para que el frontend decida qué botones de acción mostrar, sin duplicar la validación
// de permisos que igualmente hace el backend en /cumplir, /reabrir y /adjuntos).
async function responsablesDeInstancia(instancia, operacionASociedad) {
  const asignaciones = await AsignacionResponsable.find({ actividadId: instancia.actividadOrigenId }).lean();
  const cubren = asignaciones.filter(a => asignacionCubreInstancia(a, instancia, operacionASociedad));
  const usuarios = await User.find({ id: { $in: cubren.map(a => a.usuarioId) } }).select('id username').lean();
  const nombreUsuario = Object.fromEntries(usuarios.map(u => [u.id, u.username]));
  return cubren.map(a => ({ usuarioId: a.usuarioId, nombre: nombreUsuario[a.usuarioId] || a.usuarioId }));
}

// ─── Procesos (catálogo simple) ───────────────────────────────────────────────
router.get('/procesos', async (req, res) => {
  try { res.json(await Proceso.find().sort({ codigo: 1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/procesos', adminOnly, async (req, res) => {
  try {
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Faltan código o nombre' });
    if (await Proceso.findOne({ codigo: codigo.trim() })) return res.status(400).json({ error: 'Ya existe un proceso con ese código' });
    res.json(await Proceso.create({ codigo: codigo.trim(), nombre: nombre.trim() }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/procesos/:id', adminOnly, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
    const p = await Proceso.findByIdAndUpdate(req.params.id, { nombre: nombre.trim() }, { new: true });
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/procesos/:id', adminOnly, async (req, res) => {
  try {
    const p = await Proceso.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    const enUso = await Actividad.countDocuments({ procesoCodigo: p.codigo });
    if (enUso) return res.status(400).json({ error: `${enUso} actividad(es) usan este proceso` });
    await p.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Actividades (plantilla del mes vigente) ─────────────────────────────────
router.get('/actividades', async (req, res) => {
  try {
    const filtro = {};
    if (req.query.soloActivas !== 'false') filtro.activa = true;
    res.json(await Actividad.find(filtro).sort({ procesoCodigo: 1, nombre: 1 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/actividades', adminOnly, async (req, res) => {
  try {
    const { nombre, descripcion, procesoCodigo, reglaVencimiento, horaLimite, requiereAdjunto } = req.body;
    if (!nombre || !procesoCodigo) return res.status(400).json({ error: 'Faltan nombre o proceso' });
    if (!(await Proceso.findOne({ codigo: procesoCodigo }))) return res.status(400).json({ error: 'Proceso inválido' });
    const { ops, socs } = await codigosValidos();
    const errAlcance = validarAlcance(req.body, ops, socs);
    if (errAlcance) return res.status(400).json({ error: errAlcance });
    const errRegla = validarReglaVencimiento(reglaVencimiento);
    if (errRegla) return res.status(400).json({ error: errRegla });

    const actividad = await Actividad.create({
      id: uuidv4(), nombre: nombre.trim(), descripcion: descripcion || '', procesoCodigo,
      nivelAsignacion: req.body.nivelAsignacion,
      sociedadCodigo: req.body.nivelAsignacion === 'SOCIEDAD' ? req.body.sociedadCodigo : '',
      operacionCodigo: req.body.nivelAsignacion === 'OPERACION' ? req.body.operacionCodigo : '',
      reglaVencimiento, horaLimite: horaLimite || '18:00', requiereAdjunto: !!requiereAdjunto,
    });
    res.json(actividad);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/actividades/:id', adminOnly, async (req, res) => {
  try {
    const actividad = await Actividad.findOne({ id: req.params.id });
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });

    const update = {};
    if (req.body.nombre !== undefined) update.nombre = req.body.nombre.trim();
    if (req.body.descripcion !== undefined) update.descripcion = req.body.descripcion;
    if (req.body.horaLimite !== undefined) update.horaLimite = req.body.horaLimite;
    if (req.body.requiereAdjunto !== undefined) update.requiereAdjunto = !!req.body.requiereAdjunto;
    if (req.body.activa !== undefined) update.activa = !!req.body.activa;

    if (req.body.procesoCodigo !== undefined) {
      if (!(await Proceso.findOne({ codigo: req.body.procesoCodigo }))) return res.status(400).json({ error: 'Proceso inválido' });
      update.procesoCodigo = req.body.procesoCodigo;
    }
    if (req.body.nivelAsignacion !== undefined || req.body.sociedadCodigo !== undefined || req.body.operacionCodigo !== undefined) {
      const { ops, socs } = await codigosValidos();
      const merged = { ...actividad.toObject(), ...req.body };
      const errAlcance = validarAlcance(merged, ops, socs);
      if (errAlcance) return res.status(400).json({ error: errAlcance });
      update.nivelAsignacion = merged.nivelAsignacion;
      update.sociedadCodigo = merged.nivelAsignacion === 'SOCIEDAD' ? merged.sociedadCodigo : '';
      update.operacionCodigo = merged.nivelAsignacion === 'OPERACION' ? merged.operacionCodigo : '';
    }
    if (req.body.reglaVencimiento !== undefined) {
      const errRegla = validarReglaVencimiento(req.body.reglaVencimiento);
      if (errRegla) return res.status(400).json({ error: errRegla });
      update.reglaVencimiento = req.body.reglaVencimiento;
    }

    res.json(await Actividad.findOneAndUpdate({ id: req.params.id }, update, { new: true }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Soft-delete: nunca se borra físicamente para no dejar huérfanas las ActividadCierre
// (AsignacionResponsable) históricas que la referencian por id.
router.delete('/actividades/:id', adminOnly, async (req, res) => {
  try {
    const actividad = await Actividad.findOneAndUpdate({ id: req.params.id }, { activa: false }, { new: true });
    if (!actividad) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Días no laborables ───────────────────────────────────────────────────────
router.get('/dias-no-laborables', async (req, res) => {
  try { res.json(await DiaNoLaborable.find().sort({ fecha: 1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/dias-no-laborables', adminOnly, async (req, res) => {
  try {
    const { fecha, descripcion } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
    if (await DiaNoLaborable.findOne({ fecha })) return res.status(400).json({ error: 'Ya existe un registro para esa fecha' });
    res.json(await DiaNoLaborable.create({ fecha, descripcion: descripcion || '', origen: 'ADICIONAL' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/dias-no-laborables/:id', adminOnly, async (req, res) => {
  try {
    const d = await DiaNoLaborable.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });
    if (d.origen === 'FERIADO_OFICIAL') return res.status(400).json({ error: 'Los feriados oficiales no se eliminan a mano — se resincronizan' });
    await d.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sincroniza feriados oficiales de Perú desde la API pública de Nager.Date.
router.post('/dias-no-laborables/sincronizar-feriados', adminOnly, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();
    const resp = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${anio}/PE`);
    if (!resp.ok) return res.status(502).json({ error: `Nager.Date respondió ${resp.status}` });
    const feriados = await resp.json();
    let n = 0;
    for (const f of feriados) {
      await DiaNoLaborable.findOneAndUpdate(
        { fecha: f.date },
        { fecha: f.date, descripcion: f.localName || f.name, origen: 'FERIADO_OFICIAL' },
        { upsert: true }
      );
      n++;
    }
    res.json({ ok: true, anio, sincronizados: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Cierres mensuales (generación y congelado) ──────────────────────────────
router.get('/cierres', async (req, res) => {
  try { res.json(await CierreMensual.find().sort({ periodo: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cierres/generar', adminOnly, async (req, res) => {
  try {
    const { periodo } = req.body;
    if (!/^\d{4}-\d{2}$/.test(periodo || '')) return res.status(400).json({ error: 'periodo inválido (YYYY-MM)' });
    if (await CierreMensual.findOne({ periodo })) return res.status(400).json({ error: `Ya existe un cierre generado para ${periodo}` });

    const actividades = await Actividad.find({ activa: true }).lean();
    const diasHabiles = await fechaLima.diasHabilesDelMes(periodo);

    const cierre = await CierreMensual.create({
      id: uuidv4(), periodo,
      fechaGeneracion: fechaLima.ahoraLimaISO(),
      generadoPorId: req.user.id, generadoPorNombre: req.user.username,
    });

    const ahora = fechaLima.ahoraLimaISO();
    const instancias = actividades.map(a => {
      let fechaLimiteInstancia;
      if (a.reglaVencimiento.tipo === 'FECHA_FIJA') {
        fechaLimiteInstancia = a.reglaVencimiento.fecha;
      } else {
        const idx = a.reglaVencimiento.diaHabil - 1;
        if (!diasHabiles[idx]) throw new Error(`"${a.nombre}": ${periodo} no tiene ${a.reglaVencimiento.diaHabil} días hábiles`);
        fechaLimiteInstancia = diasHabiles[idx];
      }
      return {
        id: uuidv4(), cierreId: cierre.id, actividadOrigenId: a.id,
        nombre: a.nombre, procesoCodigo: a.procesoCodigo, nivelAsignacion: a.nivelAsignacion,
        sociedadCodigo: a.sociedadCodigo, operacionCodigo: a.operacionCodigo,
        fechaLimite: fechaLimiteInstancia, horaLimite: a.horaLimite,
        requiereAdjunto: a.requiereAdjunto,
        estado: 'PENDIENTE', fechaHoraCumplimiento: null, cumplidoPorId: null, cumplidoPorNombre: null,
        createdAt: ahora, updatedAt: ahora,
      };
    });
    if (instancias.length) await ActividadCierre.insertMany(instancias);

    res.json({ cierre, actividadesGeneradas: instancias.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Actividades del cierre (tablero) ────────────────────────────────────────
router.get('/actividades-cierre', async (req, res) => {
  try {
    let periodo = req.query.periodo;
    if (!periodo) {
      const ultimo = await CierreMensual.findOne().sort({ periodo: -1 }).lean();
      if (!ultimo) return res.json([]);
      periodo = ultimo.periodo;
    }
    const filtro = { cierreId: (await CierreMensual.findOne({ periodo }).lean())?.id || '__ninguno__' };
    if (req.query.sociedad) filtro.sociedadCodigo = req.query.sociedad;
    if (req.query.operacion) filtro.operacionCodigo = req.query.operacion;
    if (req.query.proceso) filtro.procesoCodigo = req.query.proceso;

    let instancias = await ActividadCierre.find(filtro).lean();
    const operacionASociedad = await mapaOperacionASociedad();

    // Scoping por usuario (ADMIN ve todo).
    if (req.user.role !== 'ADMIN') {
      const [responsables, consultas] = await Promise.all([
        AsignacionResponsable.find({ usuarioId: req.user.id }).lean(),
        AsignacionConsulta.find({ usuarioId: req.user.id }).lean(),
      ]);
      instancias = instancias.filter(inst =>
        responsables.some(a => a.actividadId === inst.actividadOrigenId && asignacionCubreInstancia(a, inst, operacionASociedad)) ||
        consultas.some(a => asignacionCubreInstancia(a, inst, operacionASociedad))
      );
    }

    // Responsables por actividad (para columna/filtro "Responsable") + estado derivado.
    const actividadOrigenIds = [...new Set(instancias.map(i => i.actividadOrigenId))];
    const todasAsignaciones = await AsignacionResponsable.find({ actividadId: { $in: actividadOrigenIds } }).lean();
    const usuarioIds = [...new Set(todasAsignaciones.map(a => a.usuarioId))];
    const usuarios = await User.find({ id: { $in: usuarioIds } }).select('id username').lean();
    const nombreUsuario = Object.fromEntries(usuarios.map(u => [u.id, u.username]));

    let resultado = instancias.map(inst => {
      const responsablesInst = todasAsignaciones
        .filter(a => a.actividadId === inst.actividadOrigenId && asignacionCubreInstancia(a, inst, operacionASociedad))
        .map(a => ({ usuarioId: a.usuarioId, nombre: nombreUsuario[a.usuarioId] || a.usuarioId }));
      return { ...inst, estado: fechaLima.estadoDerivado(inst), responsables: responsablesInst };
    });

    if (req.query.responsable) resultado = resultado.filter(i => i.responsables.some(r => r.usuarioId === req.query.responsable));
    if (req.query.estado) resultado = resultado.filter(i => i.estado === req.query.estado);

    res.json(resultado);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/actividades-cierre/:id', async (req, res) => {
  try {
    const inst = await ActividadCierre.findOne({ id: req.params.id }).lean();
    if (!inst) return res.status(404).json({ error: 'No encontrada' });
    const [adjuntos, operacionASociedad] = await Promise.all([
      Adjunto.find({ actividadCierreId: inst.id }).sort({ uploadedAt: 1 }),
      mapaOperacionASociedad(),
    ]);
    const responsables = await responsablesDeInstancia(inst, operacionASociedad);
    res.json({ ...inst, estado: fechaLima.estadoDerivado(inst), adjuntos, responsables });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/actividades-cierre/:id/cumplir', async (req, res) => {
  try {
    const inst = await ActividadCierre.findOne({ id: req.params.id });
    if (!inst) return res.status(404).json({ error: 'No encontrada' });
    if (inst.estado === 'CUMPLIDA') return res.status(400).json({ error: 'Ya fue marcada como cumplida' });

    if (req.user.role !== 'ADMIN') {
      const operacionASociedad = await mapaOperacionASociedad();
      const puede = await esResponsableDe(req.user.id, inst.actividadOrigenId, inst, operacionASociedad);
      if (!puede) return res.status(403).json({ error: 'No eres responsable de esta actividad' });
    }
    if (inst.requiereAdjunto) {
      const hayAdjunto = await Adjunto.findOne({ actividadCierreId: inst.id }).lean();
      if (!hayAdjunto) return res.status(400).json({ error: 'Esta actividad requiere un adjunto antes de marcarla como cumplida' });
    }

    inst.estado = 'CUMPLIDA';
    inst.fechaHoraCumplimiento = fechaLima.ahoraLimaISO();
    inst.cumplidoPorId = req.user.id;
    inst.cumplidoPorNombre = req.user.username;
    inst.updatedAt = fechaLima.ahoraLimaISO();
    await inst.save();
    res.json({ ...inst.toObject(), estado: fechaLima.estadoDerivado(inst) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/actividades-cierre/:id/reabrir', adminOnly, async (req, res) => {
  try {
    const inst = await ActividadCierre.findOne({ id: req.params.id });
    if (!inst) return res.status(404).json({ error: 'No encontrada' });
    if (inst.estado !== 'CUMPLIDA') return res.status(400).json({ error: 'Solo se puede reabrir una actividad cumplida' });

    inst.estado = 'REABIERTA';
    inst.updatedAt = fechaLima.ahoraLimaISO();
    await inst.save();

    const operacionASociedad = await mapaOperacionASociedad();
    const responsables = (await AsignacionResponsable.find({ actividadId: inst.actividadOrigenId }).lean())
      .filter(a => asignacionCubreInstancia(a, inst, operacionASociedad));
    for (const r of responsables) {
      const payload = { title: '🔓 Actividad reabierta', body: `"${inst.nombre}" fue reabierta y debe cumplirse de nuevo`, url: '/#cierreContable' };
      sendPush({ userId: r.usuarioId }, payload);
      sendEmail({ userId: r.usuarioId }, { subject: `🔓 Actividad reabierta — ${inst.nombre}`, body: `<p>La actividad <strong>${inst.nombre}</strong> (${inst.fechaLimite} ${inst.horaLimite}) fue reabierta por un administrador y debe cumplirse nuevamente.</p>` });
    }

    res.json({ ...inst.toObject(), estado: fechaLima.estadoDerivado(inst) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/actividades-cierre/:id/adjuntos', uploadMemory.single('file'), async (req, res) => {
  try {
    const inst = await ActividadCierre.findOne({ id: req.params.id });
    if (!inst) return res.status(404).json({ error: 'No encontrada' });
    if (inst.estado === 'CUMPLIDA') return res.status(400).json({ error: 'La actividad ya está cumplida — reábrela para subir un nuevo adjunto' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    if (req.user.role !== 'ADMIN') {
      const operacionASociedad = await mapaOperacionASociedad();
      const puede = await esResponsableDe(req.user.id, inst.actividadOrigenId, inst, operacionASociedad);
      if (!puede) return res.status(403).json({ error: 'No eres responsable de esta actividad' });
    }

    const cierre = await CierreMensual.findOne({ id: inst.cierreId }).lean();
    const subido = await boxClient.subirArchivo({
      buffer: req.file.buffer, nombreOriginal: req.file.originalname,
      periodo: cierre?.periodo || inst.cierreId, sociedadCodigo: inst.sociedadCodigo,
      operacionCodigo: inst.operacionCodigo, actividadNombre: inst.nombre,
    });

    const adjunto = await Adjunto.create({
      id: uuidv4(), actividadCierreId: inst.id,
      boxFileId: subido.boxFileId, boxFileName: subido.boxFileName, rutaBox: subido.rutaBox,
      uploadedAt: fechaLima.ahoraLimaISO(), uploadedById: req.user.id, uploadedByNombre: req.user.username,
    });
    res.json({ ...adjunto.toObject(), sharedLink: subido.sharedLink });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Asignaciones de responsables ─────────────────────────────────────────────
router.get('/responsables', adminOnly, async (req, res) => {
  try {
    const filtro = {};
    if (req.query.actividadId) filtro.actividadId = req.query.actividadId;
    if (req.query.usuarioId) filtro.usuarioId = req.query.usuarioId;
    res.json(await AsignacionResponsable.find(filtro));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/responsables', adminOnly, async (req, res) => {
  try {
    const { usuarioId, actividadId } = req.body;
    const [usuario, actividad] = await Promise.all([
      User.findOne({ id: usuarioId }).lean(),
      Actividad.findOne({ id: actividadId }).lean(),
    ]);
    if (!usuario) return res.status(400).json({ error: 'Usuario inválido' });
    if (!actividad) return res.status(400).json({ error: 'Actividad inválida' });
    const { ops, socs } = await codigosValidos();
    const errScope = validarScope(req.body, ops, socs);
    if (errScope) return res.status(400).json({ error: errScope });

    const asignacion = await AsignacionResponsable.create({
      id: uuidv4(), usuarioId, actividadId, scope: req.body.scope,
      sociedadCodigo: req.body.scope === 'SOCIEDAD' ? req.body.sociedadCodigo : '',
      operacionCodigo: req.body.scope === 'OPERACION' ? req.body.operacionCodigo : '',
    });

    const payload = { title: '📌 Nueva actividad asignada', body: `Se te asignó "${actividad.nombre}"`, url: '/#cierreContable' };
    sendPush({ userId: usuarioId }, payload);
    sendEmail({ userId: usuarioId }, { subject: `📌 Nueva actividad asignada — ${actividad.nombre}`, body: `<p>Se te asignó la actividad <strong>${actividad.nombre}</strong> del cierre contable.</p>` });

    res.json(asignacion);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/responsables/:id', adminOnly, async (req, res) => {
  try {
    const r = await AsignacionResponsable.findOneAndDelete({ id: req.params.id });
    if (!r) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Asignaciones de consulta (solo lectura) ─────────────────────────────────
router.get('/consultas', adminOnly, async (req, res) => {
  try { res.json(await AsignacionConsulta.find()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/consultas', adminOnly, async (req, res) => {
  try {
    const { usuarioId } = req.body;
    if (!(await User.findOne({ id: usuarioId }))) return res.status(400).json({ error: 'Usuario inválido' });
    const { ops, socs } = await codigosValidos();
    const errScope = validarScope(req.body, ops, socs);
    if (errScope) return res.status(400).json({ error: errScope });
    res.json(await AsignacionConsulta.create({
      id: uuidv4(), usuarioId, scope: req.body.scope,
      sociedadCodigo: req.body.scope === 'SOCIEDAD' ? req.body.sociedadCodigo : '',
      operacionCodigo: req.body.scope === 'OPERACION' ? req.body.operacionCodigo : '',
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/consultas/:id', adminOnly, async (req, res) => {
  try {
    const c = await AsignacionConsulta.findOneAndDelete({ id: req.params.id });
    if (!c) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Acceso del usuario actual (para mostrar/ocultar el nav item) ────────────
router.get('/mi-acceso', async (req, res) => {
  try {
    if (req.user.role === 'ADMIN') return res.json({ esAdmin: true, esResponsable: true, esConsulta: true });
    const [esResponsable, esConsulta] = await Promise.all([
      AsignacionResponsable.exists({ usuarioId: req.user.id }),
      AsignacionConsulta.exists({ usuarioId: req.user.id }),
    ]);
    res.json({ esAdmin: false, esResponsable: !!esResponsable, esConsulta: !!esConsulta });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth');
const KpiArea        = require('../models/KpiArea');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const KpiRegistro    = require('../models/KpiRegistro');
const Config         = require('../models/Config');
const box            = require('../utils/boxClient');
const Sociedad       = require('../models/Sociedad');
const Operacion      = require('../models/Operacion');
const User           = require('../models/User');
const { resolverAcceso, requiereAcceso, soloAdmin } = require('../utils/kpiAcceso');
const { validarMeta, REGLAS_RESUMEN } = require('../utils/kpiSemaforo');
const { metaVigente, versionesPorKpi } = require('../utils/kpiMetas');
const { hoyLima } = require('../utils/kpiPeriodo');
const { construirTablero, pendientesDeCaptura, historico } = require('../utils/kpiTablero');
const { generarExcel } = require('../utils/kpiExcel');
const { ejecutarDiario } = require('../utils/kpiNotificaciones');

// Indicadores de Gestión del Back Office (GAF). Montado en /api/kpis.
// Todo acceso a datos pasa por req.kpi (utils/kpiAcceso.js), resuelto en vivo.
const router = express.Router();
router.use(authMiddleware);

// GET /mi-acceso — no exige acceso (el frontend lo usa para decidir si muestra el menú).
router.get('/mi-acceso', async (req, res) => {
  try {
    const acc = await resolverAcceso(req.user.id);
    if (!acc || (!acc.esAdmin && acc.lectura.size === 0)) return res.json({ acceso: false });
    const areas = await KpiArea.find({ codigo: { $in: [...acc.lectura] } }).sort({ orden: 1 }).lean();
    res.json({
      acceso: true,
      esAdmin: acc.esAdmin,
      esLector: acc.esLector,
      areas: areas.map(a => ({
        codigo: a.codigo, nombre: a.nombre,
        nivel: acc.captura.has(a.codigo) ? 'CAPTURA' : 'LECTURA',
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(requiereAcceso);

// ─── Áreas ────────────────────────────────────────────────────────
// ADMIN ve todas (incluidas inactivas, para poder reactivarlas); el resto solo las suyas.
router.get('/areas', async (req, res) => {
  try {
    const filtro = req.kpi.esAdmin ? {} : { codigo: { $in: [...req.kpi.lectura] } };
    res.json(await KpiArea.find(filtro).sort({ orden: 1, codigo: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/areas', soloAdmin, async (req, res) => {
  try {
    const { codigo, nombre, orden } = req.body;
    if (!codigo?.trim() || !nombre?.trim()) return res.status(400).json({ error: 'Código y nombre son obligatorios' });
    if (await KpiArea.exists({ codigo: codigo.trim().toUpperCase() })) return res.status(400).json({ error: 'Ya existe un área con ese código' });
    const area = await KpiArea.create({ codigo, nombre, orden: Number(orden) || 0 });
    res.json(area);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// El código no se edita (lo referencian usuarios y KPIs). Sin DELETE: solo se desactiva.
router.put('/areas/:codigo', soloAdmin, async (req, res) => {
  try {
    const { nombre, orden, activo } = req.body;
    const update = {
      ...(nombre !== undefined && { nombre: String(nombre).trim() }),
      ...(orden  !== undefined && { orden: Number(orden) || 0 }),
      ...(activo !== undefined && { activo: !!activo }),
    };
    if (update.nombre === '') return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    const area = await KpiArea.findOneAndUpdate({ codigo: req.params.codigo }, update, { returnDocument: 'after' });
    if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    res.json(area);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Catálogo de KPIs ─────────────────────────────────────────────
const CAMPOS_META = ['meta', 'umbralAmbar', 'rangoMin', 'rangoMax', 'tolerancia'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const numONull = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

// Normaliza y valida los campos editables de un KPI. `actual` = documento existente (PUT),
// para validar combinaciones (ej. nivelAmbito + unidades) aunque solo venga uno de los dos.
async function validarDefinicion(body, actual = null) {
  const d = {};
  const texto = (k) => { if (body[k] !== undefined) d[k] = String(body[k] ?? '').trim(); };
  ['nombre', 'descripcion', 'formula', 'fuente'].forEach(texto);
  for (const k of ['unidad', 'frecuencia', 'tipoCaptura', 'sentido', 'nivelAmbito', 'areaCodigo']) {
    if (body[k] !== undefined) d[k] = body[k];
  }
  if (body.plazoCapturaDias !== undefined) d.plazoCapturaDias = Number(body.plazoCapturaDias);
  if (body.activo !== undefined) d.activo = !!body.activo;
  if (body.unidades !== undefined) d.unidades = Array.isArray(body.unidades) ? [...new Set(body.unidades.map(String))] : [];
  if (body.responsables !== undefined) d.responsables = Array.isArray(body.responsables) ? [...new Set(body.responsables.map(String))] : [];

  const f = { ...(actual?.toObject?.() || actual || {}), ...d }; // estado final
  if (!f.nombre) return { error: 'El nombre es obligatorio' };
  if (!(await KpiArea.exists({ codigo: f.areaCodigo }))) return { error: 'Área inválida' };
  const enums = { unidad: 'UNIDADES', frecuencia: 'FRECUENCIAS', tipoCaptura: 'TIPOS_CAPTURA', sentido: 'SENTIDOS', nivelAmbito: 'NIVELES_AMBITO' };
  for (const [campo, lista] of Object.entries(enums)) {
    if (!KpiDefinicion[lista].includes(f[campo])) return { error: `Valor inválido para ${campo}` };
  }
  if (!Number.isInteger(f.plazoCapturaDias) || f.plazoCapturaDias < 0 || f.plazoCapturaDias > 60) {
    return { error: 'El plazo de captura debe ser un número entero de días entre 0 y 60' };
  }
  const Catalogo = f.nivelAmbito === 'OPERACION' ? Operacion : Sociedad;
  const validas = new Set(await Catalogo.distinct('codigo'));
  const invalidas = (f.unidades || []).filter(u => !validas.has(u));
  if (invalidas.length) return { error: `Unidades inexistentes para el nivel ${f.nivelAmbito}: ${invalidas.join(', ')}` };
  if (f.responsables?.length) {
    const existentes = await User.countDocuments({ id: { $in: f.responsables }, activo: { $ne: false } });
    if (existentes !== f.responsables.length) return { error: 'Algún responsable no existe o está desactivado' };
  }
  return { datos: d };
}

// Campos de meta de un body, validados según el sentido del KPI.
function leerMeta(body, sentido) {
  const m = {};
  for (const k of CAMPOS_META) m[k] = numONull(body[k]);
  if (sentido === 'RANGO') { m.meta = null; m.umbralAmbar = null; }
  else { m.rangoMin = null; m.rangoMax = null; m.tolerancia = null; }
  const error = validarMeta(sentido, m);
  return error ? { error } : { meta: m };
}

const hayMeta = (m) => CAMPOS_META.some(k => m[k] !== null);

// Busca un KPI visible para el usuario. Un KPI de un área no asignada responde 404 (no 403)
// para no revelar ni siquiera que existe.
async function kpiVisible(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'KPI no encontrado' }); return null; }
  const kpi = await KpiDefinicion.findById(req.params.id);
  if (!kpi || !req.kpi.puedeVer(kpi.areaCodigo) || (!kpi.activo && !req.kpi.esAdmin)) {
    res.status(404).json({ error: 'KPI no encontrado' });
    return null;
  }
  return kpi;
}

// GET /definiciones?area=&inactivos=1 — solo áreas visibles; los inactivos solo para admin.
router.get('/definiciones', async (req, res) => {
  try {
    const filtro = { ...req.kpi.filtroAreas() };
    if (req.query.area) {
      if (!req.kpi.puedeVer(req.query.area)) return res.json([]);
      filtro.areaCodigo = req.query.area;
    }
    if (!(req.kpi.esAdmin && req.query.inactivos === '1')) filtro.activo = true;
    const kpis = await KpiDefinicion.find(filtro).sort({ areaCodigo: 1, codigo: 1 }).lean();
    const versiones = await versionesPorKpi(kpis.map(k => k._id));
    const hoy = hoyLima();
    res.json(kpis.map(k => {
      const vs = versiones.get(String(k._id)) || [];
      return {
        ...k,
        metaVigente: metaVigente(vs, '', hoy),
        metasPorUnidad: [...new Set(vs.filter(v => v.unidadCodigo).map(v => v.unidadCodigo))],
      };
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/definiciones/:id', async (req, res) => {
  try {
    const kpi = await kpiVisible(req, res);
    if (!kpi) return;
    const versiones = await KpiMetaVersion.find({ kpiId: kpi._id }).sort({ vigenteDesde: -1, creadoEn: -1 }).lean();
    res.json({ ...kpi.toObject(), versiones, metaVigente: metaVigente(versiones, '', hoyLima()) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /definiciones — crea el KPI y, si viene, su primera versión de meta.
router.post('/definiciones', soloAdmin, async (req, res) => {
  try {
    const codigo = String(req.body.codigo || '').trim().toUpperCase();
    if (!codigo) return res.status(400).json({ error: 'El código es obligatorio' });
    if (await KpiDefinicion.exists({ codigo })) return res.status(400).json({ error: 'Ya existe un KPI con ese código' });
    const base = { unidad: '%', frecuencia: 'MENSUAL', tipoCaptura: 'DIRECTO', nivelAmbito: 'SOCIEDAD', plazoCapturaDias: 8, unidades: [], responsables: [] };
    const { error, datos } = await validarDefinicion({ ...base, ...req.body });
    if (error) return res.status(400).json({ error });

    const lm = leerMeta(req.body, datos.sentido);
    if (lm.error) return res.status(400).json({ error: lm.error });
    const vigenteDesde = req.body.vigenteDesde || `${hoyLima().slice(0, 7)}-01`;
    if (hayMeta(lm.meta) && !RE_FECHA.test(vigenteDesde)) return res.status(400).json({ error: 'Fecha de vigencia inválida' });

    const kpi = await KpiDefinicion.create({ ...datos, codigo, creadoPor: req.kpi.username });
    if (hayMeta(lm.meta)) {
      await KpiMetaVersion.create({ kpiId: kpi._id, vigenteDesde, ...lm.meta, motivo: 'Meta inicial', creadoPor: req.kpi.username });
    }
    res.json(kpi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /definiciones/:id — todo menos el código y las metas (que se versionan aparte).
// Sin DELETE: un KPI se desactiva con { activo: false }.
router.put('/definiciones/:id', soloAdmin, async (req, res) => {
  try {
    const kpi = await kpiVisible(req, res);
    if (!kpi) return;
    const { codigo, ...resto } = req.body;
    if (codigo !== undefined && String(codigo).trim().toUpperCase() !== kpi.codigo) {
      return res.status(400).json({ error: 'El código de un KPI no se puede cambiar' });
    }
    // Las versiones de meta se interpretan según el sentido: cambiarlo las dejaría sin sentido.
    if (resto.sentido !== undefined && resto.sentido !== kpi.sentido) {
      return res.status(400).json({ error: 'El sentido de un KPI no se puede cambiar: cree un KPI nuevo' });
    }
    // Con registros, cambiar frecuencia/unidad/área mezclaría historiales incomparables.
    const fijos = { frecuencia: 'la frecuencia', unidad: 'la unidad de medida', areaCodigo: 'el área' };
    const cambia = Object.keys(fijos).find(k => resto[k] !== undefined && resto[k] !== kpi[k]);
    if (cambia && await KpiRegistro.exists({ kpiId: kpi._id })) {
      return res.status(400).json({ error: `El KPI ya tiene registros: no se puede cambiar ${fijos[cambia]}. Cree un KPI nuevo y desactive este.` });
    }
    const { error, datos } = await validarDefinicion(resto, kpi);
    if (error) return res.status(400).json({ error });
    Object.assign(kpi, datos);
    await kpi.save();
    res.json(kpi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /definiciones/:id/metas — nueva versión de meta/umbrales (nunca se edita una existente).
router.post('/definiciones/:id/metas', soloAdmin, async (req, res) => {
  try {
    const kpi = await kpiVisible(req, res);
    if (!kpi) return;
    const { vigenteDesde, unidadCodigo = '', motivo } = req.body;
    if (!RE_FECHA.test(vigenteDesde || '')) return res.status(400).json({ error: 'Indique la fecha de vigencia (dd/mm/aaaa)' });
    if (!String(motivo || '').trim()) return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
    if (unidadCodigo && !kpi.unidades.includes(unidadCodigo)) {
      return res.status(400).json({ error: 'La unidad no pertenece al ámbito del KPI' });
    }
    const lm = leerMeta(req.body, kpi.sentido);
    if (lm.error) return res.status(400).json({ error: lm.error });
    const version = await KpiMetaVersion.create({
      kpiId: kpi._id, unidadCodigo, vigenteDesde, ...lm.meta,
      motivo: String(motivo).trim(), creadoPor: req.kpi.username,
    });
    res.json(version);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /responsables — usuarios activos elegibles como responsables de captura (admin).
router.get('/responsables', soloAdmin, async (req, res) => {
  try {
    const users = await User.find({ activo: { $ne: false } }, { id: 1, username: 1, email: 1, _id: 0 }).sort({ username: 1 }).lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Configuración del módulo (admin) ─────────────────────────────
// Llaves propias en el Config genérico. Las credenciales de Box son compartidas con el
// resto de la app: solo el ADMIN de la app las cambia, y el secreto nunca se devuelve.
const CFG_KPI = { kpiBoxCarpetaId: '', kpiReglaResumen: 'MAS_FRECUENTE_PISO_AMBAR', kpiDiasAviso: 3, kpiAlertaUsuarios: [] };
const CFG_BOX = ['boxClientId', 'boxClientSecret', 'boxEnterpriseId'];

router.get('/config', soloAdmin, async (req, res) => {
  try {
    const docs = await Config.find({ key: { $in: [...Object.keys(CFG_KPI), ...CFG_BOX] } }).lean();
    const v = Object.fromEntries(docs.map(d => [d.key, d.value]));
    res.json({
      ...Object.fromEntries(Object.entries(CFG_KPI).map(([k, def]) => [k, v[k] ?? def])),
      reglasResumen: REGLAS_RESUMEN,
      box: { clientId: v.boxClientId || '', enterpriseId: v.boxEnterpriseId || '', secretConfigurado: !!v.boxClientSecret },
      puedeEditarBox: req.user.role === 'ADMIN',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config', soloAdmin, async (req, res) => {
  try {
    const { kpiBoxCarpetaId, kpiReglaResumen, kpiDiasAviso, kpiAlertaUsuarios, box: cred } = req.body;
    if (kpiReglaResumen !== undefined && !REGLAS_RESUMEN.includes(kpiReglaResumen)) return res.status(400).json({ error: 'Regla de resumen inválida' });
    if (kpiBoxCarpetaId !== undefined && !/^\d*$/.test(String(kpiBoxCarpetaId).trim())) return res.status(400).json({ error: 'El ID de carpeta de Box es numérico' });
    if (kpiDiasAviso !== undefined && !(Number.isInteger(Number(kpiDiasAviso)) && kpiDiasAviso >= 0 && kpiDiasAviso <= 30)) {
      return res.status(400).json({ error: 'Los días de aviso previo van de 0 a 30' });
    }
    if (kpiAlertaUsuarios !== undefined && (!Array.isArray(kpiAlertaUsuarios)
      || await User.countDocuments({ id: { $in: kpiAlertaUsuarios } }) !== new Set(kpiAlertaUsuarios).size)) {
      return res.status(400).json({ error: 'Destinatarios de alertas inválidos' });
    }
    const cambios = {
      ...(kpiBoxCarpetaId !== undefined && { kpiBoxCarpetaId: String(kpiBoxCarpetaId).trim() }),
      ...(kpiReglaResumen !== undefined && { kpiReglaResumen }),
      ...(kpiDiasAviso !== undefined && { kpiDiasAviso: Number(kpiDiasAviso) }),
      ...(kpiAlertaUsuarios !== undefined && { kpiAlertaUsuarios: [...new Set(kpiAlertaUsuarios)] }),
    };
    if (cred) {
      if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo el administrador de la app cambia las credenciales de Box' });
      if (cred.clientId !== undefined) cambios.boxClientId = String(cred.clientId).trim();
      if (cred.enterpriseId !== undefined) cambios.boxEnterpriseId = String(cred.enterpriseId).trim();
      if (cred.clientSecret) cambios.boxClientSecret = String(cred.clientSecret).trim(); // vacío = no cambiar
    }
    for (const [key, value] of Object.entries(cambios)) {
      await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/config/probar-box', soloAdmin, async (req, res) => {
  try {
    const carpeta = (await Config.findOne({ key: 'kpiBoxCarpetaId' }).lean())?.value;
    if (!carpeta) return res.status(400).json({ error: 'Primero configure el ID de la carpeta de Box' });
    res.json(await box.probarConexion(carpeta));
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── Dashboard ────────────────────────────────────────────────────
// Todo se calcula en utils/kpiTablero.js, siempre acotado a las áreas visibles (req.kpi).
router.get('/dashboard', async (req, res) => {
  try {
    const { mes, area, unidad } = req.query;
    res.json(await construirTablero(req.kpi, { mes, area, unidad }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pendientes', async (req, res) => {
  try {
    const { area, unidad } = req.query;
    res.json(await pendientesDeCaptura(req.kpi, { area, unidad }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/definiciones/:id/historico', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'KPI no encontrado' });
    const h = await historico(req.kpi, req.params.id, { unidad: req.query.unidad, n: req.query.n });
    if (!h) return res.status(404).json({ error: 'KPI no encontrado' });
    res.json(h);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /exportar?mes=&area=&unidad= — Excel de lo que el usuario ve (mismo acceso por área).
router.get('/exportar', async (req, res) => {
  try {
    const { mes, area, unidad } = req.query;
    const { buffer, nombre } = await generarExcel(req.kpi, { mes, area, unidad, usuario: req.kpi.username });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.send(Buffer.from(buffer));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /notificaciones/ejecutar — corre ahora la tarea diaria (la misma de sync-master.bat).
router.post('/notificaciones/ejecutar', soloAdmin, async (req, res) => {
  try { res.json(await ejecutarDiario()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Captura, registros, auditoría y correcciones.
router.use(require('./kpiRegistros'));

module.exports = router;

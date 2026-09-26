const express  = require('express');
const multer   = require('multer');
const mongoose = require('mongoose');
const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const KpiRegistro    = require('../models/KpiRegistro');
const KpiAuditoria   = require('../models/KpiAuditoria');
const Config         = require('../models/Config');
const box = require('../utils/boxClient'); // se usa como objeto para que las pruebas lo reemplacen
const { soloAdmin } = require('../utils/kpiAcceso');
const { calcularSemaforo } = require('../utils/kpiSemaforo');
const { metaVigente, snapshot, versionesPorKpi } = require('../utils/kpiMetas');
const P = require('../utils/kpiPeriodo');

// Registro inmutable de valores de Indicadores GAF + auditoría. Se monta dentro de
// routes/kpis.js DESPUÉS de requiereAcceso, así que req.kpi siempre existe aquí.
// No hay PUT/PATCH/DELETE sobre /registros/:id: la única modificación posible es
// PUT /registros/:id/corregir, solo para el admin, con motivo y bitácora.
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(), // directo a Box, nunca pasa por data/
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
});
const conArchivos = (req, res, next) => upload.array('archivos', 5)(req, res, err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo puede pesar hasta 20 MB' : err.message });
  next();
});
// En multipart los datos llegan como JSON en el campo `datos`.
const leerDatos = (req) => (typeof req.body?.datos === 'string' ? JSON.parse(req.body.datos) : req.body || {});
const nombreArchivo = (f) => { try { return Buffer.from(f.originalname, 'latin1').toString('utf8'); } catch { return f.originalname; } };

const num = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));

// Resultado del KPI a partir de lo capturado. Devuelve { valor, numerador, denominador } o { error }.
function calcularResultado(tipoCaptura, unidad, d) {
  if (tipoCaptura === 'RATIO') {
    const n = num(d.numerador), den = num(d.denominador);
    if (!Number.isFinite(n) || !Number.isFinite(den)) return { error: 'Ingrese numerador y denominador numéricos' };
    if (den === 0) return { error: 'El denominador no puede ser cero' };
    return { valor: (n / den) * (unidad === '%' ? 100 : 1), numerador: n, denominador: den };
  }
  const v = num(d.valor);
  if (!Number.isFinite(v)) return { error: 'Ingrese un valor numérico' };
  return { valor: v, numerador: null, denominador: null };
}

// Validaciones comunes de captura (evaluar y guardar). Responde el error y devuelve null,
// o devuelve todo lo necesario para guardar.
async function prepararCaptura(req, res, d) {
  if (!mongoose.isValidObjectId(d.kpiId)) { res.status(404).json({ error: 'KPI no encontrado' }); return null; }
  const kpi = await KpiDefinicion.findById(d.kpiId).lean();
  if (!kpi || !kpi.activo || !req.kpi.puedeVer(kpi.areaCodigo)) { res.status(404).json({ error: 'KPI no encontrado' }); return null; }
  if (!req.kpi.puedeCapturar(kpi.areaCodigo)) { res.status(403).json({ error: 'No tiene permiso de captura en esta área' }); return null; }
  if (!kpi.unidades.includes(d.unidadCodigo)) { res.status(400).json({ error: 'La unidad no pertenece al ámbito del KPI' }); return null; }
  if (!P.esValido(d.periodo, kpi.frecuencia)) { res.status(400).json({ error: `Periodo inválido para un KPI ${kpi.frecuencia.toLowerCase()}` }); return null; }
  const { inicio } = P.rango(d.periodo);
  if (inicio > P.hoyLima()) { res.status(400).json({ error: 'No se puede registrar un periodo que aún no empieza' }); return null; }

  const r = calcularResultado(kpi.tipoCaptura, kpi.unidad, d);
  if (r.error) { res.status(400).json({ error: r.error }); return null; }

  const versiones = await KpiMetaVersion.find({ kpiId: kpi._id }).lean();
  const meta = snapshot(metaVigente(versiones, d.unidadCodigo, inicio));
  const semaforo = calcularSemaforo(r.valor, kpi.sentido, meta);
  const existe = await KpiRegistro.exists({ kpiId: kpi._id, periodo: d.periodo, unidadCodigo: d.unidadCodigo });
  return { kpi, ...r, meta, semaforo, existe: !!existe };
}

// Estado del registro que se compara en la auditoría.
const estado = (r) => ({ valor: r.valor, numerador: r.numerador, denominador: r.denominador, semaforo: r.semaforo, comentario: r.comentario });

async function auditar(registro, accion, req, { antes = null, despues = null, motivo = '' } = {}) {
  await KpiAuditoria.create({
    registroId: registro._id, kpiId: registro.kpiId, areaCodigo: registro.areaCodigo, accion,
    antes, despues, motivo, usuarioId: req.kpi.userId, usuarioNombre: req.kpi.username,
  });
}

async function subirAdjuntos(req, registroLike) {
  if (!req.files?.length) return [];
  const carpeta = (await Config.findOne({ key: 'kpiBoxCarpetaId' }).lean())?.value;
  const subidos = [];
  try {
    for (const f of req.files) {
      const nombreOriginal = nombreArchivo(f);
      const r = await box.subirArchivo({
        buffer: f.buffer, nombreOriginal, carpetaBaseId: carpeta,
        segmentos: [registroLike.areaCodigo, registroLike.kpiCodigo, registroLike.periodo, registroLike.unidadCodigo],
      });
      subidos.push({ boxFileId: r.boxFileId, nombre: r.nombre, nombreOriginal, tamano: f.size, tipo: f.mimetype, subidoPor: req.kpi.username });
    }
  } catch (err) {
    await descartarAdjuntos(subidos);
    throw err;
  }
  return subidos;
}

async function descartarAdjuntos(adjuntos) {
  for (const a of adjuntos) await box.eliminarArchivo(a.boxFileId).catch(() => {});
}

// ─── Captura ──────────────────────────────────────────────────────

// GET /captura/opciones — KPIs que el usuario puede registrar, con lo necesario para el form.
router.get('/captura/opciones', async (req, res) => {
  try {
    const kpis = await KpiDefinicion.find({
      activo: true, areaCodigo: { $in: [...req.kpi.captura] }, 'unidades.0': { $exists: true },
    }).sort({ areaCodigo: 1, codigo: 1 }).lean();
    const hoy = P.hoyLima();
    const versiones = await versionesPorKpi(kpis.map(k => k._id));
    res.json(kpis.map(k => {
      const actual = P.periodoDeFecha(hoy, k.frecuencia);
      return {
        _id: k._id, codigo: k.codigo, nombre: k.nombre, areaCodigo: k.areaCodigo, unidad: k.unidad,
        frecuencia: k.frecuencia, tipoCaptura: k.tipoCaptura, sentido: k.sentido, formula: k.formula,
        unidades: k.unidades, nivelAmbito: k.nivelAmbito,
        metaVigente: metaVigente(versiones.get(String(k._id)) || [], '', hoy),
        periodoSugerido: P.anterior(actual), // el último periodo cerrado
        // El periodo en curso y los 12 anteriores, del más reciente al más antiguo.
        periodos: P.ultimos(actual, 13).reverse().map(p => ({ periodo: p, etiqueta: P.etiqueta(p), ...P.rango(p) })),
      };
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /registros/evaluar — calcula resultado y semáforo SIN guardar (para la confirmación).
router.post('/registros/evaluar', async (req, res) => {
  try {
    const c = await prepararCaptura(req, res, req.body);
    if (!c) return;
    res.json({ valor: c.valor, semaforo: c.semaforo, meta: c.meta, existe: c.existe, comentarioObligatorio: c.semaforo === 'ROJO' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /registros — guarda un valor (multipart: `datos` JSON + `archivos` opcionales).
router.post('/registros', conArchivos, async (req, res) => {
  try {
    let d;
    try { d = leerDatos(req); } catch { return res.status(400).json({ error: 'Datos inválidos' }); }
    if (d.confirmado !== true) return res.status(400).json({ error: 'Falta confirmar que el valor no podrá modificarse' });
    const c = await prepararCaptura(req, res, d);
    if (!c) return;
    const comentario = String(d.comentario || '').trim().slice(0, 2000);
    if (c.semaforo === 'ROJO' && !comentario) return res.status(400).json({ error: 'El resultado queda en rojo: el comentario es obligatorio' });
    if (c.existe) return res.status(409).json({ error: 'Ya existe un registro para este KPI, periodo y unidad' });

    const base = {
      kpiId: c.kpi._id, kpiCodigo: c.kpi.codigo, areaCodigo: c.kpi.areaCodigo, unidadCodigo: d.unidadCodigo,
      periodo: d.periodo, periodoInicio: P.rango(d.periodo).inicio, frecuencia: c.kpi.frecuencia, tipoCaptura: c.kpi.tipoCaptura, unidad: c.kpi.unidad,
      sentido: c.kpi.sentido, valor: c.valor, numerador: c.numerador, denominador: c.denominador,
      meta: c.meta, semaforo: c.semaforo, comentario,
      registradoPor: req.kpi.userId, registradoPorNombre: req.kpi.username,
    };
    let adjuntos;
    try { adjuntos = await subirAdjuntos(req, base); }
    catch (err) { return res.status(502).json({ error: `No se guardó el registro: ${err.message}` }); }

    let registro;
    try {
      registro = await KpiRegistro.create({ ...base, adjuntos });
    } catch (err) {
      await descartarAdjuntos(adjuntos);
      if (err.code === 11000) return res.status(409).json({ error: 'Ya existe un registro para este KPI, periodo y unidad' });
      throw err;
    }
    await auditar(registro, 'CREACION', req, { despues: estado(registro) });
    res.json(registro);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Consulta ─────────────────────────────────────────────────────

// Un registro visible para el usuario (de otra área → 404, sin revelar que existe).
async function registroVisible(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'Registro no encontrado' }); return null; }
  const r = await KpiRegistro.findById(req.params.id);
  if (!r || !req.kpi.puedeVer(r.areaCodigo)) { res.status(404).json({ error: 'Registro no encontrado' }); return null; }
  return r;
}

// GET /registros?kpiId=&unidad=&area=&desde=&hasta= — siempre acotado a áreas visibles.
// desde/hasta: 'YYYY-MM' o 'YYYY-MM-DD', sobre el inicio del periodo.
router.get('/registros', async (req, res) => {
  try {
    const f = req.kpi.filtroAreas();
    if (req.query.area) {
      if (!req.kpi.puedeVer(req.query.area)) return res.json([]);
      f.areaCodigo = req.query.area;
    }
    if (req.query.kpiId) {
      if (!mongoose.isValidObjectId(req.query.kpiId)) return res.json([]);
      f.kpiId = req.query.kpiId;
    }
    if (req.query.unidad) f.unidadCodigo = req.query.unidad;
    const { desde, hasta } = req.query;
    if (desde || hasta) {
      f.periodoInicio = {
        ...(desde && { $gte: desde.length === 7 ? `${desde}-01` : desde }),
        ...(hasta && { $lte: hasta.length === 7 ? `${hasta}-31` : hasta }),
      };
    }
    const lim = Math.min(Number(req.query.limit) || 500, 2000);
    res.json(await KpiRegistro.find(f).sort({ periodoInicio: -1, kpiCodigo: 1, unidadCodigo: 1 }).limit(lim).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/registros/:id', async (req, res) => {
  try {
    const r = await registroVisible(req, res);
    if (!r) return;
    const auditoria = await KpiAuditoria.find({ registroId: r._id }).sort({ fechaHora: 1 }).lean();
    res.json({ ...r.toObject(), auditoria });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /registros/:id/adjuntos/:fileId — URL temporal de descarga, previa validación del área.
router.get('/registros/:id/adjuntos/:fileId', async (req, res) => {
  try {
    const r = await registroVisible(req, res);
    if (!r) return;
    if (!r.adjuntos.some(a => a.boxFileId === req.params.fileId)) return res.status(404).json({ error: 'Adjunto no encontrado' });
    res.json({ url: await box.urlDescarga(req.params.fileId) });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── Corrección (solo admin) ──────────────────────────────────────

// PUT /registros/:id/corregir — { valor | numerador+denominador, comentario?, motivo }.
// Recalcula el semáforo con la meta CONGELADA en el registro (la de su periodo), no la actual.
router.put('/registros/:id/corregir', soloAdmin, async (req, res) => {
  try {
    const r = await registroVisible(req, res);
    if (!r) return;
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) return res.status(400).json({ error: 'El motivo de la corrección es obligatorio' });

    const cambiaValor = ['valor', 'numerador', 'denominador'].some(k => req.body[k] !== undefined);
    const calc = cambiaValor ? calcularResultado(r.tipoCaptura, r.unidad, req.body) : { valor: r.valor, numerador: r.numerador, denominador: r.denominador };
    if (calc.error) return res.status(400).json({ error: calc.error });
    const comentario = req.body.comentario !== undefined ? String(req.body.comentario).trim().slice(0, 2000) : r.comentario;
    const semaforo = calcularSemaforo(calc.valor, r.sentido, r.meta);
    if (semaforo === 'ROJO' && !comentario) return res.status(400).json({ error: 'El resultado queda en rojo: el comentario es obligatorio' });

    const antes = estado(r);
    const despues = { valor: calc.valor, numerador: calc.numerador, denominador: calc.denominador, semaforo, comentario };
    if (JSON.stringify(antes) === JSON.stringify(despues)) return res.status(400).json({ error: 'La corrección no cambia nada' });

    Object.assign(r, despues, { corregido: true, nCorrecciones: r.nCorrecciones + 1 });
    r.$locals.correccionAutorizada = true;
    try { await r.save(); }
    catch (err) {
      if (err.name === 'VersionError') return res.status(409).json({ error: 'Otro usuario corrigió este registro al mismo tiempo; recargue e intente de nuevo' });
      throw err;
    }
    await auditar(r, 'CORRECCION', req, { antes, despues, motivo });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /registros/:id/adjuntos — el admin agrega evidencia a un registro ya guardado (con motivo).
router.post('/registros/:id/adjuntos', soloAdmin, conArchivos, async (req, res) => {
  try {
    const r = await registroVisible(req, res);
    if (!r) return;
    let d;
    try { d = leerDatos(req); } catch { return res.status(400).json({ error: 'Datos inválidos' }); }
    const motivo = String(d.motivo || '').trim();
    if (!motivo) return res.status(400).json({ error: 'El motivo es obligatorio' });
    if (!req.files?.length) return res.status(400).json({ error: 'Adjunte al menos un archivo' });
    let nuevos;
    try { nuevos = await subirAdjuntos(req, r); }
    catch (err) { return res.status(502).json({ error: err.message }); }
    r.adjuntos.push(...nuevos);
    r.$locals.correccionAutorizada = true;
    await r.save();
    await auditar(r, 'ADJUNTO', req, { despues: { adjuntos: nuevos.map(a => a.nombreOriginal) }, motivo });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express        = require('express');
const multer         = require('multer');
const jwt            = require('jsonwebtoken');
const CompaniaCodigo  = require('../models/CompaniaCodigo');
const ObligacionEBC   = require('../models/ObligacionEBC');
const PagoProgramacion = require('../models/PagoProgramacion');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const SECRET = process.env.JWT_SECRET || 'pedidos-secret-2024';

// ── Auth middleware ────────────────────────────────────────────────
router.use((req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inválido' }); }
});

function isAdmin(user)       { return user.role === 'ADMIN'; }
function isProgramador(user) { return isAdmin(user) || user.rolPago === 'programador' || user.rolPago === 'admin'; }
function isAutorizador(user) { return isAdmin(user) || user.rolObligaciones === 'autorizador' || isProgramador(user); }

// ── CSV parser helpers ─────────────────────────────────────────────

/** Parsear una línea CSV respetando campos entre comillas (RFC 4180) */
function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/** Parsear fecha "d/m/yyyy HH:mm:ss" o "d/m/yyyy HH:mm:ss:mmm" → Date (local noon) */
function parseFechaEBC(str) {
  if (!str || !str.trim()) return null;
  const datePart = str.trim().split(' ')[0];
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Parsear el CSV completo de EBC OBLIGACIONES, filtrando solo AP/PP */
function parseCSVObligaciones(buffer, mapaCompanias) {
  const text    = buffer.toString('latin1').replace(/\r/g, '');
  const lines   = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  const idx = name => headers.indexOf(name);
  const iCompCod  = idx('CompaniaCodigo');
  const iBusqueda = idx('Busqueda');
  const iNumDoc   = idx('NumeroDocumento');
  const iTipoDoc  = idx('TipoDocumento');
  const iFechaV   = idx('FechaVencimiento');
  const iFechaD   = idx('FechaDocumento');
  const iMoneda   = idx('MonedaDocumento');
  const iMonto    = idx('MontoObligacion');
  const iEstado   = idx('EstadoDocumento');
  const iNombre   = idx('NombreCompleto');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v   = parseCSVLine(lines[i]);
    const get = j => (v[j] !== undefined ? v[j] : '').trim();

    const estadoDoc = get(iEstado);
    if (estadoDoc !== 'AP' && estadoDoc !== 'PP') continue;

    const companiaCodigo = get(iCompCod);
    const compania       = mapaCompanias[companiaCodigo] || companiaCodigo;
    const proveedor      = get(iBusqueda);

    rows.push({
      compania,
      companiaCodigo,
      proveedor,
      proveedorKey:     proveedor.trim().toUpperCase(),
      numeroDocumento:  get(iNumDoc),
      tipoDocumento:    get(iTipoDoc),
      fechaVencimiento: parseFechaEBC(get(iFechaV)),
      fechaDocumento:   parseFechaEBC(get(iFechaD)),
      moneda:           get(iMoneda),
      monto:            parseFloat(get(iMonto)) || 0,
      estadoDoc,
      responsable:      get(iNombre),
    });
  }
  return rows;
}

// ── GET /mapa-companias ────────────────────────────────────────────
router.get('/mapa-companias', async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
    const docs = await CompaniaCodigo.find().sort({ codigo: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /mapa-companias ───────────────────────────────────────────
router.post('/mapa-companias', async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
    const { codigo, compania } = req.body;
    if (!codigo || !compania) return res.status(400).json({ error: 'codigo y compania son requeridos' });
    const doc = await CompaniaCodigo.findOneAndUpdate(
      { codigo: codigo.trim() },
      { codigo: codigo.trim(), compania: compania.trim() },
      { upsert: true, new: true }
    );
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /mapa-companias/:codigo ────────────────────────────────
router.delete('/mapa-companias/:codigo', async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
    await CompaniaCodigo.deleteOne({ codigo: req.params.codigo });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /cargar ───────────────────────────────────────────────────
router.post('/cargar', upload.single('archivo'), async (req, res) => {
  try {
    if (!isProgramador(req.user)) return res.status(403).json({ error: 'Sin acceso para cargar' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    // Construir mapa codigo → compania
    const mapaDocs = await CompaniaCodigo.find().lean();
    const mapaCompanias = {};
    mapaDocs.forEach(d => { mapaCompanias[d.codigo] = d.compania; });

    const rows = parseCSVObligaciones(req.file.buffer, mapaCompanias);
    if (!rows.length) return res.json({ ok: true, insertados: 0, message: 'Sin filas AP/PP en el archivo' });

    // Identificar compañías afectadas y limpiar sus registros previos
    const companiasAfectadas = [...new Set(rows.map(r => r.compania))];
    await ObligacionEBC.deleteMany({ compania: { $in: companiasAfectadas } });

    // Insertar nuevos
    await ObligacionEBC.insertMany(rows);

    res.json({ ok: true, insertados: rows.length, companias: companiasAfectadas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET / ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { compania } = req.query;
    const sociedades = req.user.sociedadesPago || [];
    const allowed = isAdmin(req.user) || !sociedades.length ? null : sociedades;
    if (allowed && compania && !allowed.includes(compania))
      return res.status(403).json({ error: 'Sin acceso a esta empresa' });
    const filter = compania
      ? { compania }
      : allowed ? { compania: { $in: allowed } } : {};
    const docs = await ObligacionEBC.find(filter).sort({ proveedor: 1, fechaVencimiento: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/seleccionar ──────────────────────────────────────────
router.put('/:id/seleccionar', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const obl = await ObligacionEBC.findById(req.params.id);
    if (!obl) return res.status(404).json({ error: 'Obligación no encontrada' });
    obl.seleccionadoPor = req.user.username;
    obl.seleccionadoEn  = new Date();
    if (req.body && req.body.comentario !== undefined) obl.comentario = req.body.comentario;
    await obl.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/comentario ───────────────────────────────────────────
router.put('/:id/comentario', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const obl = await ObligacionEBC.findById(req.params.id);
    if (!obl) return res.status(404).json({ error: 'Obligación no encontrada' });
    obl.comentario = req.body?.comentario || '';
    await obl.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/deseleccionar ────────────────────────────────────────
router.put('/:id/deseleccionar', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const obl = await ObligacionEBC.findById(req.params.id);
    if (!obl) return res.status(404).json({ error: 'Obligación no encontrada' });
    obl.seleccionadoPor   = undefined;
    obl.seleccionadoEn    = undefined;
    obl.programacionId    = undefined;
    obl.pendienteNextProg = false;
    await obl.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /aplicar ─────────────────────────────────────────────────
router.post('/aplicar', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });
    const { compania, progId } = req.body || {};
    if (!compania || !progId) return res.status(400).json({ error: 'compania y progId requeridos' });

    const prog = await PagoProgramacion.findById(progId);
    if (!prog) return res.status(404).json({ error: 'Programación no encontrada' });
    if (prog.compania !== compania) return res.status(400).json({ error: 'Compañía no coincide' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: `La programación está en estado "${prog.estado}" y no puede modificarse` });

    const seleccionadas = await ObligacionEBC.find({ compania, seleccionadoPor: { $exists: true, $ne: null } }).lean();
    if (!seleccionadas.length) return res.json({ ok: true, applied: 0 });

    let applied = 0;
    for (const obl of seleccionadas) {
      const existing = prog.obligaciones.find(o =>
        o.tipoDocumento === obl.tipoDocumento && o.numeroDocumento === obl.numeroDocumento
      );
      if (existing) {
        existing.origenEBC = true;
        if (obl.comentario) existing.observaciones = obl.comentario;
        applied++;
      } else {
        prog.obligaciones.push({
          tipoDocumento:    obl.tipoDocumento,
          numeroDocumento:  obl.numeroDocumento,
          fechaVencimiento: obl.fechaVencimiento,
          fechaDocumento:   obl.fechaDocumento,
          moneda:           obl.moneda,
          monto:            obl.monto,
          pagarA:           obl.proveedor,
          origenEBC:        true,
          observaciones:    obl.comentario || '',
        });
        applied++;
      }
      // Registrar el progId en la obligación
      await ObligacionEBC.findByIdAndUpdate(obl._id, { programacionId: String(prog._id), pendienteNextProg: false });
    }

    await prog.save();
    res.json({ ok: true, applied, total: seleccionadas.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

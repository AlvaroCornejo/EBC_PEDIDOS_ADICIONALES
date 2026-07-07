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
    const filter = compania ? { compania } : {};
    const docs = await ObligacionEBC.find(filter).sort({ fechaVencimiento: 1 }).lean();
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/seleccionar ──────────────────────────────────────────
router.put('/:id/seleccionar', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const obl = await ObligacionEBC.findById(req.params.id);
    if (!obl) return res.status(404).json({ error: 'Obligación no encontrada' });

    const { progId } = req.body || {};

    // Buscar programación activa para esta compañía que tenga la obligación por TipoDocumento+NumeroDocumento
    let progVinculada = null;
    let obVinculada   = null;

    // Primero buscar en progId específico si se pasó
    if (progId) {
      const p = await PagoProgramacion.findById(progId);
      if (p && p.compania === obl.compania && ['borrador','pendiente','aprobado'].includes(p.estado)) {
        const ob = p.obligaciones.find(o =>
          o.tipoDocumento === obl.tipoDocumento && o.numeroDocumento === obl.numeroDocumento
        );
        if (ob) { progVinculada = p; obVinculada = ob; }
      }
    }

    // Si no se encontró por progId, buscar en cualquier prog de esa compañía
    if (!progVinculada) {
      const progs = await PagoProgramacion.find({
        compania: obl.compania,
        estado: { $in: ['borrador','pendiente','aprobado'] }
      }).sort({ creadoEn: -1 });

      for (const p of progs) {
        const ob = p.obligaciones.find(o =>
          o.tipoDocumento === obl.tipoDocumento && o.numeroDocumento === obl.numeroDocumento
        );
        if (ob) { progVinculada = p; obVinculada = ob; break; }
      }
    }

    if (progVinculada && obVinculada) {
      if (['borrador','pendiente'].includes(progVinculada.estado)) {
        // Marcar en la programación
        obVinculada.seleccionado = true;
        obVinculada.origenEBC    = true;
        await progVinculada.save();

        obl.seleccionadoPor  = req.user.username;
        obl.seleccionadoEn   = new Date();
        obl.programacionId   = String(progVinculada._id);
        obl.pendienteNextProg = false;
        await obl.save();

        return res.json({ ok: true, linked: true, progEstado: progVinculada.estado });
      } else {
        // Estado aprobado — no modificar prog
        obl.seleccionadoPor   = req.user.username;
        obl.seleccionadoEn    = new Date();
        obl.programacionId    = String(progVinculada._id);
        obl.pendienteNextProg = true;
        await obl.save();

        return res.json({ ok: true, linked: false, progAprobada: true });
      }
    }

    // No se encontró la obligación en ninguna prog → intentar agregar a una borrador/pendiente
    const progAbierta = await PagoProgramacion.findOne({
      compania: obl.compania,
      estado: { $in: ['borrador','pendiente'] }
    }).sort({ creadoEn: -1 });

    if (progAbierta) {
      progAbierta.obligaciones.push({
        tipoDocumento:   obl.tipoDocumento,
        numeroDocumento: obl.numeroDocumento,
        fechaVencimiento: obl.fechaVencimiento,
        fechaDocumento:  obl.fechaDocumento,
        moneda:          obl.moneda,
        monto:           obl.monto,
        pagarA:          obl.proveedor,
        seleccionado:    true,
        origenEBC:       true,
      });
      await progAbierta.save();

      obl.seleccionadoPor   = req.user.username;
      obl.seleccionadoEn    = new Date();
      obl.programacionId    = String(progAbierta._id);
      obl.pendienteNextProg = false;
      await obl.save();

      return res.json({ ok: true, linked: true, added: true, progEstado: progAbierta.estado });
    }

    // No hay prog abierta
    obl.seleccionadoPor   = req.user.username;
    obl.seleccionadoEn    = new Date();
    obl.pendienteNextProg = true;
    await obl.save();

    return res.json({ ok: true, linked: false, noProg: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /:id/deseleccionar ────────────────────────────────────────
router.put('/:id/deseleccionar', async (req, res) => {
  try {
    if (!isAutorizador(req.user)) return res.status(403).json({ error: 'Sin acceso' });

    const obl = await ObligacionEBC.findById(req.params.id);
    if (!obl) return res.status(404).json({ error: 'Obligación no encontrada' });

    // Desmarcar en programación si estaba vinculada
    if (obl.programacionId) {
      const prog = await PagoProgramacion.findById(obl.programacionId);
      if (prog) {
        const ob = prog.obligaciones.find(o =>
          o.tipoDocumento === obl.tipoDocumento && o.numeroDocumento === obl.numeroDocumento
        );
        if (ob && ob.origenEBC) {
          ob.seleccionado = false;
          ob.origenEBC    = false;
          await prog.save();
        }
      }
    }

    obl.seleccionadoPor   = undefined;
    obl.seleccionadoEn    = undefined;
    obl.programacionId    = undefined;
    obl.pendienteNextProg = false;
    await obl.save();

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

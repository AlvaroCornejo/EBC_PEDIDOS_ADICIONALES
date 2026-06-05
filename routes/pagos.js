const express        = require('express');
const multer         = require('multer');
const auth           = require('../middleware/auth');
const PagoBeneficiario  = require('../models/PagoBeneficiario');
const PagoProgramacion  = require('../models/PagoProgramacion');
const PagoGrupoProveedor = require('../models/PagoGrupoProveedor');
const PagoDetalleGrupo   = require('../models/PagoDetalleGrupo');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage() });
router.use(auth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function requirePagoAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolPago) return next();
  return res.status(403).json({ error: 'Sin acceso a Gestión de Pagos' });
}
router.use(requirePagoAccess);

/** Sociedades autorizadas del usuario para pagos */
function socsPago(user) {
  if (user.role === 'ADMIN' || user.rolPago === 'admin') return null; // todas
  return (user.sociedadesCompra || []);
}

/** Verifica que la sociedad esté autorizada para el usuario */
function checkSocAccess(user, compania) {
  const socs = socsPago(user);
  if (socs === null) return true;       // admin ve todas
  return socs.includes(compania);
}

/** Filtro MongoDB de sociedad para el usuario */
function socFilter(user) {
  const socs = socsPago(user);
  if (socs === null) return {};
  if (!socs.length)  return { compania: '__ninguna__' };
  return { compania: { $in: socs } };
}

/** Próximo viernes estricto (si hoy es viernes → el siguiente) */
function proxViernes(desde = new Date()) {
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  const diasHasta = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + diasHasta);
  return d;
}

/** Semana ISO */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}

/** Parsear fecha del CSV "D/MM/YYYY HH:MM:SS" o "D/MM/YYYY" → solo fecha */
function parseFecha(str) {
  if (!str) return null;
  const [datePart] = str.trim().split(' ');
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

/** Parsear una línea CSV respetando campos entre comillas (RFC 4180) */
function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }  // comilla escapada
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

/** Parsear CSV completo con soporte para campos con comas entre comillas */
function parseCSV(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}


// ── Grupos Proveedor & Detalle ────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try { res.json(await PagoGrupoProveedor.find({ activo: true }).sort({ nombre: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/grupos', async (req, res) => {
  try {
    const g = await PagoGrupoProveedor.create({ nombre: (req.body.nombre || '').trim() });
    res.json(g);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/grupos/:id', async (req, res) => {
  try { await PagoGrupoProveedor.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/detalles', async (req, res) => {
  try {
    const { grupo } = req.query;
    const filter = { activo: true };
    if (grupo) filter.grupoProveedor = grupo;
    res.json(await PagoDetalleGrupo.find(filter).sort({ grupoProveedor: 1, nombre: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/detalles', async (req, res) => {
  try {
    const d = await PagoDetalleGrupo.create({
      nombre: (req.body.nombre || '').trim(),
      grupoProveedor: (req.body.grupoProveedor || '').trim(),
    });
    res.json(d);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/detalles/:id', async (req, res) => {
  try { await PagoDetalleGrupo.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/pagos/programaciones/:id ─────────────────────────────────────
router.delete('/programaciones/:id', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se pueden eliminar programaciones en borrador o pendiente de aprobación' });
    await prog.deleteOne();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/fecha-pago ─────────────────────────────────────────────────
router.get('/fecha-pago', (req, res) => {
  const fp = proxViernes();
  res.json({ fechaPago: fp, semana: isoWeek(fp), año: fp.getFullYear() });
});

// ── GET /api/pagos/beneficiarios?compania= ────────────────────────────────────
router.get('/beneficiarios', async (req, res) => {
  try {
    const { compania } = req.query;
    if (compania && !checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });
    const filter = { ...socFilter(req.user) };
    if (compania) filter.compania = compania;
    const rows = await PagoBeneficiario.find(filter).sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/beneficiarios/:id/grupo ────────────────────────────────────
router.put('/beneficiarios/:id/grupo', async (req, res) => {
  try {
    const { grupo } = req.body;
    const b = await PagoBeneficiario.findByIdAndUpdate(
      req.params.id, { grupo: grupo || '', updatedAt: new Date() }, { new: true }
    );
    if (!b) return res.status(404).json({ error: 'No encontrado' });
    res.json(b);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/programaciones ─────────────────────────────────────────────
router.get('/programaciones', async (req, res) => {
  try {
    const { compania, año, semana } = req.query;
    if (compania && !checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });
    const filter = { ...socFilter(req.user) };
    if (compania) filter.compania = compania;
    if (año)      filter.año = parseInt(año);
    if (semana)   filter.semana = parseInt(semana);
    const rows = await PagoProgramacion
      .find(filter, { obligaciones: 0 })
      .sort({ creadoEn: -1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/programaciones/:id ─────────────────────────────────────────
router.get('/programaciones/:id', async (req, res) => {
  try {
    const p = await PagoProgramacion.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ error: 'No encontrada' });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pagos/cargar ────────────────────────────────────────────────────
// Carga Q PROGRAMACION.csv — crea nueva programación
router.post('/cargar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { compania } = req.body;
    if (!compania)     return res.status(400).json({ error: 'Compañía requerida' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });

    const rows = parseCSV(req.file.buffer);
    if (!rows.length)  return res.status(400).json({ error: 'Archivo vacío o inválido' });

    const fechaPago = proxViernes();
    const semana    = isoWeek(fechaPago);
    const año       = fechaPago.getFullYear();

    // Obtener grupos guardados para esta compañía
    const benefMap = {};
    const bens = await PagoBeneficiario.find({ compania }).lean();
    bens.forEach(b => { benefMap[b.nombre.trim().toUpperCase()] = b; });

    const obligaciones = [];
    const nuevosBenef  = {};

    for (const r of rows) {
      const pagarA = (r['PagarA'] || '').trim();
      if (!pagarA) continue;

      const fv = parseFecha(r['FechaVencimiento']);
      const fd = parseFecha(r['FechaDocumento']);
      const diasVencido = fv
        ? Math.round((fechaPago - fv) / 86400000)
        : 0;

      const key   = pagarA.toUpperCase();
      const grupo       = benefMap[key]?.grupo       || 'OTROS';
      const detalleGrupo= benefMap[key]?.detalleGrupo|| 'OTROS';
      const banco       = benefMap[key]?.banco || (r['Banco'] || '').trim();

      // Acumular para upsert de beneficiarios
      if (!nuevosBenef[key]) {
        nuevosBenef[key] = { nombre: pagarA, compania, grupo, banco };
      }

      obligaciones.push({
        tipoDocumento:    (r['TipoDocumento'] || '').trim(),
        numeroDocumento:  (r['NumeroDocumento'] || '').trim(),
        fechaVencimiento: fv,
        moneda:           (r['MonedaDocumento'] || '').trim(),
        monto:            parseFloat(r['MontoMoneda']) || 0,
        pagarA,
        fechaDocumento:   fd,
        banco:            (r['Banco'] || '').trim(),
        diasVencido,
        grupo,
        detalleGrupo,
        seleccionado: diasVencido >= 0 && diasVencido <= 9,
      });
    }

    // Upsert maestro de beneficiarios
    for (const b of Object.values(nuevosBenef)) {
      await PagoBeneficiario.findOneAndUpdate(
        { nombre: b.nombre, compania: b.compania },
        { $set: { banco: b.banco, updatedAt: new Date() },
          $setOnInsert: { grupo: b.grupo } },
        { upsert: true, new: true }
      );
    }

    // Crear la programación
    const prog = await PagoProgramacion.create({
      compania, fechaPago, semana, año,
      creadoPor: req.user.username,
      obligaciones,
    });

    res.json({ id: prog._id, total: obligaciones.length, fechaPago, semana, año });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pagos/programaciones/:id/enviar-aprobacion ─────────────────────
router.post('/programaciones/:id/enviar-aprobacion', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'No se puede enviar en este estado' });
    // Guardar selecciones actuales
    const { selecciones } = req.body;
    if (Array.isArray(selecciones)) {
      selecciones.forEach(({ id, seleccionado }) => {
        const ob = prog.obligaciones.id(id);
        if (ob) ob.seleccionado = !!seleccionado;
      });
    }
    prog.estado    = 'pendiente';
    prog.enviadoEn = new Date();
    await prog.save();
    res.json(prog);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/grupo-beneficiario ─────────────────────
router.put('/programaciones/:progId/grupo-beneficiario', async (req, res) => {
  try {
    const { nombre, grupo, detalleGrupo } = req.body;
    const prog = await PagoProgramacion.findById(req.params.progId);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });

    prog.obligaciones.forEach(ob => {
      if (ob.pagarA.trim().toUpperCase() === nombre.trim().toUpperCase()) {
        if (grupo        !== undefined) ob.grupo        = grupo        || 'OTROS';
        if (detalleGrupo !== undefined) ob.detalleGrupo = detalleGrupo || 'OTROS';
      }
    });
    await prog.save();

    const upd = {};
    if (grupo        !== undefined) upd.grupo        = grupo        || 'OTROS';
    if (detalleGrupo !== undefined) upd.detalleGrupo = detalleGrupo || 'OTROS';
    upd.updatedAt = new Date();
    await PagoBeneficiario.findOneAndUpdate(
      { nombre: { $regex: new RegExp(`^${nombre.trim()}$`, 'i') }, compania: prog.compania },
      upd
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

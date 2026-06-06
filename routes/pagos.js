const express        = require('express');
const multer         = require('multer');
const ExcelJS        = require('exceljs');
const auth           = require('../middleware/auth');
const PagoBeneficiario  = require('../models/PagoBeneficiario');
const PagoProgramacion  = require('../models/PagoProgramacion');
const PagoGrupoProveedor = require('../models/PagoGrupoProveedor');
const PagoDetalleGrupo   = require('../models/PagoDetalleGrupo');
const PagoBanco          = require('../models/PagoBanco');
const EstadoCuenta       = require('../models/EstadoCuenta');

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
  return (user.sociedadesPago || []);
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

/** Próximo viernes estricto (si hoy es viernes → el siguiente).
 *  Usa UTC noon para evitar que medianoche UTC se muestre como día anterior
 *  en zonas horarias negativas (ej. Peru UTC-5). */
function proxViernes(desde = new Date()) {
  const d = new Date(desde);
  d.setUTCHours(12, 0, 0, 0);          // noon UTC — no cae al día anterior en UTC-5
  const diasHasta = ((5 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + diasHasta);
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

/** Parsear CSV con cabecera en la primera fila (para Q PAGOS y similares) */
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

/**
 * Parsear Q PROGRAMACION.csv — SIN cabecera, columnas fijas:
 *  0  TipoDocumento       (FP / PP / AP / RH / VR)
 *  1  NumeroDocumento
 *  4  Banco               (AB=BBVA, IB=IBK, EX=BCP)
 *  5  FechaVencimiento    "D/MM/YYYY HH:MM:SS"
 *  7  MonedaDocumento     (LO=SOL, EX=USD)
 *  8  MontoMoneda
 *  9  PagarA              nombre del beneficiario
 * 32  FechaDocumento      "D/MM/YYYY HH:MM:SS"
 */
const BANCO_MAP = { AB: 'BBVA', IB: 'IBK', EX: 'BCP' };
function parseCSVProgramacion(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const v = parseCSVLine(line);
    const get = i => (v[i] || '').trim();
    const bancoCode = get(4);
    return {
      TipoDocumento:    get(0),
      NumeroDocumento:  get(1),
      Banco:            BANCO_MAP[bancoCode] || bancoCode,
      FechaVencimiento: get(5),
      MonedaDocumento:  get(7),
      MontoMoneda:      get(8),
      PagarA:           get(9),
      FechaDocumento:   get(32),
    };
  }).filter(r => r.TipoDocumento && r.PagarA);
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
    const { compania, año, semana, estado } = req.query;
    if (compania && !checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });
    const filter = { ...socFilter(req.user) };
    if (compania) filter.compania = compania;
    if (año)      filter.año = parseInt(año);
    if (semana)   filter.semana = parseInt(semana);
    if (estado)   filter.estado = estado;
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

    const rows = parseCSVProgramacion(req.file.buffer);
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

// ── PUT /api/pagos/programaciones/:id/guardar ────────────────────────────────
// Guarda selecciones sin cambiar el estado
router.put('/programaciones/:id/guardar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!['borrador','pendiente','aprobado','preparado'].includes(prog.estado))
      return res.status(400).json({ error: 'No se puede modificar en este estado' });
    const { selecciones } = req.body;
    if (Array.isArray(selecciones)) {
      selecciones.forEach(({ id, seleccionado }) => {
        const ob = prog.obligaciones.id(id);
        if (ob) ob.seleccionado = !!seleccionado;
      });
    }
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/aprobar ────────────────────────────────
router.put('/programaciones/:id/aprobar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se pueden aprobar programaciones en estado borrador o pendiente' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['aprobador','admin'].includes(rol))
      return res.status(403).json({ error: 'No tiene permiso para aprobar programaciones' });
    const { selecciones } = req.body;
    if (Array.isArray(selecciones)) {
      selecciones.forEach(({ id, seleccionado }) => {
        const ob = prog.obligaciones.id(id);
        if (ob) ob.seleccionado = !!seleccionado;
      });
    }
    prog.estado      = 'aprobado';
    prog.aprobadoPor = req.user.username;
    prog.aprobadoEn  = new Date();
    await prog.save();
    res.json({ ok: true });
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
    prog.estado     = 'pendiente';
    prog.enviadoPor = req.user.username;
    prog.enviadoEn  = new Date();
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

// ── POST /api/pagos/cargar-pagos ──────────────────────────────────────────────
// Carga Q PAGOS.csv y devuelve promedio de pago por beneficiario (últimas 4 semanas)
router.post('/cargar-pagos', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { progId } = req.body;
    const rows = parseCSV(req.file.buffer);

    // Primero: recopilar todas las fechas válidas para hallar las 4 semanas más recientes del archivo
    const parsedRows = [];
    for (const r of rows) {
      const pagarA = (r['PagarA'] || '').trim();
      if (!pagarA) continue;
      const fRaw  = (r['FechaPago'] || '').split(':')[0].trim(); // quitar milisegundos HH:MM:SS:mmm
      const fecha = parseFecha(fRaw);
      if (!fecha || isNaN(fecha)) continue;
      const monto = parseFloat(r['PagoMonedaLocal'] || r['PagoMonedaExtranjera'] || 0) || 0;
      const clave = `${fecha.getFullYear()}-${String(isoWeek(fecha)).padStart(2,'0')}`;
      parsedRows.push({ pagarA, monto, clave });
    }

    // Obtener las 4 semanas más recientes presentes en el archivo
    const todasSemanas = [...new Set(parsedRows.map(r => r.clave))].sort().reverse();
    const semanas4 = new Set(todasSemanas.slice(0, 4));

    // Acumular por beneficiario (solo las 4 semanas más recientes)
    const benef = {};
    for (const r of parsedRows) {
      if (!semanas4.has(r.clave)) continue;
      if (!benef[r.pagarA]) benef[r.pagarA] = { total: 0, semanas: new Set() };
      benef[r.pagarA].total += r.monto;
      benef[r.pagarA].semanas.add(r.clave);
    }

    // Calcular promedio
    const resultado = {};
    for (const [pa, d] of Object.entries(benef)) {
      resultado[pa.toUpperCase()] = {
        total:    d.total,
        semanas:  d.semanas.size,
        promedio: d.semanas.size > 0 ? d.total / d.semanas.size : 0,
      };
    }
    // Guardar en la programación si se proporcionó un progId
    if (progId) {
      await PagoProgramacion.findByIdAndUpdate(progId, { promediosPagos: resultado });
    }

    res.json(resultado);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET  /api/pagos/bancos ────────────────────────────────────────────────────
router.get('/bancos', async (req, res) => {
  try {
    const rows = await PagoBanco.find().sort({ nombre: 1 }).lean();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pagos/bancos ────────────────────────────────────────────────────
router.post('/bancos', async (req, res) => {
  try {
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['admin'].includes(rol) && req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Solo administradores pueden crear bancos' });
    const { nombre, codigo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const banco = new PagoBanco({ nombre: nombre.trim().toUpperCase(), codigo: (codigo||'').trim() });
    await banco.save();
    res.json(banco);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe un banco con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/pagos/bancos/:id ─────────────────────────────────────────────────
router.put('/bancos/:id', async (req, res) => {
  try {
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['admin'].includes(rol) && req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Sin permiso' });
    const { nombre, codigo, activo } = req.body;
    const upd = {};
    if (nombre !== undefined) upd.nombre = nombre.trim().toUpperCase();
    if (codigo !== undefined) upd.codigo = codigo.trim();
    if (activo !== undefined) upd.activo = !!activo;
    const banco = await PagoBanco.findByIdAndUpdate(req.params.id, upd, { new: true });
    if (!banco) return res.status(404).json({ error: 'No encontrado' });
    res.json(banco);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/pagos/bancos/:id ──────────────────────────────────────────────
router.delete('/bancos/:id', async (req, res) => {
  try {
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['admin'].includes(rol) && req.user.role !== 'ADMIN')
      return res.status(403).json({ error: 'Sin permiso' });
    await PagoBanco.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Aplica asignaciones de banco/agrupador a las obligaciones de la prog y guarda defaults en beneficiarios */
async function aplicarAsignacionesP3(prog, asignaciones) {
  if (!Array.isArray(asignaciones)) return;
  // Aplicar a obligaciones
  asignaciones.forEach(({ id, bancoAsignado, agrupadorPago, retencion, observaciones }) => {
    const ob = prog.obligaciones.id(id);
    if (ob) {
      if (bancoAsignado  !== undefined) ob.bancoAsignado  = bancoAsignado  || '';
      if (agrupadorPago  !== undefined) ob.agrupadorPago  = agrupadorPago  || 'INDIVIDUAL';
      if (retencion      !== undefined) ob.retencion      = parseFloat(retencion) || 0;
      if (observaciones  !== undefined) ob.observaciones  = observaciones  || '';
    }
  });
  // Guardar defaults por beneficiario (último banco + agrupador usado)
  const defMap = {}; // { nombreUpper: { banco, agrupador } }
  prog.obligaciones.filter(o => o.seleccionado).forEach(ob => {
    const key = (ob.pagarA || '').toUpperCase();
    if (!defMap[key]) defMap[key] = { banco: ob.bancoAsignado || '', agrupador: ob.agrupadorPago || 'INDIVIDUAL' };
  });
  const ops = Object.entries(defMap).map(([nombre, { banco, agrupador }]) =>
    PagoBeneficiario.findOneAndUpdate(
      { nombre: { $regex: new RegExp(`^${nombre}$`, 'i') }, compania: prog.compania },
      { bancoDefault: banco, agrupadorDefault: agrupador, updatedAt: new Date() },
      { new: true }
    )
  );
  await Promise.all(ops);
}

// ── PUT /api/pagos/programaciones/:id/guardar-p3 ─────────────────────────────
router.put('/programaciones/:id/guardar-p3', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['aprobado','preparado'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se puede guardar en estado aprobado o preparado' });
    await aplicarAsignacionesP3(prog, req.body.asignaciones);
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/preparar ───────────────────────────────
router.put('/programaciones/:id/preparar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['aprobado','preparado'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se puede preparar desde estado aprobado' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['pagador','admin'].includes(rol))
      return res.status(403).json({ error: 'No tiene permiso para preparar pagos' });
    await aplicarAsignacionesP3(prog, req.body.asignaciones);
    prog.estado       = 'preparado';
    prog.preparadoPor = req.user.username;
    prog.preparadoEn  = new Date();
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/autorizar ──────────────────────────────
router.put('/programaciones/:id/autorizar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (prog.estado !== 'preparado')
      return res.status(400).json({ error: 'Solo se puede autorizar desde estado preparado' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['autorizador','admin'].includes(rol))
      return res.status(403).json({ error: 'No tiene permiso para autorizar pagos' });
    // Guardar cambios de Paso 4 antes de autorizar
    await aplicarAsignacionesP3(prog, req.body.asignaciones);
    prog.estado        = 'autorizado';
    prog.autorizadoPor = req.user.username;
    prog.autorizadoEn  = new Date();
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helper: parsear estado de cuenta Excel ────────────────────────────────────
async function parsearEstadoCuenta(buffer, banco) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const trxs = [];
  let primera = true;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (primera) { primera = false; return; }   // saltar cabecera
    const v = row.values;                        // índice 1-based en ExcelJS
    try {
      if (banco === 'BBVA') {
        // A=fecha, D=Nº.Doc, E=Concepto, F=Importe
        if (!v[1]) return;                       // filas de saldo no tienen fecha
        const nroDoc = String(v[4] || '').trim();
        if (!nroDoc || nroDoc === 'undefined') return;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc, concepto: String(v[5]||'').trim(),
                    importe: parseFloat(v[6]) || 0 });
      } else if (banco === 'BCP') {
        // A=Fecha, C=Desc, D=Monto, G=Operación-Número
        if (!v[1] || !v[7]) return;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc: String(v[7]).trim(),
                    concepto: String(v[3]||'').trim(),
                    importe: parseFloat(v[4]) || 0 });
      } else if (banco === 'IBK') {
        // A=Fecha, C=Nro.Operación, D=Movimiento, G=Cargo, H=Abono
        if (!v[1] || !v[3]) return;
        const nroDoc = String(v[3]).trim();
        if (!nroDoc || nroDoc === '-') return;
        const cargo = parseFloat(v[7]) || 0;
        const abono = parseFloat(v[8]) || 0;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc,
                    concepto: String(v[4] || v[5] || '').trim(),
                    importe: cargo !== 0 ? cargo : abono });
      }
    } catch (_) {}
  });
  return trxs;
}

// ── POST /api/pagos/estados-cuenta ────────────────────────────────────────────
router.post('/estados-cuenta', upload.single('archivo'), async (req, res) => {
  try {
    const { compania, banco, moneda } = req.body;
    if (!compania || !banco || !moneda || !req.file)
      return res.status(400).json({ error: 'Faltan campos: compania, banco, moneda o archivo' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sin acceso a esta sociedad' });
    const transacciones = await parsearEstadoCuenta(req.file.buffer, banco);
    await EstadoCuenta.findOneAndUpdate(
      { compania, banco, moneda },
      { compania, banco, moneda,
        cargadoPor: req.user.username, cargadoEn: new Date(), transacciones },
      { upsert: true, new: true }
    );
    res.json({ ok: true, count: transacciones.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/estados-cuenta ─────────────────────────────────────────────
router.get('/estados-cuenta', async (req, res) => {
  try {
    const { compania } = req.query;
    if (!compania) return res.json([]);
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sin acceso' });
    const estados = await EstadoCuenta.find({ compania }).sort({ banco: 1, moneda: 1 });
    res.json(estados);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helper P5 ─────────────────────────────────────────────────────────────────
function aplicarAsignacionesP5(prog, asignaciones) {
  (asignaciones || []).forEach(({ id, operacionBancaria, importeBanco, p5Banco, p5Moneda }) => {
    const ob = prog.obligaciones.id(id);
    if (ob) {
      if (operacionBancaria !== undefined) ob.operacionBancaria = operacionBancaria || '';
      if (importeBanco      !== undefined) ob.importeBanco      = importeBanco != null ? parseFloat(importeBanco) || null : null;
      if (p5Banco           !== undefined) ob.p5Banco           = p5Banco  || '';
      if (p5Moneda          !== undefined) ob.p5Moneda          = p5Moneda || '';
    }
  });
}

// ── PUT /api/pagos/programaciones/:id/guardar-p5 ──────────────────────────────
router.put('/programaciones/:id/guardar-p5', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['autorizado','pagado'].includes(prog.estado))
      return res.status(400).json({ error: 'Estado inválido para guardar P5' });
    aplicarAsignacionesP5(prog, req.body.asignaciones);
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/pagar ───────────────────────────────────
router.put('/programaciones/:id/pagar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (prog.estado !== 'autorizado')
      return res.status(400).json({ error: 'Solo se puede registrar el pago desde estado autorizado' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['pagador','admin'].includes(rol))
      return res.status(403).json({ error: 'No tiene permiso para registrar el pago' });
    aplicarAsignacionesP5(prog, req.body.asignaciones);
    prog.estado    = 'pagado';
    prog.pagadoPor = req.user.username;
    prog.pagadoEn  = new Date();
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/pagos/programaciones/:id/pagar-op ───────────────────────────────
// Registra el pago solo para las obligaciones de una combinación banco+moneda+op
router.put('/programaciones/:id/pagar-op', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['autorizado','pagado'].includes(prog.estado))
      return res.status(400).json({ error: 'Estado no permite registrar pago' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['pagador','admin'].includes(rol))
      return res.status(403).json({ error: 'Sin permiso para registrar pago' });

    const { banco, moneda, operacionBancaria, asignaciones } = req.body;
    if (!banco || !moneda || !operacionBancaria)
      return res.status(400).json({ error: 'Faltan banco, moneda u operación' });

    // Primero guardar asignaciones P5 si vienen
    if (asignaciones) aplicarAsignacionesP5(prog, asignaciones);

    // Marcar como pagadas solo las obligaciones de esa combinación
    const opStr = String(operacionBancaria).trim();
    let marked = 0;
    (prog.obligaciones || []).filter(o => o.seleccionado).forEach(ob => {
      const obBanco  = ob.p5Banco  || ob.bancoAsignado || '';
      const obMoneda = ob.p5Moneda || (ob.moneda === 'LO' ? 'SOL' : 'USD');
      const obOp     = String(ob.operacionBancaria || '').trim();
      if (obBanco === banco && obMoneda === moneda && obOp === opStr) {
        ob.pagada = true;
        marked++;
      }
    });

    if (marked === 0)
      return res.status(400).json({ error: `Sin obligaciones para ${banco}/${moneda}/op.${opStr}` });

    // Si TODAS las obligaciones seleccionadas están pagadas → pasar a 'pagado'
    const selected = (prog.obligaciones || []).filter(o => o.seleccionado);
    const allPaid  = selected.length > 0 && selected.every(o => o.pagada);
    if (allPaid) {
      prog.estado    = 'pagado';
      prog.pagadoPor = req.user.username;
      prog.pagadoEn  = new Date();
    }

    await prog.save();
    res.json({ ok: true, marked, progEstado: prog.estado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

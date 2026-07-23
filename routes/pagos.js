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
const PagoAdelanto       = require('../models/PagoAdelanto');

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

const BANCO_MAP = { AB: 'BBVA', IB: 'IBK', EX: 'BCP' };

/**
 * Parsear Q PROGRAMACION.csv — detecta columnas por nombre desde el header.
 * Fallbacks a índices fijos documentados si el nombre no aparece en el header.
 * Si FechaDocumento aparece más de una vez, usa la última ocurrencia.
 */
function parseCSVProgramacion(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  const col = (name, fallback) => {
    const i = headers.indexOf(name);
    return i !== -1 ? i : fallback;
  };
  // FechaDocumento puede aparecer dos veces → última ocurrencia
  const fdAll = headers.reduce((acc, h, i) => h === 'FechaDocumento' ? [...acc, i] : acc, []);

  const COL = {
    tipo : col('TipoDocumento',  0),
    num  : col('NumeroDocumento',1),
    banco: col('Banco',          4),
    fv   : col('FechaVencimiento',5),
    mon  : col('MonedaDocumento', 7),
    mto  : col('MontoMoneda',     8),
    pa   : col('PagarA',          9),
    fd   : fdAll.length ? fdAll[fdAll.length - 1] : 32,
  };

  return lines.slice(1).map(line => {
    const v = parseCSVLine(line);
    const get = i => (v[i] || '').trim();
    const bancoCode = get(COL.banco);
    return {
      TipoDocumento:    get(COL.tipo),
      NumeroDocumento:  get(COL.num),
      Banco:            BANCO_MAP[bancoCode] || bancoCode,
      FechaVencimiento: get(COL.fv),
      MonedaDocumento:  get(COL.mon),
      MontoMoneda:      get(COL.mto),
      PagarA:           get(COL.pa),
      FechaDocumento:   get(COL.fd),
    };
  }).filter(r => r.TipoDocumento && r.PagarA);
}

/**
 * Parsear ADELANTOS.csv — CON cabecera pero con columnas duplicadas
 * (FechaDocumento y Busqueda aparecen 2 veces), por eso se usan índices fijos:
 *  1  NumeroAdelanto
 *  4  FechaDocumento
 *  6  MontoTotal
 *  7  SaldoAdelanto
 *  8  Estado
 *  9  Busqueda           → proveedor (matchea contra obligaciones[].pagarA)
 * 10  MonedaDocumento    (LO / EX)
 * 11  TipoAdelanto
 * 13  Busqueda (2)       → responsable interno
 * 14  CentroCostos
 */
function parseCSVAdelantos(buffer) {
  const text  = buffer.toString('latin1').replace(/\r/g, '');
  const lines = text.split('\n').filter(l => l.trim());
  return lines.slice(1).map(line => {
    const v = parseCSVLine(line);
    const get = i => (v[i] || '').trim();
    return {
      numeroAdelanto: get(1),
      fechaDocumento: parseFecha(get(4)),
      montoTotal:     parseFloat(get(6)) || 0,
      saldoAdelanto:  parseFloat(get(7)) || 0,
      estado:         get(8),
      proveedor:      get(9),
      moneda:         get(10),
      tipoAdelanto:   get(11),
      responsable:    get(13),
      centroCostos:   get(14),
    };
  }).filter(r => r.numeroAdelanto && r.proveedor);
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
    // Los ADMIN pueden eliminar programaciones en cualquier estado
    if (req.user.role !== 'ADMIN' && !['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se pueden eliminar programaciones en borrador o pendiente de aprobación' });
    await prog.deleteOne();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pagos/programaciones/:id/pago-parcial ─────────────────────────
// Crea una nueva obligación con el importe parcial (clonada de la original) y
// desmarca la original. Solo una parcial por obligación original a la vez.
router.post('/programaciones/:id/pago-parcial', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania)) return res.status(403).json({ error: 'Sin acceso' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se puede hacer pago parcial en borrador o pendiente' });

    const { obligacionId, montoParcial } = req.body;
    const monto = parseFloat(montoParcial);
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Importe parcial inválido' });

    const ob = prog.obligaciones.id(obligacionId);
    if (!ob) return res.status(404).json({ error: 'Obligación no encontrada' });
    if (ob.esParcial) return res.status(400).json({ error: 'No se puede hacer un parcial de otra parcial' });
    if (monto >= ob.monto) return res.status(400).json({ error: `El importe parcial debe ser menor al total (${ob.monto})` });

    const yaTieneParcial = prog.obligaciones.some(o => o.esParcial && o.obligacionOrigenId === String(ob._id));
    if (yaTieneParcial) return res.status(400).json({ error: 'Esta obligación ya tiene un pago parcial. Elimínalo primero.' });

    ob.seleccionado = false;
    ob.monto = Math.round((ob.monto - monto) * 100) / 100; // queda el saldo pendiente
    prog.obligaciones.push({
      tipoDocumento:      ob.tipoDocumento,
      numeroDocumento:    ob.numeroDocumento,
      fechaVencimiento:   ob.fechaVencimiento,
      fechaDocumento:     ob.fechaDocumento,
      moneda:             ob.moneda,
      monto:              Math.round(monto * 100) / 100,
      pagarA:             ob.pagarA,
      banco:              ob.banco,
      diasVencido:        ob.diasVencido,
      grupo:              ob.grupo,
      detalleGrupo:       ob.detalleGrupo,
      seleccionado:       true,
      esParcial:          true,
      obligacionOrigenId: String(ob._id),
      bancoAsignado:      ob.bancoAsignado || '',
      agrupadorPago:      ob.agrupadorPago || 'INDIVIDUAL',
      retencion:          ob.retencion || 0,
    });
    await prog.save();
    res.json(prog);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/pagos/programaciones/:id/obligaciones/:oblId ─────────────────
// Elimina una obligación parcial y re-selecciona la original.
router.delete('/programaciones/:id/obligaciones/:oblId', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania)) return res.status(403).json({ error: 'Sin acceso' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'No se puede modificar en este estado' });

    const ob = prog.obligaciones.id(req.params.oblId);
    if (!ob) return res.status(404).json({ error: 'Obligación no encontrada' });
    if (!ob.esParcial) return res.status(400).json({ error: 'Solo se pueden eliminar obligaciones parciales por esta ruta' });

    if (ob.obligacionOrigenId) {
      const orig = prog.obligaciones.id(ob.obligacionOrigenId);
      if (orig) {
        orig.seleccionado = true;
        orig.monto = Math.round((orig.monto + ob.monto) * 100) / 100;
      }
    }
    ob.deleteOne();
    await prog.save();
    res.json(prog);
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
        seleccionado:     diasVencido >= 0 && diasVencido <= 9,
        bancoAsignado:    (r['MonedaDocumento']||'').trim() === 'LO'
                            ? (benefMap[key]?.bancoDefaultSOL     || '')
                            : (benefMap[key]?.bancoDefaultUSD     || ''),
        agrupadorPago:    (r['MonedaDocumento']||'').trim() === 'LO'
                            ? (benefMap[key]?.agrupadorDefaultSOL || 'INDIVIDUAL')
                            : (benefMap[key]?.agrupadorDefaultUSD || 'INDIVIDUAL'),
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

// ── POST /api/pagos/adelantos/cargar ─────────────────────────────────────────
// Carga ADELANTOS.csv — reemplaza los adelantos previos de la compañía
router.post('/adelantos/cargar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { compania } = req.body;
    if (!compania)     return res.status(400).json({ error: 'Compañía requerida' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });

    const rows = parseCSVAdelantos(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'Archivo vacío o inválido' });

    await PagoAdelanto.deleteMany({ compania });
    const docs = rows.map(r => ({
      ...r,
      compania,
      proveedorKey: r.proveedor.trim().toUpperCase(),
    }));
    await PagoAdelanto.insertMany(docs);

    const proveedores = new Set(docs.map(d => d.proveedorKey));
    res.json({ ok: true, total: docs.length, proveedores: proveedores.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/adelantos/resumen?compania= ───────────────────────────────
// Totales por proveedor para anotar la relación de obligaciones
router.get('/adelantos/resumen', async (req, res) => {
  try {
    const { compania } = req.query;
    if (!compania) return res.status(400).json({ error: 'Compañía requerida' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });

    const rows = await PagoAdelanto.find({ compania }).sort({ fechaDocumento: 1 }).lean();
    const resumen = {};
    for (const r of rows) {
      const key = r.proveedorKey;
      if (!resumen[key]) resumen[key] = { totalSol: 0, totalUsd: 0, numDocs: 0, items: [] };
      if (r.moneda === 'LO') resumen[key].totalSol += r.saldoAdelanto;
      else                   resumen[key].totalUsd += r.saldoAdelanto;
      resumen[key].numDocs++;
      resumen[key].items.push({
        numeroAdelanto: r.numeroAdelanto,
        fechaDocumento: r.fechaDocumento,
        montoTotal:     r.montoTotal,
        saldoAdelanto:  r.saldoAdelanto,
        moneda:         r.moneda,
        estado:         r.estado,
        tipoAdelanto:   r.tipoAdelanto,
      });
    }
    res.json(resumen);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/pagos/adelantos?compania=&progId= ───────────────────────────────
// Relación completa de adelantos por proveedor, marcando los que no tienen
// obligaciones por pagar en la programación indicada
router.get('/adelantos', async (req, res) => {
  try {
    const { compania, progId } = req.query;
    if (!compania) return res.status(400).json({ error: 'Compañía requerida' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sociedad no autorizada' });

    const rows = await PagoAdelanto.find({ compania }).sort({ proveedor: 1, fechaDocumento: 1 }).lean();

    let pagarAKeys = new Set();
    if (progId) {
      const prog = await PagoProgramacion.findById(progId, { obligaciones: 1 }).lean();
      if (prog) pagarAKeys = new Set(prog.obligaciones.map(o => (o.pagarA || '').trim().toUpperCase()));
    }

    const porProveedor = {};
    for (const r of rows) {
      const key = r.proveedorKey;
      if (!porProveedor[key]) {
        porProveedor[key] = {
          proveedor: r.proveedor,
          totalSol: 0, totalUsd: 0, numDocs: 0,
          tieneObligacion: pagarAKeys.has(key),
          items: [],
        };
      }
      if (r.moneda === 'LO') porProveedor[key].totalSol += r.saldoAdelanto;
      else                   porProveedor[key].totalUsd += r.saldoAdelanto;
      porProveedor[key].numDocs++;
      porProveedor[key].items.push({
        numeroAdelanto: r.numeroAdelanto,
        fechaDocumento: r.fechaDocumento,
        montoTotal:     r.montoTotal,
        saldoAdelanto:  r.saldoAdelanto,
        moneda:         r.moneda,
        estado:         r.estado,
        tipoAdelanto:   r.tipoAdelanto,
      });
    }
    res.json(Object.values(porProveedor));
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

// ── PUT /api/pagos/programaciones/:id/desaprobar ─────────────────────────────
router.put('/programaciones/:id/desaprobar', async (req, res) => {
  try {
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (prog.estado !== 'aprobado')
      return res.status(400).json({ error: 'Solo se pueden desaprobar programaciones aprobadas' });
    const rol = req.user.rolPago || (req.user.role === 'ADMIN' ? 'admin' : '');
    if (!['aprobador','admin'].includes(rol))
      return res.status(403).json({ error: 'No tiene permiso para desaprobar programaciones' });
    prog.estado      = 'pendiente';
    prog.aprobadoPor = undefined;
    prog.aprobadoEn  = undefined;
    await prog.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/pagos/programaciones/:id/agregar-obligaciones ──────────────────
// Agrega solo las obligaciones nuevas del CSV (no elimina ni modifica las existentes)
router.post('/programaciones/:id/agregar-obligaciones', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const prog = await PagoProgramacion.findById(req.params.id);
    if (!prog) return res.status(404).json({ error: 'No encontrada' });
    if (!checkSocAccess(req.user, prog.compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!['borrador','pendiente'].includes(prog.estado))
      return res.status(400).json({ error: 'Solo se pueden agregar obligaciones en estado borrador o pendiente' });

    const rows = parseCSVProgramacion(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'Archivo vacío o inválido' });

    // Claves de obligaciones ya existentes (excluye parciales que son sintéticas)
    const existingKeys = new Set(
      prog.obligaciones
        .filter(o => !o.esParcial)
        .map(o => `${o.tipoDocumento}|${o.numeroDocumento}`)
    );

    const benefMap = {};
    const bens = await PagoBeneficiario.find({ compania: prog.compania }).lean();
    bens.forEach(b => { benefMap[b.nombre.trim().toUpperCase()] = b; });

    const fechaPago = prog.fechaPago;
    const nuevas = [];

    for (const r of rows) {
      const pagarA = (r['PagarA'] || '').trim();
      if (!pagarA) continue;
      const docKey = `${(r['TipoDocumento']||'').trim()}|${(r['NumeroDocumento']||'').trim()}`;
      if (existingKeys.has(docKey)) continue;

      const fv = parseFecha(r['FechaVencimiento']);
      const fd = parseFecha(r['FechaDocumento']);
      const diasVencido = fv ? Math.round((new Date(fechaPago) - fv) / 86400000) : 0;
      const bkey = pagarA.toUpperCase();

      nuevas.push({
        tipoDocumento:    (r['TipoDocumento'] || '').trim(),
        numeroDocumento:  (r['NumeroDocumento'] || '').trim(),
        fechaVencimiento: fv,
        moneda:           (r['MonedaDocumento'] || '').trim(),
        monto:            parseFloat(r['MontoMoneda']) || 0,
        pagarA,
        fechaDocumento:   fd,
        banco:            (r['Banco'] || '').trim(),
        diasVencido,
        grupo:            benefMap[bkey]?.grupo        || 'OTROS',
        detalleGrupo:     benefMap[bkey]?.detalleGrupo || 'OTROS',
        seleccionado:     diasVencido >= 0 && diasVencido <= 9,
        bancoAsignado:    (r['MonedaDocumento']||'').trim() === 'LO'
                            ? (benefMap[bkey]?.bancoDefaultSOL || '')
                            : (benefMap[bkey]?.bancoDefaultUSD || ''),
        agrupadorPago:    (r['MonedaDocumento']||'').trim() === 'LO'
                            ? (benefMap[bkey]?.agrupadorDefaultSOL || 'INDIVIDUAL')
                            : (benefMap[bkey]?.agrupadorDefaultUSD || 'INDIVIDUAL'),
      });
    }

    prog.obligaciones.push(...nuevas);
    await prog.save();
    const validInCSV = rows.filter(r => (r['PagarA']||'').trim()).length;
    res.json({ added: nuevas.length, skipped: validInCSV - nuevas.length, total: prog.obligaciones.length });
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
  // Guardar defaults por beneficiario + moneda (SOL / USD)
  const defMap = {};
  prog.obligaciones.filter(o => o.seleccionado).forEach(ob => {
    const nombre = (ob.pagarA || '').trim();
    if (!nombre) return;
    const isSol  = ob.moneda === 'LO';
    const key    = `${nombre.toUpperCase()}||${isSol ? 'SOL' : 'USD'}`;
    if (!defMap[key]) defMap[key] = { nombre, isSol, banco: ob.bancoAsignado || '', agrupador: ob.agrupadorPago || 'INDIVIDUAL' };
  });
  const ops = Object.values(defMap).map(({ nombre, isSol, banco, agrupador }) => {
    const update = isSol
      ? { bancoDefaultSOL: banco, agrupadorDefaultSOL: agrupador, updatedAt: new Date() }
      : { bancoDefaultUSD: banco, agrupadorDefaultUSD: agrupador, updatedAt: new Date() };
    return PagoBeneficiario.findOneAndUpdate(
      { nombre: { $regex: new RegExp(`^${nombre}$`, 'i') }, compania: prog.compania },
      update,
      { new: true }
    );
  });
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
  (asignaciones || []).forEach(({ id, operacionBancaria, importeBanco, p5Banco, p5Moneda, fechaHoraOperacion }) => {
    const ob = prog.obligaciones.id(id);
    if (ob) {
      if (operacionBancaria  !== undefined) ob.operacionBancaria  = operacionBancaria || '';
      if (importeBanco       !== undefined) ob.importeBanco       = importeBanco != null ? parseFloat(importeBanco) || null : null;
      if (p5Banco            !== undefined) ob.p5Banco            = p5Banco  || '';
      if (p5Moneda           !== undefined) ob.p5Moneda           = p5Moneda || '';
      if (fechaHoraOperacion !== undefined) ob.fechaHoraOperacion = fechaHoraOperacion ? new Date(fechaHoraOperacion) : null;
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
    // Marcar como pagadas todas las obligaciones seleccionadas (para que
    // luego se puedan filtrar/notificar por correo como "pagadas")
    (prog.obligaciones || []).filter(o => o.seleccionado).forEach(ob => { ob.pagada = true; });
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

const express = require('express');
const multer  = require('multer');
const auth    = require('../middleware/auth');

const FlujoLinea              = require('../models/FlujoLinea');
const FlujoDetalle            = require('../models/FlujoDetalle');
const FlujoCuentaBanco        = require('../models/FlujoCuentaBanco');
const FlujoConfig             = require('../models/FlujoConfig');
const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoPagoERP            = require('../models/FlujoPagoERP');
const FlujoGlosaRegla         = require('../models/FlujoGlosaRegla');
const FlujoProveedorDetalle   = require('../models/FlujoProveedorDetalle');
const TipoCambio              = require('../models/TipoCambio');
const CompaniaCodigo          = require('../models/CompaniaCodigo');

const { leerMovimientoBanco, leerPagosERP } = require('../utils/flujoCajaImport');
const { reconciliar } = require('../utils/flujoCajaReconciliar');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolPago) return next();
  return res.status(403).json({ error: 'Sin acceso a Flujo de Caja' });
}
router.use(requireAccess);

/** Sociedades autorizadas del usuario (null = todas, mismo patrón que Gestión de Pagos) */
function socsUsuario(user) {
  if (user.role === 'ADMIN' || user.rolPago === 'admin') return null;
  return user.sociedadesPago || [];
}
function checkSocAccess(user, sociedad) {
  const socs = socsUsuario(user);
  return socs === null || socs.includes(sociedad);
}

// ── Config (solo ADMIN) ───────────────────────────────────────────────────────
router.get('/config/:sociedad', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const cfg = await FlujoConfig.findOne({ sociedad: req.params.sociedad }).lean();
    res.json(cfg || { sociedad: req.params.sociedad, rutaPagosERP: '', archivosBanco: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config/:sociedad', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { rutaPagosERP, archivosBanco } = req.body;
    const cfg = await FlujoConfig.findOneAndUpdate(
      { sociedad: req.params.sociedad },
      {
        sociedad: req.params.sociedad,
        rutaPagosERP: rutaPagosERP || '',
        archivosBanco: Array.isArray(archivosBanco) ? archivosBanco : [],
      },
      { upsert: true, new: true }
    );
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Catálogo: Líneas y Detalles ────────────────────────────────────────────────
router.get('/lineas', async (req, res) => {
  try { res.json(await FlujoLinea.find({}).sort({ codigo: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/lineas', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre requeridos' });
    res.json(await FlujoLinea.create({ codigo, nombre }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/lineas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { nombre } = req.body;
    const l = await FlujoLinea.findByIdAndUpdate(req.params.id, { nombre }, { new: true });
    res.json(l);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/lineas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoLinea.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/detalles', async (req, res) => {
  try { res.json(await FlujoDetalle.find({}).sort({ lineaCodigo: 1, codigo: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/detalles', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { codigo, nombre, tipo, lineaCodigo } = req.body;
    if (!codigo || !nombre || !tipo || !lineaCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoDetalle.create({ codigo, nombre, tipo, lineaCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/detalles/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { nombre, tipo, lineaCodigo } = req.body;
    const d = await FlujoDetalle.findByIdAndUpdate(req.params.id, { nombre, tipo, lineaCodigo }, { new: true });
    res.json(d);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/detalles/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoDetalle.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reglas de glosa (método 1) ─────────────────────────────────────────────────
router.get('/glosas', async (req, res) => {
  try { res.json(await FlujoGlosaRegla.find({}).sort({ texto: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/glosas', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { texto, criterio, detalleCodigo } = req.body;
    if (!texto || !criterio || !detalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoGlosaRegla.create({ texto, criterio, detalleCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/glosas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { texto, criterio, detalleCodigo } = req.body;
    const g = await FlujoGlosaRegla.findByIdAndUpdate(req.params.id, { texto, criterio, detalleCodigo }, { new: true });
    res.json(g);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/glosas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoGlosaRegla.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Proveedor -> Detalle (método 2) ────────────────────────────────────────────
router.get('/proveedores', async (req, res) => {
  try { res.json(await FlujoProveedorDetalle.find({}).sort({ beneficiario: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/proveedores', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { beneficiario, detalleCodigo } = req.body;
    if (!beneficiario || !detalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoProveedorDetalle.create({ beneficiario: beneficiario.trim().toUpperCase(), detalleCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/proveedores/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { detalleCodigo } = req.body;
    const p = await FlujoProveedorDetalle.findByIdAndUpdate(req.params.id, { detalleCodigo }, { new: true });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/proveedores/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoProveedorDetalle.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cuenta ERP -> Banco/Moneda ─────────────────────────────────────────────────
router.get('/cuentas-banco', async (req, res) => {
  try {
    const { sociedad } = req.query;
    const filter = sociedad ? { sociedad } : {};
    res.json(await FlujoCuentaBanco.find(filter).sort({ sociedad: 1, cuentaBancaria: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/cuentas-banco', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { sociedad, cuentaBancaria, banco, moneda } = req.body;
    if (!sociedad || !cuentaBancaria || !banco || !moneda) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoCuentaBanco.create({ sociedad, cuentaBancaria, banco, moneda }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/cuentas-banco/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoCuentaBanco.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tipo de cambio ──────────────────────────────────────────────────────────────
router.get('/tipo-cambio', async (req, res) => {
  try { res.json(await TipoCambio.find({}).sort({ fecha: -1 }).limit(120).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/tipo-cambio', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { fecha, valor } = req.body;
    if (!fecha || !valor) return res.status(400).json({ error: 'Fecha y valor requeridos' });
    const tc = await TipoCambio.findOneAndUpdate(
      { fecha: new Date(fecha) },
      { fecha: new Date(fecha), valor: Number(valor), actualizadoPor: req.user.username },
      { upsert: true, new: true }
    );
    res.json(tc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/tipo-cambio/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await TipoCambio.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Carga manual ─────────────────────────────────────────────────────────────────
router.post('/cargar/pagos-erp', upload.single('archivo'), async (req, res) => {
  try {
    const { sociedad } = req.body;
    if (!sociedad || !req.file) return res.status(400).json({ error: 'Sociedad y archivo requeridos' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const companias = await CompaniaCodigo.find({}).lean();
    const mapaCias = Object.fromEntries(companias.map(c => [c.codigo, c.compania]));
    const filas = leerPagosERP(req.file.buffer);
    const propias = filas.filter(f => mapaCias[f.companiaCodigo.padStart(6, '0')] === sociedad);

    await FlujoPagoERP.deleteMany({ sociedad });
    const docs = propias.map(f => ({
      sociedad,
      cuentaBancaria: f.cuentaBancaria, numeroPago: f.numeroPago, pagarA: f.pagarA,
      moneda: f.moneda, fechaPago: f.fechaPago, montoLocal: f.montoLocal,
      montoExtranjero: f.montoExtranjero, tipoPago: f.tipoPago, voucherPago: f.voucherPago,
    }));
    if (docs.length) await FlujoPagoERP.insertMany(docs, { ordered: false });
    res.json({ ok: true, total: docs.length, deTodasLasSociedades: filas.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cargar/banco', upload.single('archivo'), async (req, res) => {
  try {
    const { sociedad, banco, moneda } = req.body;
    if (!sociedad || !banco || !moneda || !req.file) return res.status(400).json({ error: 'Sociedad, banco, moneda y archivo requeridos' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const movs = await leerMovimientoBanco(banco, req.file.buffer);
    await FlujoMovimientoBancario.deleteMany({ sociedad, banco, moneda });
    const docs = movs.map(m => ({ sociedad, banco, moneda, ...m }));
    if (docs.length) await FlujoMovimientoBancario.insertMany(docs, { ordered: false });
    res.json({ ok: true, total: docs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reconciliación ────────────────────────────────────────────────────────────
router.post('/reconciliar', async (req, res) => {
  try {
    const { sociedad } = req.query;
    if (!sociedad) return res.status(400).json({ error: 'Sociedad requerida' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });
    res.json(await reconciliar(sociedad));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Movimientos (nivel detalle) ────────────────────────────────────────────────
router.get('/movimientos', async (req, res) => {
  try {
    const { sociedad, banco, moneda, desde, hasta, sinAsignar } = req.query;
    if (!sociedad) return res.status(400).json({ error: 'Sociedad requerida' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const filter = { sociedad };
    if (banco) filter.banco = banco;
    if (moneda) filter.moneda = moneda;
    if (sinAsignar === 'true') filter.detalleCodigo = null;
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setUTCHours(23, 59, 59, 999); filter.fecha.$lte = h; }
    }

    const [movs, detalles, lineas] = await Promise.all([
      FlujoMovimientoBancario.find(filter).sort({ fecha: -1 }).limit(2000).lean(),
      FlujoDetalle.find({}).lean(),
      FlujoLinea.find({}).lean(),
    ]);
    const detMap = Object.fromEntries(detalles.map(d => [d.codigo, d]));
    const lineaMap = Object.fromEntries(lineas.map(l => [l.codigo, l]));
    const out = movs.map(m => {
      const det = m.detalleCodigo ? detMap[m.detalleCodigo] : null;
      const linea = det ? lineaMap[det.lineaCodigo] : null;
      return { ...m, detalleNombre: det?.nombre || null, lineaCodigo: det?.lineaCodigo || null, lineaNombre: linea?.nombre || null };
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/movimientos/:id/asignar', async (req, res) => {
  try {
    const mov = await FlujoMovimientoBancario.findById(req.params.id);
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (!checkSocAccess(req.user, mov.sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });
    const { detalleCodigo } = req.body;
    if (!detalleCodigo) return res.status(400).json({ error: 'detalleCodigo requerido' });
    mov.detalleCodigo = detalleCodigo;
    mov.metodoAsignacion = 'manual';
    mov.asignadoPor = req.user.username;
    mov.asignadoEn = new Date();
    await mov.save();
    res.json(mov);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Resumen LINEA -> DETALLE por día ──────────────────────────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const { sociedad, desde, hasta, modo } = req.query;
    if (!sociedad || !desde || !hasta) return res.status(400).json({ error: 'Sociedad, desde y hasta requeridos' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const d1 = new Date(desde);
    const d2 = new Date(hasta); d2.setUTCHours(23, 59, 59, 999);

    const [movs, lineas, detalles, tcRows] = await Promise.all([
      FlujoMovimientoBancario.find({ sociedad, fecha: { $gte: d1, $lte: d2 } }).lean(),
      FlujoLinea.find({}).sort({ codigo: 1 }).lean(),
      FlujoDetalle.find({}).lean(),
      modo === 'soles' ? TipoCambio.find({ fecha: { $lte: d2 } }).sort({ fecha: 1 }).lean() : Promise.resolve([]),
    ]);

    const tcPorFecha = k => {
      // último TC conocido a esa fecha o antes
      let mejor = null;
      for (const t of tcRows) { if (t.fecha <= k) mejor = t; else break; }
      return mejor?.valor || null;
    };

    const detMap = Object.fromEntries(detalles.map(d => [d.codigo, d]));
    const ymd = f => f.toISOString().slice(0, 10);

    // clave: lineaCodigo|detalleCodigo|fecha -> monto
    const grid = {};
    const fechasSet = new Set();
    let sinAsignar = 0;

    for (const m of movs) {
      const fkey = ymd(m.fecha);
      fechasSet.add(fkey);
      if (!m.detalleCodigo) { sinAsignar++; continue; }
      const det = detMap[m.detalleCodigo];
      if (!det) continue;
      let importe = m.importe;
      if (modo === 'soles' && m.moneda === 'USD') {
        const tc = tcPorFecha(m.fecha);
        importe = tc ? importe * tc : importe;
      }
      const key = `${det.lineaCodigo}|${det.codigo}|${fkey}`;
      grid[key] = (grid[key] || 0) + importe;
    }

    const fechas = [...fechasSet].sort();
    const filas = lineas.map(linea => {
      const dets = detalles.filter(d => d.lineaCodigo === linea.codigo).map(det => ({
        codigo: det.codigo, nombre: det.nombre, tipo: det.tipo,
        valores: Object.fromEntries(fechas.map(f => [f, grid[`${linea.codigo}|${det.codigo}|${f}`] || 0])),
      }));
      return { codigo: linea.codigo, nombre: linea.nombre, detalles: dets };
    });

    res.json({ sociedad, fechas, filas, sinAsignar });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

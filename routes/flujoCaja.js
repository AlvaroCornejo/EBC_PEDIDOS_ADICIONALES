const express = require('express');
const auth    = require('../middleware/auth');

const FlujoLinea              = require('../models/FlujoLinea');
const FlujoDetalle            = require('../models/FlujoDetalle');
const FlujoSubdetalle         = require('../models/FlujoSubdetalle');
const FlujoCuentaBanco        = require('../models/FlujoCuentaBanco');
const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoGlosaRegla         = require('../models/FlujoGlosaRegla');
const FlujoProveedorDetalle   = require('../models/FlujoProveedorDetalle');
const FlujoSaldoInicial       = require('../models/FlujoSaldoInicial');
const FlujoPagoERP            = require('../models/FlujoPagoERP');
const TipoCambio              = require('../models/TipoCambio');

const { obtenerRutas, guardarRutas, reconciliar } = require('../utils/flujoCajaSync');

const router = express.Router();
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

// ── Config global (solo ADMIN) — 2 carpetas fijas, no por sociedad ───────────
router.get('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    res.json(await obtenerRutas());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { rutaEstadoCuenta, rutaPagosERP } = req.body;
    await guardarRutas({ rutaEstadoCuenta, rutaPagosERP });
    res.json(await obtenerRutas());
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
    const linea = await FlujoLinea.findById(req.params.id);
    if (!linea) return res.status(404).json({ error: 'No encontrada' });
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre requeridos' });

    if (codigo !== linea.codigo) {
      const dup = await FlujoLinea.findOne({ codigo, _id: { $ne: linea._id } }).lean();
      if (dup) return res.status(400).json({ error: `Ya existe una línea con código ${codigo}` });
      await FlujoDetalle.updateMany({ lineaCodigo: linea.codigo }, { lineaCodigo: codigo });
    }
    linea.codigo = codigo;
    linea.nombre = nombre;
    await linea.save();
    res.json(linea);
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
    const detalle = await FlujoDetalle.findById(req.params.id);
    if (!detalle) return res.status(404).json({ error: 'No encontrado' });
    const { codigo, nombre, tipo, lineaCodigo } = req.body;
    if (!codigo || !nombre || !tipo || !lineaCodigo) return res.status(400).json({ error: 'Datos incompletos' });

    if (codigo !== detalle.codigo) {
      const dup = await FlujoDetalle.findOne({ codigo, _id: { $ne: detalle._id } }).lean();
      if (dup) return res.status(400).json({ error: `Ya existe un detalle con código ${codigo}` });
      await FlujoSubdetalle.updateMany({ detalleCodigo: detalle.codigo }, { detalleCodigo: codigo });
    }
    detalle.codigo = codigo;
    detalle.nombre = nombre;
    detalle.tipo = tipo;
    detalle.lineaCodigo = lineaCodigo;
    await detalle.save();
    res.json(detalle);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/detalles/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoDetalle.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subdetalles', async (req, res) => {
  try { res.json(await FlujoSubdetalle.find({}).sort({ detalleCodigo: 1, codigo: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/subdetalles', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { codigo, nombre, detalleCodigo } = req.body;
    if (!codigo || !nombre || !detalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoSubdetalle.create({ codigo, nombre, detalleCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/subdetalles/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const sub = await FlujoSubdetalle.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: 'No encontrado' });
    const { codigo, nombre, detalleCodigo } = req.body;
    if (!codigo || !nombre || !detalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });

    if (codigo !== sub.codigo) {
      const dup = await FlujoSubdetalle.findOne({ codigo, _id: { $ne: sub._id } }).lean();
      if (dup) return res.status(400).json({ error: `Ya existe un subdetalle con código ${codigo}` });
      await Promise.all([
        FlujoGlosaRegla.updateMany({ subdetalleCodigo: sub.codigo }, { subdetalleCodigo: codigo }),
        FlujoProveedorDetalle.updateMany({ subdetalleCodigo: sub.codigo }, { subdetalleCodigo: codigo }),
        FlujoMovimientoBancario.updateMany({ subdetalleCodigo: sub.codigo }, { subdetalleCodigo: codigo }),
      ]);
    }
    sub.codigo = codigo;
    sub.nombre = nombre;
    sub.detalleCodigo = detalleCodigo;
    await sub.save();
    res.json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/subdetalles/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoSubdetalle.findByIdAndDelete(req.params.id);
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
    const { texto, criterio, subdetalleCodigo } = req.body;
    if (!texto || !criterio || !subdetalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoGlosaRegla.create({ texto, criterio, subdetalleCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/glosas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { texto, criterio, subdetalleCodigo } = req.body;
    const g = await FlujoGlosaRegla.findByIdAndUpdate(req.params.id, { texto, criterio, subdetalleCodigo }, { new: true });
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

// ── Proveedor -> Subdetalle (método 2) ─────────────────────────────────────────
router.get('/proveedores', async (req, res) => {
  try { res.json(await FlujoProveedorDetalle.find({}).sort({ beneficiario: 1 }).lean()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/proveedores', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { beneficiario, criterio, subdetalleCodigo } = req.body;
    if (!beneficiario || !subdetalleCodigo) return res.status(400).json({ error: 'Datos incompletos' });
    res.json(await FlujoProveedorDetalle.create({ beneficiario: beneficiario.trim().toUpperCase(), criterio: criterio || 'exacta', subdetalleCodigo }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/proveedores/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { beneficiario, criterio, subdetalleCodigo } = req.body;
    const update = { subdetalleCodigo };
    if (beneficiario !== undefined) update.beneficiario = beneficiario.trim().toUpperCase();
    if (criterio !== undefined) update.criterio = criterio;
    const p = await FlujoProveedorDetalle.findByIdAndUpdate(req.params.id, update, { new: true });
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

// ── Saldo Inicial (ancla del saldo corrido, una por cuenta bancaria: banco+moneda) ──
router.get('/saldo-inicial', async (req, res) => {
  try {
    const { sociedad } = req.query;
    if (!sociedad) return res.status(400).json({ error: 'Sociedad requerida' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });
    res.json(await FlujoSaldoInicial.find({ sociedad }).sort({ banco: 1, moneda: 1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/saldo-inicial', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    const { sociedad, banco, moneda, fecha, monto } = req.body;
    if (!sociedad || !banco || !moneda || !fecha || monto === undefined || monto === null) return res.status(400).json({ error: 'Datos incompletos' });
    const doc = await FlujoSaldoInicial.findOneAndUpdate(
      { sociedad, banco, moneda }, { fecha: new Date(fecha), monto }, { upsert: true, new: true }
    );
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/saldo-inicial/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoSaldoInicial.findByIdAndDelete(req.params.id);
    res.json({ success: true });
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

// ── Movimientos (nivel subdetalle) ─────────────────────────────────────────────
router.get('/movimientos', async (req, res) => {
  try {
    const { sociedad, banco, moneda, desde, hasta, sinAsignar } = req.query;
    if (!sociedad) return res.status(400).json({ error: 'Sociedad requerida' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const filter = { sociedad };
    if (banco) filter.banco = banco;
    if (moneda) filter.moneda = moneda;
    if (sinAsignar === 'true') filter.subdetalleCodigo = null;
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setUTCHours(23, 59, 59, 999); filter.fecha.$lte = h; }
    }

    const [movs, subdetalles, detalles, lineas] = await Promise.all([
      FlujoMovimientoBancario.find(filter).sort({ fecha: -1 }).limit(2000).lean(),
      FlujoSubdetalle.find({}).lean(),
      FlujoDetalle.find({}).lean(),
      FlujoLinea.find({}).lean(),
    ]);
    const subMap = Object.fromEntries(subdetalles.map(s => [s.codigo, s]));
    const detMap = Object.fromEntries(detalles.map(d => [d.codigo, d]));
    const lineaMap = Object.fromEntries(lineas.map(l => [l.codigo, l]));
    const out = movs.map(m => {
      const sub = m.subdetalleCodigo ? subMap[m.subdetalleCodigo] : null;
      const det = sub ? detMap[sub.detalleCodigo] : null;
      const linea = det ? lineaMap[det.lineaCodigo] : null;
      return {
        ...m,
        subdetalleNombre: sub?.nombre || null,
        detalleCodigo: det?.codigo || null, detalleNombre: det?.nombre || null,
        lineaCodigo: linea?.codigo || null, lineaNombre: linea?.nombre || null,
      };
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/movimientos/:id/asignar', async (req, res) => {
  try {
    const mov = await FlujoMovimientoBancario.findById(req.params.id);
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    if (!checkSocAccess(req.user, mov.sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });
    const { subdetalleCodigo } = req.body;
    if (!subdetalleCodigo) return res.status(400).json({ error: 'subdetalleCodigo requerido' });
    mov.subdetalleCodigo = subdetalleCodigo;
    mov.metodoAsignacion = 'manual';
    mov.asignadoPor = req.user.username;
    mov.asignadoEn = new Date();
    await mov.save();
    res.json(mov);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Resumen LINEA -> DETALLE -> SUBDETALLE por día/semana/mes ──────────────────
router.get('/resumen', async (req, res) => {
  try {
    const { sociedad, desde, hasta, modo, agrupacion, banco, moneda } = req.query;
    if (!sociedad || !desde || !hasta) return res.status(400).json({ error: 'Sociedad, desde y hasta requeridos' });
    if (!checkSocAccess(req.user, sociedad)) return res.status(403).json({ error: 'Sin acceso a esta sociedad' });

    const d1 = new Date(desde);
    const d2 = new Date(hasta); d2.setUTCHours(23, 59, 59, 999);
    const movFilter = { sociedad, fecha: { $gte: d1, $lte: d2 } };
    if (banco) movFilter.banco = banco;
    if (moneda) movFilter.moneda = moneda;
    const saldoFilter = { sociedad };
    if (banco) saldoFilter.banco = banco;
    if (moneda) saldoFilter.moneda = moneda;

    const [movs, lineas, detalles, subdetalles, tcRows, saldoDocs, cuentasBanco, pagosErpAll] = await Promise.all([
      FlujoMovimientoBancario.find(movFilter).lean(),
      FlujoLinea.find({}).sort({ codigo: 1 }).lean(),
      FlujoDetalle.find({}).lean(),
      FlujoSubdetalle.find({}).lean(),
      modo === 'soles' ? TipoCambio.find({ fecha: { $lte: d2 } }).sort({ fecha: 1 }).lean() : Promise.resolve([]),
      FlujoSaldoInicial.find(saldoFilter).lean(),
      FlujoCuentaBanco.find({ sociedad }).lean(),
      FlujoPagoERP.find({ sociedad }).lean(),
    ]);

    const tcPorFecha = k => {
      // último TC conocido a esa fecha o antes
      let mejor = null;
      for (const t of tcRows) { if (t.fecha <= k) mejor = t; else break; }
      return mejor?.valor || null;
    };
    const convertir = m => {
      let importe = m.importe;
      if (modo === 'soles' && m.moneda === 'USD') {
        const tc = tcPorFecha(m.fecha);
        importe = tc ? importe * tc : importe;
      }
      return importe;
    };

    // Detalle de un pago ERP "masivo": varias filas del ERP con el mismo
    // (cuentaBancaria, numeroPago) se agrupan en un solo movimiento bancario —
    // se arma aquí el desglose por beneficiario para el drill-down del método 2.
    const cuentaBancoMap = Object.fromEntries(cuentasBanco.map(c => [`${c.banco}|${c.moneda}`, c.cuentaBancaria]));
    const pagosPorGrupo = {};
    for (const p of pagosErpAll) {
      const key = `${p.cuentaBancaria}|${p.numeroPago}`;
      if (!pagosPorGrupo[key]) pagosPorGrupo[key] = [];
      pagosPorGrupo[key].push(p);
    }
    const pagosErpDe = m => {
      if (m.metodoAsignacion !== 'erp' || !m.numeroOperacion) return [];
      const cuentaBancaria = cuentaBancoMap[`${m.banco}|${m.moneda}`];
      const numOp = parseInt(m.numeroOperacion, 10);
      if (!cuentaBancaria || !Number.isFinite(numOp)) return [];
      const grupo = pagosPorGrupo[`${cuentaBancaria}|${numOp}`] || [];
      return grupo.map(p => ({ pagarA: p.pagarA, montoLocal: p.montoLocal, montoExtranjero: p.montoExtranjero, tipoPago: p.tipoPago, voucherPago: p.voucherPago }));
    };

    const subMap = Object.fromEntries(subdetalles.map(s => [s.codigo, s]));
    const ymd = f => f.toISOString().slice(0, 10);
    // Clave de agrupación de columnas: día (exacta), lunes de la semana ISO, o día 1 del mes.
    // Siempre una fecha ISO válida (para que fmtFechaCorta del frontend siga funcionando igual).
    const periodKey = f => {
      if (agrupacion === 'mes') return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1)).toISOString().slice(0, 10);
      if (agrupacion === 'semana') {
        const d = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()));
        const dow = d.getUTCDay() || 7; // domingo(0) -> 7
        if (dow !== 1) d.setUTCDate(d.getUTCDate() - (dow - 1));
        return d.toISOString().slice(0, 10);
      }
      return ymd(f);
    };

    // clave: lineaCodigo|detalleCodigo|subdetalleCodigo|fecha -> monto
    const grid = {};
    // subdetalleCodigo -> glosa -> { valores:{fecha:monto}, movimientos:[] } — drill-down MOVIMIENTO
    const glosasPorSub = {};
    const fechasSet = new Set();
    // "banco|moneda" -> fecha -> monto (TODOS los movimientos de esa cuenta, asignados o
    // no — para el saldo corrido real, que no distingue si el movimiento fue clasificado)
    const totalMovDiaCuenta = {};
    let sinAsignar = 0;

    for (const m of movs) {
      const fkey = periodKey(m.fecha);
      fechasSet.add(fkey);
      const importe = convertir(m);
      const cuentaKey = `${m.banco}|${m.moneda}`;
      if (!totalMovDiaCuenta[cuentaKey]) totalMovDiaCuenta[cuentaKey] = {};
      totalMovDiaCuenta[cuentaKey][fkey] = (totalMovDiaCuenta[cuentaKey][fkey] || 0) + importe;

      const sub = m.subdetalleCodigo ? subMap[m.subdetalleCodigo] : null;
      if (!sub) { sinAsignar++; continue; }
      const det = detalles.find(d => d.codigo === sub.detalleCodigo);
      if (!det) continue;
      const key = `${det.lineaCodigo}|${det.codigo}|${sub.codigo}|${fkey}`;
      grid[key] = (grid[key] || 0) + importe;

      const glosaKey = (m.glosa || '').trim() || '(sin glosa)';
      if (!glosasPorSub[sub.codigo]) glosasPorSub[sub.codigo] = {};
      if (!glosasPorSub[sub.codigo][glosaKey]) glosasPorSub[sub.codigo][glosaKey] = { valores: {}, movimientos: [] };
      const g = glosasPorSub[sub.codigo][glosaKey];
      g.valores[fkey] = (g.valores[fkey] || 0) + importe;
      g.movimientos.push({
        _id: m._id, fecha: fkey, fechaReal: ymd(m.fecha), banco: m.banco, moneda: m.moneda,
        numeroOperacion: m.numeroOperacion || null, glosa: m.glosa || '', proveedor: m.proveedor || '', importe,
        pagosErp: pagosErpDe(m),
      });
    }

    const fechas = [...fechasSet].sort();
    const filas = lineas.map(linea => {
      const dets = detalles.filter(d => d.lineaCodigo === linea.codigo).map(det => {
        const subs = subdetalles.filter(s => s.detalleCodigo === det.codigo).map(sub => {
          const gmap = glosasPorSub[sub.codigo] || {};
          const glosas = Object.entries(gmap)
            .map(([glosa, g]) => ({
              glosa, valores: g.valores,
              movimientos: g.movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha)),
            }))
            .sort((a, b) => a.glosa.localeCompare(b.glosa));
          return {
            codigo: sub.codigo, nombre: sub.nombre,
            valores: Object.fromEntries(fechas.map(f => [f, grid[`${linea.codigo}|${det.codigo}|${sub.codigo}|${f}`] || 0])),
            glosas,
          };
        });
        return { codigo: det.codigo, nombre: det.nombre, tipo: det.tipo, subdetalles: subs };
      });
      return { codigo: linea.codigo, nombre: linea.nombre, detalles: dets };
    });

    // Saldo corrido por cuenta bancaria (banco+moneda): para cada cuenta con saldo
    // inicial registrado en o antes de "desde", se arrastra sumando los movimientos
    // de esa cuenta día a día (incluye los sin asignar, ya que el saldo real del
    // banco no distingue si el movimiento fue clasificado). El combinado (todas las
    // cuentas juntas) es lo que se muestra por defecto; el detalle por cuenta queda
    // disponible para el drill-down.
    const cuentasSaldo = [];
    for (const doc of saldoDocs) {
      const anchorDate = new Date(doc.fecha);
      if (anchorDate > d1) continue; // ancla posterior al rango consultado — fuera de alcance
      let baseSaldo = doc.monto;
      if (anchorDate < d1) {
        const gapMovs = await FlujoMovimientoBancario.find({
          sociedad, banco: doc.banco, moneda: doc.moneda, fecha: { $gte: anchorDate, $lt: d1 },
        }).lean();
        for (const m of gapMovs) baseSaldo += convertir(m);
      }
      const cuentaKey = `${doc.banco}|${doc.moneda}`;
      const porFecha = {};
      let corrido = baseSaldo;
      for (const f of fechas) {
        const inicial = corrido;
        const final = inicial + (totalMovDiaCuenta[cuentaKey]?.[f] || 0);
        porFecha[f] = { inicial, final };
        corrido = final;
      }
      cuentasSaldo.push({ banco: doc.banco, moneda: doc.moneda, fechaAncla: ymd(anchorDate), montoAncla: doc.monto, porFecha });
    }

    let saldoPorFecha = null;
    if (cuentasSaldo.length) {
      saldoPorFecha = {};
      for (const f of fechas) {
        saldoPorFecha[f] = {
          inicial: cuentasSaldo.reduce((s, c) => s + c.porFecha[f].inicial, 0),
          final: cuentasSaldo.reduce((s, c) => s + c.porFecha[f].final, 0),
        };
      }
    }

    res.json({ sociedad, fechas, filas, sinAsignar, cuentasSaldo, saldoPorFecha });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');

const FlujoCajaLinea       = require('../models/FlujoCajaLinea');
const FlujoCajaCuenta      = require('../models/FlujoCajaCuenta');
const FlujoCajaMovBancario = require('../models/FlujoCajaMovBancario');
const FlujoCajaProveedor   = require('../models/FlujoCajaProveedor');
const FlujoCajaOperacion   = require('../models/FlujoCajaOperacion');
const TipoCambio           = require('../models/TipoCambio');

router.use(auth);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = '__BASE__';

// Debe reflejar ALL_SOCS_COMPRA en public/app.js
const ALL_SOCS = ['ERSAC', 'FRQ1', 'GB', 'MUVON', 'QUIASMO', 'FACTORIAL K'];

function requireFlujoAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.rolPago) return next();
  return res.status(403).json({ error: 'Sin acceso a Flujo de Caja' });
}
router.use(requireFlujoAccess);

function isAdmin(req) { return req.user.role === 'ADMIN'; }

/** Sociedades autorizadas del usuario (null = todas, admin) */
function socsUsuario(user) {
  if (user.role === 'ADMIN' || user.rolPago === 'admin') return null;
  return (user.sociedadesPago || []);
}

function checkSocAccess(user, compania) {
  if (compania === BASE) return user.role === 'ADMIN';   // solo ADMIN ve/edita la base
  const socs = socsUsuario(user);
  if (socs === null) return true;
  return socs.includes(compania);
}

/** Semana ISO (igual que en routes/pagos.js) */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}

// ── Líneas del flujo (estructura base + por sociedad) ─────────────────────────

// GET /lineas?compania=X
router.get('/lineas', async (req, res) => {
  try {
    const compania = req.query.compania;
    if (!compania) return res.status(400).json({ error: 'Falta compania' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });
    const lineas = await FlujoCajaLinea.find({ compania }).sort({ seccion: 1, orden: 1 }).lean();
    res.json(lineas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /lineas  — crea una línea. Si compania==='__BASE__', se propaga automáticamente
// a todas las sociedades (crea la línea hija enlazada con baseLineaId).
router.post('/lineas', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const { compania, seccion, nombre, orden, baseLineaId } = req.body;
    if (!compania || !seccion || !nombre?.trim())
      return res.status(400).json({ error: 'Faltan campos: compania, seccion, nombre' });
    if (!FlujoCajaLinea.SECCIONES.includes(seccion))
      return res.status(400).json({ error: 'Sección inválida' });

    if (compania === BASE) {
      const base = await FlujoCajaLinea.create({
        compania: BASE, seccion, nombre: nombre.trim(),
        orden: Number(orden) || 0, baseLineaId: null,
      });
      // Propagar a todas las sociedades que aún no tengan una línea ligada a esta base
      for (const soc of ALL_SOCS) {
        const existe = await FlujoCajaLinea.findOne({ compania: soc, baseLineaId: base._id });
        if (!existe) {
          await FlujoCajaLinea.create({
            compania: soc, seccion, nombre: nombre.trim(),
            orden: Number(orden) || 0, baseLineaId: base._id,
          });
        }
      }
      return res.json(base);
    }

    // Línea de sociedad: requiere baseLineaId obligatorio (debe ser una línea __BASE__ existente)
    if (!baseLineaId) return res.status(400).json({ error: 'Debe seleccionar una línea base para enlazar' });
    const baseLinea = await FlujoCajaLinea.findOne({ _id: baseLineaId, compania: BASE });
    if (!baseLinea) return res.status(400).json({ error: 'Línea base no encontrada' });

    const linea = await FlujoCajaLinea.create({
      compania, seccion, nombre: nombre.trim(),
      orden: Number(orden) || 0, baseLineaId: baseLinea._id,
    });
    res.json(linea);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe una línea con esos datos' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /lineas/:id
router.put('/lineas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const linea = await FlujoCajaLinea.findById(req.params.id);
    if (!linea) return res.status(404).json({ error: 'No encontrada' });
    const { nombre, orden, seccion, activa } = req.body;
    if (nombre !== undefined) linea.nombre = String(nombre).trim();
    if (orden  !== undefined) linea.orden  = Number(orden) || 0;
    if (activa !== undefined) linea.activa = !!activa;
    if (seccion !== undefined) {
      if (!FlujoCajaLinea.SECCIONES.includes(seccion)) return res.status(400).json({ error: 'Sección inválida' });
      linea.seccion = seccion;
    }
    await linea.save();
    res.json(linea);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /lineas/:id  — solo si no tiene líneas hijas dependientes (caso __BASE__)
router.delete('/lineas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const linea = await FlujoCajaLinea.findById(req.params.id);
    if (!linea) return res.status(404).json({ error: 'No encontrada' });
    if (linea.compania === BASE) {
      const hijas = await FlujoCajaLinea.countDocuments({ baseLineaId: linea._id });
      if (hijas > 0) return res.status(400).json({ error: `No se puede eliminar: hay ${hijas} línea(s) de sociedad enlazadas. Desactívela en su lugar.` });
    }
    await linea.deleteOne();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cuentas bancarias (con saldo inicial) ─────────────────────────────────────

router.get('/cuentas', async (req, res) => {
  try {
    const compania = req.query.compania;
    if (!compania) return res.status(400).json({ error: 'Falta compania' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });
    const cuentas = await FlujoCajaCuenta.find({ compania }).sort({ banco: 1, moneda: 1 }).lean();
    res.json(cuentas);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cuentas', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const { compania, banco, moneda, numeroCuenta, alias, saldoInicial, fechaSaldoInicial } = req.body;
    if (!compania || !banco || !moneda) return res.status(400).json({ error: 'Faltan campos: compania, banco, moneda' });
    if (!['SOL','USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    const cuenta = await FlujoCajaCuenta.create({
      compania, banco, moneda,
      numeroCuenta: numeroCuenta || '', alias: alias || '',
      saldoInicial: parseFloat(saldoInicial) || 0,
      fechaSaldoInicial: fechaSaldoInicial ? new Date(fechaSaldoInicial) : null,
    });
    res.json(cuenta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/cuentas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const cuenta = await FlujoCajaCuenta.findById(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'No encontrada' });
    const { banco, moneda, numeroCuenta, alias, saldoInicial, fechaSaldoInicial, activa } = req.body;
    if (banco             !== undefined) cuenta.banco = banco;
    if (moneda            !== undefined) {
      if (!['SOL','USD'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
      cuenta.moneda = moneda;
    }
    if (numeroCuenta      !== undefined) cuenta.numeroCuenta = numeroCuenta;
    if (alias             !== undefined) cuenta.alias = alias;
    if (saldoInicial      !== undefined) cuenta.saldoInicial = parseFloat(saldoInicial) || 0;
    if (fechaSaldoInicial !== undefined) cuenta.fechaSaldoInicial = fechaSaldoInicial ? new Date(fechaSaldoInicial) : null;
    if (activa            !== undefined) cuenta.activa = !!activa;
    await cuenta.save();
    res.json(cuenta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/cuentas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    await FlujoCajaCuenta.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Tablas de mapeo (genérico) ────────────────────────────────────────────────
// Las 3 tablas comparten la forma {compania, <clave...>, lineaId}; se exponen con
// rutas específicas para que el front sea explícito, pero comparten la lógica CRUD.

function registrarMapeoCRUD(path, Model, camposClave) {
  // GET /:path?compania=X
  router.get(`/${path}`, async (req, res) => {
    try {
      const compania = req.query.compania;
      if (!compania) return res.status(400).json({ error: 'Falta compania' });
      if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });
      const rows = await Model.find({ compania }).populate('lineaId', 'nombre seccion').lean();
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /:path
  router.post(`/${path}`, async (req, res) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
      const { compania, lineaId } = req.body;
      if (!compania || !lineaId) return res.status(400).json({ error: 'Faltan campos: compania, lineaId' });
      const data = { compania, lineaId };
      for (const c of camposClave) {
        if (!req.body[c]?.toString().trim()) return res.status(400).json({ error: `Falta campo: ${c}` });
        data[c] = req.body[c].toString().trim();
      }
      const row = await Model.create(data);
      res.json(row);
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'Ya existe un registro con esos datos' });
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /:path/:id
  router.put(`/${path}/:id`, async (req, res) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
      const row = await Model.findById(req.params.id);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      if (req.body.lineaId !== undefined) row.lineaId = req.body.lineaId;
      for (const c of camposClave) {
        if (req.body[c] !== undefined) row[c] = req.body[c].toString().trim();
      }
      await row.save();
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /:path/:id
  router.delete(`/${path}/:id`, async (req, res) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
      await Model.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

registrarMapeoCRUD('mov-bancario', FlujoCajaMovBancario, ['cuentaId', 'numeroOperacion']);
registrarMapeoCRUD('proveedores',  FlujoCajaProveedor,   ['nombreProveedor']);
registrarMapeoCRUD('operaciones',  FlujoCajaOperacion,   ['descripcion']);

// ── Tipo de cambio (global, manual) ───────────────────────────────────────────

router.get('/tipo-cambio', async (req, res) => {
  try {
    const rows = await TipoCambio.find().sort({ fecha: -1 }).lean();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tipo-cambio', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const { fecha, valor } = req.body;
    if (!fecha || valor === undefined || valor === '') return res.status(400).json({ error: 'Faltan campos: fecha, valor' });
    const row = await TipoCambio.findOneAndUpdate(
      { fecha: new Date(fecha) },
      { fecha: new Date(fecha), valor: parseFloat(valor), actualizadoPor: req.user.username },
      { upsert: true, new: true }
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tipo-cambio/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const row = await TipoCambio.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    const { fecha, valor } = req.body;
    if (fecha !== undefined) row.fecha = new Date(fecha);
    if (valor !== undefined) row.valor = parseFloat(valor);
    row.actualizadoPor = req.user.username;
    await row.save();
    res.json(row);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Ya existe un tipo de cambio para esa fecha' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tipo-cambio/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    await TipoCambio.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Busca el tipo de cambio vigente más cercano (≤) a una fecha dada; si no hay, el más antiguo posterior */
async function tipoCambioVigente(fecha) {
  const d = new Date(fecha);
  let tc = await TipoCambio.findOne({ fecha: { $lte: d } }).sort({ fecha: -1 }).lean();
  if (!tc) tc = await TipoCambio.findOne({ fecha: { $gte: d } }).sort({ fecha: 1 }).lean();
  return tc ? tc.valor : null;
}

// ── Resumen / Grilla del flujo de caja ────────────────────────────────────────
// GET /resumen?companias=A,B&moneda=SOL|USD|COMBO&granularidad=semana|mes&periodos=12

router.get('/resumen', async (req, res) => {
  try {
    const companias = String(req.query.companias || '').split(',').map(s => s.trim()).filter(Boolean);
    const moneda       = (req.query.moneda || 'SOL').toUpperCase();        // SOL | USD | COMBO
    const granularidad = (req.query.granularidad || 'semana').toLowerCase(); // semana | mes
    const numPeriodos  = Math.min(Math.max(parseInt(req.query.periodos) || 12, 1), 52);

    if (!companias.length) return res.status(400).json({ error: 'Debe indicar al menos una sociedad' });
    if (!['SOL','USD','COMBO'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    for (const c of companias) {
      if (!checkSocAccess(req.user, c)) return res.status(403).json({ error: `Sin acceso a ${c}` });
    }

    // ── Periodos (columnas) ──
    const hoy = new Date();
    const periodos = [];
    if (granularidad === 'mes') {
      for (let i = 0; i < numPeriodos; i++) {
        const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() + i, 1));
        periodos.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`,
                        label: d.toLocaleDateString('es-PE', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
      }
    } else {
      // semanas ISO a partir de la semana actual
      const base = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
      for (let i = 0; i < numPeriodos; i++) {
        const d = new Date(base); d.setUTCDate(d.getUTCDate() + i * 7);
        periodos.push({ key: `${d.getUTCFullYear()}-W${String(isoWeek(d)).padStart(2,'0')}`,
                        label: `Sem ${isoWeek(d)}/${d.getUTCFullYear()}` });
      }
    }

    // ── Estructura de líneas (consolidando por línea base si hay >1 sociedad) ──
    const lineasBase = await FlujoCajaLinea.find({ compania: BASE, activa: true }).sort({ seccion: 1, orden: 1 }).lean();
    const lineasSoc  = await FlujoCajaLinea.find({ compania: { $in: companias }, activa: true }).sort({ seccion: 1, orden: 1 }).lean();

    let filas;
    if (companias.length > 1) {
      // Consolidado: una fila por línea base; agrupa todas las líneas de sociedad que la referencian
      filas = lineasBase.map(b => ({
        id: String(b._id), nombre: b.nombre, seccion: b.seccion, orden: b.orden,
        lineasHijas: lineasSoc.filter(l => String(l.baseLineaId) === String(b._id)).map(l => l._id),
      }));
      // Líneas de sociedad sin línea base activa visible (caso límite) → las agrega sueltas
    } else {
      filas = lineasSoc.map(l => ({ id: String(l._id), nombre: l.nombre, seccion: l.seccion, orden: l.orden, lineasHijas: [l._id] }));
    }

    // ── Saldo inicial real desde las cuentas bancarias ──
    const cuentas = await FlujoCajaCuenta.find({ compania: { $in: companias }, activa: true }).lean();
    let saldoInicialTotal = 0;
    for (const cta of cuentas) {
      if (moneda === 'SOL'  && cta.moneda !== 'SOL') continue;
      if (moneda === 'USD'  && cta.moneda !== 'USD') continue;
      let monto = cta.saldoInicial || 0;
      if (moneda === 'COMBO' && cta.moneda === 'USD') {
        const tc = await tipoCambioVigente(cta.fechaSaldoInicial || hoy);
        if (tc == null) continue;   // sin tipo de cambio cargado: se omite (se podría avisar en el front)
        monto = monto * tc;
      }
      saldoInicialTotal += monto;
    }

    // ── Armar grilla: por ahora solo SALDO_INICIAL trae datos reales; el resto
    //    queda en 0 (no hay movimientos conciliados ni proyección todavía — 2da entrega) ──
    const grilla = filas.map(f => {
      const valores = periodos.map((_, i) => {
        if (f.seccion === 'SALDO_INICIAL' && i === 0) return saldoInicialTotal;
        return 0;
      });
      return { id: f.id, nombre: f.nombre, seccion: f.seccion, valores };
    });

    // SALDO_FINAL = inicial + ingresos - egresos ± otros ± por identificar (queda la fórmula lista)
    const sumaSeccion = (sec, periodoIdx) =>
      grilla.filter(f => f.seccion === sec).reduce((s, f) => s + (f.valores[periodoIdx] || 0), 0);

    grilla.filter(f => f.seccion === 'SALDO_FINAL').forEach(f => {
      periodos.forEach((_, i) => {
        f.valores[i] = sumaSeccion('SALDO_INICIAL', i) + sumaSeccion('INGRESOS', i)
                     - sumaSeccion('EGRESOS', i) + sumaSeccion('OTROS', i) + sumaSeccion('POR_IDENTIFICAR', i);
      });
    });

    res.json({ periodos, secciones: FlujoCajaLinea.SECCIONES, filas: grilla, moneda, granularidad });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

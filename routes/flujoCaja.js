const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const multer   = require('multer');
const ExcelJS  = require('exceljs');

const FlujoCajaLinea       = require('../models/FlujoCajaLinea');
const FlujoCajaCuenta      = require('../models/FlujoCajaCuenta');
const FlujoCajaMovBancario = require('../models/FlujoCajaMovBancario');
const FlujoCajaProveedor   = require('../models/FlujoCajaProveedor');
const FlujoCajaOperacion   = require('../models/FlujoCajaOperacion');
const FlujoCajaAsignacion  = require('../models/FlujoCajaAsignacion');
const TipoCambio           = require('../models/TipoCambio');
const EstadoCuenta         = require('../models/EstadoCuenta');
const PagoERP              = require('../models/PagoERP');
const CompaniaCodigo       = require('../models/CompaniaCodigo');

const upload = multer({ storage: multer.memoryStorage() });

router.use(auth);

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// POST /lineas  — crea una línea directamente para la sociedad indicada
router.post('/lineas', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const { compania, seccion, nombre, orden, tipoActividad, esManual } = req.body;
    if (!compania || !seccion || !nombre?.trim())
      return res.status(400).json({ error: 'Faltan campos: compania, seccion, nombre' });
    if (!FlujoCajaLinea.SECCIONES.includes(seccion))
      return res.status(400).json({ error: 'Sección inválida' });
    if (tipoActividad !== undefined && tipoActividad !== '' && !FlujoCajaLinea.TIPOS_ACTIVIDAD.includes(tipoActividad))
      return res.status(400).json({ error: 'Tipo de actividad inválido' });
    const tipoAct = FlujoCajaLinea.TIPOS_ACTIVIDAD.includes(tipoActividad) ? tipoActividad : 'OPERACION';
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });

    const linea = await FlujoCajaLinea.create({
      compania, seccion, nombre: nombre.trim(),
      orden: Number(orden) || 0, tipoActividad: tipoAct, esManual: !!esManual,
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
    const { nombre, orden, seccion, activa, tipoActividad, esManual } = req.body;
    if (nombre    !== undefined) linea.nombre    = String(nombre).trim();
    if (orden     !== undefined) linea.orden     = Number(orden) || 0;
    if (activa    !== undefined) linea.activa    = !!activa;
    if (esManual  !== undefined) linea.esManual  = !!esManual;
    if (seccion !== undefined) {
      if (!FlujoCajaLinea.SECCIONES.includes(seccion)) return res.status(400).json({ error: 'Sección inválida' });
      linea.seccion = seccion;
    }
    if (tipoActividad !== undefined) {
      if (!FlujoCajaLinea.TIPOS_ACTIVIDAD.includes(tipoActividad)) return res.status(400).json({ error: 'Tipo de actividad inválido' });
      linea.tipoActividad = tipoActividad;
    }
    await linea.save();
    res.json(linea);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /lineas/:id  — limpia también los mapeos que la referencian
router.delete('/lineas/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo ADMIN' });
    const linea = await FlujoCajaLinea.findById(req.params.id);
    if (!linea) return res.status(404).json({ error: 'No encontrada' });
    await Promise.all([
      FlujoCajaMovBancario.deleteMany({ lineaId: linea._id }),
      FlujoCajaProveedor.deleteMany({ lineaId: linea._id }),
      FlujoCajaOperacion.deleteMany({ lineaId: linea._id }),
    ]);
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

    // ── Estructura de líneas por sociedad (excluye líneas de asignación manual) ──
    const lineasSoc = await FlujoCajaLinea.find({ compania: { $in: companias }, activa: true, esManual: { $ne: true } }).sort({ seccion: 1, orden: 1 }).lean();
    const filas = lineasSoc.map(l => ({ id: String(l._id), nombre: l.nombre, seccion: l.seccion, orden: l.orden,
      tipoActividad: l.tipoActividad || 'OPERACION', lineasHijas: [l._id] }));

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
      return { id: f.id, nombre: f.nombre, seccion: f.seccion, tipoActividad: f.tipoActividad, valores };
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

// ── Helpers de parseo ─────────────────────────────────────────────────────────

function isHtmlBuffer(buffer) {
  return /^\s*</.test(buffer.slice(0, 50).toString('ascii'));
}

function parseBbvaHtml(buffer) {
  const text = buffer.toString('latin1');
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(text)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    const vals = cells.map(c =>
      c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
           .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    );
    if (vals.some(v => v)) rows.push(vals);
  }

  let numeroCuenta = '', moneda = 'SOL', dataStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const full = rows[i].join(' ');
    if (full.includes('Cuenta Actual:')) {
      const am = full.match(/Cuenta Actual:\s*(\d+)/);
      if (am) numeroCuenta = am[1].slice(-8);
    }
    if (full.includes('Importes en:')) {
      moneda = full.includes('USD') ? 'USD' : 'SOL';
    }
    if (rows[i].some(v => /F\.\s*Operaci/i.test(v))) { dataStart = i + 1; break; }
  }

  const transacciones = [];
  for (let i = Math.max(0, dataStart); i < rows.length; i++) {
    const r = rows[i];
    const fechaStr = (r[0] || '').trim();
    if (!fechaStr.match(/^\d{2}-\d{2}-\d{4}$/)) continue;
    const [day, month, year] = fechaStr.split('-').map(Number);
    const fecha = new Date(Date.UTC(year, month - 1, day));
    const codigo  = (r[2] || '').trim();
    const nroDoc  = (r[3] || '').trim();
    const concepto = (r[4] || '').trim();
    if (!nroDoc || /^saldo/i.test(concepto)) continue;
    const importe = parseFloat((r[5] || '0').replace(/,/g, '')) || 0;
    transacciones.push({ fecha, codigo, nroDoc, concepto, importe });
  }
  return { numeroCuenta, moneda, banco: 'BBVA', transacciones };
}

async function parseXlsxEECC(buffer, banco) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const trxs = [];
  let primera = true;
  ws.eachRow({ includeEmpty: false }, row => {
    if (primera) { primera = false; return; }
    const v = row.values;
    try {
      if (banco === 'BBVA') {
        if (!v[1]) return;
        const nroDoc = String(v[4] || '').trim();
        if (!nroDoc) return;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc, concepto: String(v[5] || '').trim(), importe: parseFloat(v[6]) || 0 });
      } else if (banco === 'BCP') {
        if (!v[1] || !v[7]) return;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc: String(v[7]).trim(), concepto: String(v[3] || '').trim(), importe: parseFloat(v[4]) || 0 });
      } else if (banco === 'IBK') {
        if (!v[1] || !v[3]) return;
        const nroDoc = String(v[3]).trim();
        if (!nroDoc || nroDoc === '-') return;
        const cargo = parseFloat(v[7]) || 0, abono = parseFloat(v[8]) || 0;
        trxs.push({ fecha: v[1] instanceof Date ? v[1] : null,
                    nroDoc, concepto: String(v[4] || v[5] || '').trim(),
                    importe: cargo !== 0 ? cargo : abono });
      }
    } catch (_) {}
  });
  return trxs;
}

function parseERPCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = []; let cur = '', inQ = false;
    for (const ch of line + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    const o = {};
    headers.forEach((h, i) => { o[h] = (vals[i] || '').trim(); });
    return o;
  }).filter(r => r['NumeroProceso']);
}

function parseFechaERP(str) {
  if (!str) return null;
  const [datePart] = str.split(' ');
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ── POST /eecc/cargar ─────────────────────────────────────────────────────────

router.post('/eecc/cargar', upload.single('archivo'), async (req, res) => {
  try {
    const { compania, banco: bancoBody, moneda: monedaBody } = req.body;
    if (!compania || !req.file) return res.status(400).json({ error: 'Faltan compania o archivo' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });

    let banco, moneda, transacciones, numeroCuenta;

    if (isHtmlBuffer(req.file.buffer)) {
      // BBVA HTML-XLS: auto-detectar cuenta, moneda
      const parsed = parseBbvaHtml(req.file.buffer);
      banco = 'BBVA';
      moneda = parsed.moneda;
      numeroCuenta = parsed.numeroCuenta;
      transacciones = parsed.transacciones;
    } else {
      // XLSX real: usuario selecciona banco y moneda
      if (!bancoBody || !monedaBody) return res.status(400).json({ error: 'Para archivos XLSX indique banco y moneda' });
      banco  = bancoBody;
      moneda = monedaBody;
      transacciones = await parseXlsxEECC(req.file.buffer, banco);
      // Intentar obtener numeroCuenta desde FlujoCajaCuenta
      const cta = await FlujoCajaCuenta.findOne({ compania, banco, moneda }).lean();
      numeroCuenta = cta?.numeroCuenta || '';
    }

    await EstadoCuenta.findOneAndUpdate(
      { compania, banco, moneda },
      { compania, banco, moneda, numeroCuenta, cargadoPor: req.user.username, cargadoEn: new Date(), transacciones },
      { upsert: true, new: true }
    );

    // Alias de la cuenta para feedback
    const cta = await FlujoCajaCuenta.findOne({ compania, banco, moneda }).lean();
    res.json({ ok: true, count: transacciones.length, banco, moneda, numeroCuenta, alias: cta?.alias || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /pagos-erp/cargar ────────────────────────────────────────────────────

router.post('/pagos-erp/cargar', upload.single('archivo'), async (req, res) => {
  try {
    const { compania } = req.body;
    if (!compania || !req.file) return res.status(400).json({ error: 'Faltan compania o archivo' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });

    const rows = parseERPCsv(req.file.buffer);
    const ahora = new Date();
    const docs = rows.map(r => ({
      compania,
      companiaCode:   r['CompaniaSocio']             || '',
      cuentaBancaria: r['CuentaBancaria']             || '',
      numeroProceso:  parseInt(r['NumeroProceso'])    || 0,
      secuencia:      parseInt(r['Secuencia'])        || 0,
      numeroPago:     parseInt(r['NumeroPago'])       || 0,
      pagarA:         r['PagarA']                     || '',
      moneda:         r['MonedaPago']                 || '',
      fechaPago:      parseFechaERP(r['FechaPago']),
      pagoLocal:      parseFloat(r['PagoMonedaLocal'])       || 0,
      pagoExtranjero: parseFloat(r['PagoMonedaExtranjera'])  || 0,
      tipoPago:       r['TipoPago']    || '',
      voucher:        r['VoucherPago'] || '',
      cargadoEn:      ahora,
    }));

    await PagoERP.deleteMany({ compania });
    await PagoERP.insertMany(docs, { ordered: false });

    const cuentas = [...new Set(docs.map(d => d.cuentaBancaria).filter(Boolean))];
    res.json({ ok: true, total: docs.length, cuentas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /conciliacion ─────────────────────────────────────────────────────────

router.get('/conciliacion', async (req, res) => {
  try {
    const { compania, banco, moneda } = req.query;
    if (!compania || !banco || !moneda) return res.status(400).json({ error: 'Faltan compania, banco, moneda' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });

    const eecc = await EstadoCuenta.findOne({ compania, banco, moneda }).lean();
    if (!eecc) return res.json({ transacciones: [], soloERP: [], lineas: [], stats: { total: 0, conciliados: 0, soloEECC: 0, soloERP: 0, sinLinea: 0, nuevosProveedores: 0, nuevasOperaciones: 0 }, cargadoEn: null });

    const cuenta = await FlujoCajaCuenta.findOne({ compania, banco, moneda }).lean();
    const numeroCuenta = eecc.numeroCuenta || cuenta?.numeroCuenta || '';
    const cuentaId     = cuenta?._id || null;

    const monedaERP = moneda === 'USD' ? 'EX' : 'LO';
    const [pagos, movBancarios, proveedores, operaciones, lineas, asignaciones] = await Promise.all([
      PagoERP.find({ compania, cuentaBancaria: numeroCuenta, moneda: monedaERP }).lean(),
      cuentaId ? FlujoCajaMovBancario.find({ compania, cuentaId }).lean() : [],
      FlujoCajaProveedor.find({ compania }).lean(),
      FlujoCajaOperacion.find({ compania }).lean(),
      FlujoCajaLinea.find({ compania, activa: true }).select('nombre seccion orden esManual').lean(),
      FlujoCajaAsignacion.find({ compania, banco, moneda }).lean(),
    ]);

    const lineaMap  = new Map(lineas.map(l => [String(l._id), l]));
    const movBanMap = new Map(movBancarios.map(m => [m.numeroOperacion.trim(), m]));
    const provMap   = new Map(proveedores.map(p => [p.nombreProveedor.trim().toUpperCase(), p]));
    const opMap     = new Map(operaciones.map(o => [o.descripcion.trim().toUpperCase(), o]));
    const asignMap  = new Map(asignaciones.map(a => [a.nroDoc, a]));

    const pagoGrupos = new Map();
    pagos.forEach(p => {
      if (!pagoGrupos.has(p.numeroPago)) pagoGrupos.set(p.numeroPago, []);
      pagoGrupos.get(p.numeroPago).push(p);
    });

    const usadosNums = new Set();
    const nuevosProv = new Map();
    const nuevasOps  = new Map();

    const resolverLinea = (lineaId, fuente) => {
      const ldata = lineaMap.get(String(lineaId));
      if (!ldata) return { lineaNombre: null, lineaFuente: fuente };
      if (ldata.esManual) return { lineaNombre: null, lineaFuente: 'MANUAL' };
      return { lineaNombre: ldata.nombre, lineaFuente: fuente };
    };

    const transacciones = eecc.transacciones.map(trx => {
      const trxNum = parseInt(trx.nroDoc, 10);

      // 1. Estado y desglose ERP
      let estado, erpRegistros = [];
      if (trx.importe >= 0 || isNaN(trxNum)) {
        estado = trx.importe >= 0 ? 'INGRESO' : 'SIN_ERP';
      } else {
        const grupo = pagoGrupos.get(trxNum);
        if (grupo && !usadosNums.has(trxNum)) {
          usadosNums.add(trxNum);
          estado = 'CONCILIADO';
          // Cada sub-registro ERP obtiene su propia línea vía Mapeo Proveedores
          erpRegistros = grupo.map(p => {
            const key = (p.pagarA || '').trim().toUpperCase();
            if (key && !provMap.has(key)) nuevosProv.set(key, p.pagarA.trim());
            let rLineaId = null, rLineaNombre = null, rLineaFuente = null;
            if (key) {
              const prov = provMap.get(key);
              if (prov?.lineaId) {
                rLineaId = String(prov.lineaId);
                ({ lineaNombre: rLineaNombre, lineaFuente: rLineaFuente } = resolverLinea(prov.lineaId, 'PROVEEDOR'));
              }
            }
            return {
              pagarA:     p.pagarA,
              tipoPago:   p.tipoPago,
              importe:    moneda === 'USD' ? p.pagoExtranjero : p.pagoLocal,
              lineaId:    rLineaId,
              lineaNombre: rLineaNombre,
              lineaFuente: rLineaFuente,
            };
          });
        } else {
          estado = 'SIN_ERP';
        }
      }

      // 2. Línea del movimiento EECC (solo cuando NO hay sub-registros ERP)
      //    Si hay sub-registros, cada uno ya lleva su propia línea de Mapeo Proveedores.
      let lineaId = null, lineaNombre = null, lineaFuente = null;

      if (erpRegistros.length === 0) {
        // P0: Asignación directa (persistente, nunca se sobreescribe)
        const asign = asignMap.get(trx.nroDoc);
        if (asign?.lineaId) {
          lineaId = asign.lineaId;
          ({ lineaNombre, lineaFuente } = resolverLinea(lineaId, 'DIRECTA'));
        }

        // P1: Mov. Bancario por código de operación
        if (!lineaId) {
          const codigo = (trx.codigo || '').trim();
          if (codigo) {
            const mb = movBanMap.get(codigo);
            if (mb?.lineaId) { lineaId = mb.lineaId; ({ lineaNombre, lineaFuente } = resolverLinea(lineaId, 'MOV_BANCARIO')); }
          }
        }

        // P3: Operación por concepto
        if (!lineaId && trx.concepto) {
          const key = trx.concepto.trim().toUpperCase();
          const op = opMap.get(key);
          if (op?.lineaId) { lineaId = op.lineaId; ({ lineaNombre, lineaFuente } = resolverLinea(lineaId, 'OPERACION')); }
          else if (!op) nuevasOps.set(key, trx.concepto.trim());
        }
      }

      return {
        ...trx,
        estado,
        erpRegistros,
        lineaId:    lineaId ? String(lineaId) : null,
        lineaNombre,
        lineaFuente,
        lineaDirecta: lineaFuente === 'DIRECTA',
      };
    });

    if (nuevosProv.size > 0) {
      const docs = [...nuevosProv.values()].map(nombre => ({ compania, nombreProveedor: nombre }));
      try { await FlujoCajaProveedor.insertMany(docs, { ordered: false }); } catch (_) {}
    }
    if (nuevasOps.size > 0) {
      const docs = [...nuevasOps.values()].map(desc => ({ compania, descripcion: desc }));
      try { await FlujoCajaOperacion.insertMany(docs, { ordered: false }); } catch (_) {}
    }

    const soloERP = [];
    pagoGrupos.forEach((grupo, num) => {
      if (!usadosNums.has(num)) soloERP.push({ numeroPago: num, registros: grupo });
    });

    // sinLinea: EECC sin ERP y sin línea + sub-registros ERP sin línea
    let sinLineaCount = 0;
    transacciones.forEach(t => {
      if (t.erpRegistros.length > 0) {
        sinLineaCount += t.erpRegistros.filter(r => !r.lineaId).length;
      } else if (!t.lineaId) {
        sinLineaCount += 1;
      }
    });

    const stats = {
      total:             transacciones.length,
      conciliados:       transacciones.filter(t => t.estado === 'CONCILIADO').length,
      soloEECC:          transacciones.filter(t => t.estado !== 'CONCILIADO').length,
      soloERP:           soloERP.length,
      sinLinea:          sinLineaCount,
      nuevosProveedores: nuevosProv.size,
      nuevasOperaciones: nuevasOps.size,
    };

    res.json({ transacciones, soloERP, lineas, stats, cargadoEn: eecc.cargadoEn, alias: cuenta?.alias || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /asignacion — guardar/borrar asignación directa de línea a movimiento ──

router.put('/asignacion', async (req, res) => {
  try {
    const { compania, banco, moneda, nroDoc, lineaId } = req.body;
    if (!compania || !banco || !moneda || nroDoc == null)
      return res.status(400).json({ error: 'Faltan campos' });
    if (!checkSocAccess(req.user, compania))
      return res.status(403).json({ error: 'Sin acceso' });
    if (!lineaId) {
      await FlujoCajaAsignacion.deleteOne({ compania, banco, moneda, nroDoc });
      return res.json({ ok: true, deleted: true });
    }
    await FlujoCajaAsignacion.findOneAndUpdate(
      { compania, banco, moneda, nroDoc },
      { lineaId, asignadoPor: req.user.username, asignadoEn: new Date() },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /proveedor-linea — asignar línea a proveedor desde la conciliación ───

router.put('/proveedor-linea', async (req, res) => {
  try {
    const { compania, nombreProveedor, lineaId } = req.body;
    if (!compania || !nombreProveedor) return res.status(400).json({ error: 'Faltan campos' });
    if (!checkSocAccess(req.user, compania)) return res.status(403).json({ error: 'Sin acceso' });
    await FlujoCajaProveedor.findOneAndUpdate(
      { compania, nombreProveedor: nombreProveedor.trim() },
      { lineaId: lineaId || null },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

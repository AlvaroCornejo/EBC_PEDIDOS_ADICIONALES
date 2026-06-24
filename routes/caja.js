const express = require('express');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const CajaConfig = require('../models/CajaConfig');
const CierreCaja = require('../models/CierreCaja');
const EnvioOficina = require('../models/EnvioOficina');
const DepositoBancario = require('../models/DepositoBancario');

const router = express.Router();
router.use(authMiddleware);

const ALL_OPS = ['AASI', 'CDLAO', 'CDL28', 'PLANTA', 'GBADC', 'GBCFR', 'GBCFR2', 'GBCRP', 'GBGOL', 'GBSRQ', 'GBPLANTA'];
const COMBOS = [['VENTA', 'PEN'], ['VENTA', 'USD'], ['PROPINA', 'PEN'], ['PROPINA', 'USD']];
const comboKey = (tipo, moneda) => (tipo === 'VENTA' ? 'venta' : 'propina') + moneda;

function checkAcceso(req, res, tipo) {
  const u = req.user;
  if (u.role === 'ADMIN') return true;
  const ok = tipo === 'cierre'   ? !!u.rolCaja
           : tipo === 'oficina'  ? !!u.accesoOficina
           : tipo === 'deposito' ? !!u.accesoDepositos
           : (!!u.rolCaja || !!u.accesoOficina || !!u.accesoDepositos);
  if (!ok) { res.status(403).json({ error: 'No autorizado para esta sección' }); return false; }
  return true;
}

function checkOpAccess(user, operacion) {
  return user.role === 'ADMIN' || (user.operations || []).includes(operacion);
}

function n(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function sanitizeMonto(m = {}) {
  return { ventaPEN: n(m.ventaPEN), ventaUSD: n(m.ventaUSD), propinaPEN: n(m.propinaPEN), propinaUSD: n(m.propinaUSD) };
}
function sanitizeConteo(c = {}) {
  const limpiar = moneda => {
    const obj = {};
    Object.entries(c?.[moneda] || {}).forEach(([k, v]) => {
      const qty = Math.round(Number(v) || 0);
      if (qty > 0) obj[k] = qty;
    });
    return obj;
  };
  return { PEN: limpiar('PEN'), USD: limpiar('USD') };
}
function sanitizeCobranzas(c = {}) {
  return {
    efectivo:      sanitizeMonto(c.efectivo),
    tarjeta:       sanitizeMonto(c.tarjeta),
    delivery:      sanitizeMonto(c.delivery),
    transferencia: sanitizeMonto(c.transferencia),
  };
}

// ── Configuración por operación (admin) ─────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const configs = await CajaConfig.find().lean();
    const byOp = {}; configs.forEach(c => { byOp[c.operacion] = c; });
    res.json(ALL_OPS.map(op => byOp[op] || { operacion: op, tipoNegocio: 'MOSTRADOR', tieneOficina: false }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config/:operacion', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const { operacion } = req.params;
    if (!ALL_OPS.includes(operacion)) return res.status(400).json({ error: 'Operación inválida' });
    const { tipoNegocio, tieneOficina } = req.body;
    if (tipoNegocio !== undefined && !['RESTAURANTE', 'MOSTRADOR'].includes(tipoNegocio)) {
      return res.status(400).json({ error: 'Tipo de negocio inválido' });
    }
    const update = { operacion };
    if (tipoNegocio !== undefined) update.tipoNegocio = tipoNegocio;
    if (tieneOficina !== undefined) update.tieneOficina = !!tieneOficina;
    const config = await CajaConfig.findOneAndUpdate({ operacion }, update, { upsert: true, new: true });
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/caja/operaciones — operaciones accesibles + su config ──────────
router.get('/operaciones', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'cualquiera')) return;
    const ops = req.user.role === 'ADMIN' ? ALL_OPS : (req.user.operations || []);
    const configs = await CajaConfig.find({ operacion: { $in: ops } }).lean();
    const byOp = {}; configs.forEach(c => { byOp[c.operacion] = c; });
    res.json(ops.map(op => byOp[op] || { operacion: op, tipoNegocio: 'MOSTRADOR', tieneOficina: false }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registra inline, desde el propio Cierre, lo que ya se envió a oficina: marca los
// combos PENDIENTE como EN_OFICINA (acotado a lo contado) y crea el EnvioOficina asociado.
async function procesarEnvioInline(cierre, enviadoOficina, req) {
  if (!enviadoOficina) return;
  const en = sanitizeMonto(enviadoOficina);
  const contribs = [];
  for (const [t, m] of COMBOS) {
    const k = comboKey(t, m);
    if (en[k] > 0 && cierre.estadoEfectivo[k] === 'PENDIENTE') {
      const monto = Math.min(en[k], cierre.efectivoContado[k] || 0);
      if (monto > 0) {
        cierre.estadoEfectivo[k] = 'EN_OFICINA';
        contribs.push({ combo: k, monto });
      }
    }
  }
  if (!contribs.length) return;
  await cierre.save();
  const montos = { ventaPEN: 0, ventaUSD: 0, propinaPEN: 0, propinaUSD: 0 };
  contribs.forEach(c => { montos[c.combo] = c.monto; });
  await EnvioOficina.create({
    id: uuidv4(),
    operacion: cierre.operacion,
    fecha: cierre.fecha,
    cierres: [{ cierreId: cierre.id, fecha: cierre.fecha }],
    montos,
    comentarios: 'Registrado desde Cierre de Caja',
    creadoPorId: req.user.id,
    creadoPorNombre: req.user.username,
  });
}

// ── Cierres de Caja ──────────────────────────────────────────────────────────
router.get('/cierres', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'cierre')) return;
    const { operacion, desde, hasta, estado } = req.query;
    const filter = {};
    if (operacion) {
      if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
      filter.operacion = operacion;
    } else if (req.user.role !== 'ADMIN') {
      filter.operacion = { $in: req.user.operations || [] };
    }
    if (estado) filter.estado = estado;
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = desde;
      if (hasta) filter.fecha.$lte = hasta;
    }
    const cierres = await CierreCaja.find(filter).sort({ fecha: -1 }).limit(500).lean();
    res.json(cierres);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cierres', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'cierre')) return;
    if (req.user.role !== 'ADMIN' && req.user.rolCaja !== 'REGISTRO') {
      return res.status(403).json({ error: 'No autorizado para registrar' });
    }
    const { operacion, fecha, cobranzas, efectivoContado, conteoApertura, conteoCierre, enviadoOficina, comentarios } = req.body;
    if (!operacion || !fecha) return res.status(400).json({ error: 'Operación y fecha son requeridas' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });

    const existente = await CierreCaja.findOne({ operacion, fecha });
    if (existente) return res.status(400).json({ error: 'Ya existe un cierre para esa operación y fecha' });

    const config = await CajaConfig.findOne({ operacion }).lean();
    const doc = await CierreCaja.create({
      id: uuidv4(),
      operacion,
      fecha,
      tipoNegocio: config?.tipoNegocio || 'MOSTRADOR',
      cobranzas: sanitizeCobranzas(cobranzas),
      efectivoContado: sanitizeMonto(efectivoContado),
      conteoApertura: sanitizeConteo(conteoApertura),
      conteoCierre: sanitizeConteo(conteoCierre),
      aperturaRegistrada: true,
      comentarios: comentarios || '',
      creadoPorId: req.user.id,
      creadoPorNombre: req.user.username,
    });
    await procesarEnvioInline(doc, enviadoOficina, req);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/cierres/:id', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'cierre')) return;
    const cierre = await CierreCaja.findOne({ id: req.params.id });
    if (!cierre) return res.status(404).json({ error: 'Cierre no encontrado' });
    if (!checkOpAccess(req.user, cierre.operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (req.user.role !== 'ADMIN' && req.user.rolCaja !== 'REGISTRO') {
      return res.status(403).json({ error: 'No autorizado para editar' });
    }
    if (cierre.estado === 'CERRADO' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'El cierre ya está cerrado, no se puede modificar' });
    }

    const { cobranzas, efectivoContado, conteoCierre, enviadoOficina, comentarios, estado } = req.body;
    if (cobranzas !== undefined) cierre.cobranzas = sanitizeCobranzas(cobranzas);
    if (efectivoContado !== undefined) cierre.efectivoContado = sanitizeMonto(efectivoContado);
    if (conteoCierre !== undefined) cierre.conteoCierre = sanitizeConteo(conteoCierre);
    if (comentarios !== undefined) cierre.comentarios = comentarios;
    if (estado !== undefined) {
      if (!['ABIERTO', 'CERRADO'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
      cierre.estado = estado;
    }
    cierre.updatedAt = new Date();
    await cierre.save();
    await procesarEnvioInline(cierre, enviadoOficina, req);
    res.json(cierre);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/cierres/:id', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'cierre')) return;
    const cierre = await CierreCaja.findOne({ id: req.params.id });
    if (!cierre) return res.status(404).json({ error: 'Cierre no encontrado' });
    if (!checkOpAccess(req.user, cierre.operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (req.user.role !== 'ADMIN' && req.user.rolCaja !== 'REGISTRO') {
      return res.status(403).json({ error: 'No autorizado para eliminar' });
    }
    const algunoMovido = COMBOS.some(([t, m]) => cierre.estadoEfectivo[comboKey(t, m)] !== 'PENDIENTE');
    if (algunoMovido && req.user.role !== 'ADMIN') {
      return res.status(400).json({ error: 'No se puede eliminar: el efectivo ya fue enviado o depositado' });
    }
    await CierreCaja.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Envío a Oficina ──────────────────────────────────────────────────────────
router.get('/disponible-envio', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'oficina')) return;
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });

    const cierres = await CierreCaja.find({
      operacion,
      estado: 'CERRADO',
      $or: COMBOS.map(([t, m]) => ({ [`estadoEfectivo.${comboKey(t, m)}`]: 'PENDIENTE' })),
    }).sort({ fecha: 1 }).lean();
    res.json(cierres);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/envios', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'oficina')) return;
    const { operacion, fecha, cierreIds, comentarios } = req.body;
    if (!operacion || !fecha) return res.status(400).json({ error: 'Operación y fecha son requeridas' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (!Array.isArray(cierreIds) || !cierreIds.length) return res.status(400).json({ error: 'Selecciona al menos un cierre' });

    const cierres = await CierreCaja.find({ id: { $in: cierreIds }, operacion, estado: 'CERRADO' });
    if (cierres.length !== cierreIds.length) return res.status(400).json({ error: 'Algún cierre no existe o no está cerrado' });

    const montos = { ventaPEN: 0, ventaUSD: 0, propinaPEN: 0, propinaUSD: 0 };
    const incluidos = [];
    for (const cierre of cierres) {
      let incluyeAlgo = false;
      for (const [t, m] of COMBOS) {
        const k = comboKey(t, m);
        if (cierre.estadoEfectivo[k] === 'PENDIENTE' && cierre.efectivoContado[k] > 0) {
          montos[k] += cierre.efectivoContado[k];
          cierre.estadoEfectivo[k] = 'EN_OFICINA';
          incluyeAlgo = true;
        }
      }
      if (incluyeAlgo) {
        incluidos.push({ cierreId: cierre.id, fecha: cierre.fecha });
        await cierre.save();
      }
    }
    if (!incluidos.length) return res.status(400).json({ error: 'No hay efectivo pendiente de enviar en los cierres seleccionados' });

    Object.keys(montos).forEach(k => { montos[k] = n(montos[k]); });
    const envio = await EnvioOficina.create({
      id: uuidv4(),
      operacion,
      fecha,
      cierres: incluidos,
      montos,
      comentarios: comentarios || '',
      creadoPorId: req.user.id,
      creadoPorNombre: req.user.username,
    });
    res.json(envio);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/envios', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'oficina')) return;
    const { operacion, estado } = req.query;
    const filter = {};
    if (operacion) {
      if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
      filter.operacion = operacion;
    } else if (req.user.role !== 'ADMIN') {
      filter.operacion = { $in: req.user.operations || [] };
    }
    if (estado) filter.estado = estado;
    const envios = await EnvioOficina.find(filter).sort({ fecha: -1 }).limit(500).lean();
    res.json(envios);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/envios/:id/recibir', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'oficina')) return;
    const envio = await EnvioOficina.findOne({ id: req.params.id });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!checkOpAccess(req.user, envio.operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (envio.estado === 'RECIBIDO') return res.status(400).json({ error: 'Este envío ya fue recibido' });

    const { montosRecibidos } = req.body;
    envio.montosRecibidos = sanitizeMonto(montosRecibidos || envio.montos);
    envio.estado = 'RECIBIDO';
    envio.recibidoPorId = req.user.id;
    envio.recibidoPorNombre = req.user.username;
    envio.recibidoEn = new Date();
    await envio.save();
    res.json(envio);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Depósito Bancario ────────────────────────────────────────────────────────
router.get('/disponible-deposito', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'deposito')) return;
    const { operacion, moneda, tipo } = req.query;
    if (!operacion || !moneda || !tipo) return res.status(400).json({ error: 'Operación, moneda y tipo son requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (!['PEN', 'USD'].includes(moneda) || !['VENTA', 'PROPINA'].includes(tipo)) {
      return res.status(400).json({ error: 'Moneda o tipo inválido' });
    }

    const config = await CajaConfig.findOne({ operacion }).lean();
    const tieneOficina = !!config?.tieneOficina;
    const k = comboKey(tipo, moneda);

    if (tieneOficina) {
      const envios = await EnvioOficina.find({
        operacion, estado: 'RECIBIDO',
        [`estadoEfectivo.${k}`]: 'PENDIENTE',
        [`montosRecibidos.${k}`]: { $gt: 0 },
      }).sort({ fecha: 1 }).lean();
      return res.json({ origenTipo: 'ENVIO', items: envios.map(e => ({ id: e.id, fecha: e.fecha, monto: e.montosRecibidos[k] })) });
    }
    const cierres = await CierreCaja.find({
      operacion, estado: 'CERRADO',
      [`estadoEfectivo.${k}`]: 'PENDIENTE',
      [`efectivoContado.${k}`]: { $gt: 0 },
    }).sort({ fecha: 1 }).lean();
    res.json({ origenTipo: 'CIERRE', items: cierres.map(c => ({ id: c.id, fecha: c.fecha, monto: c.efectivoContado[k] })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/depositos', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'deposito')) return;
    const { operacion, fecha, moneda, tipo, origenIds, banco, numeroOperacion, comentarios } = req.body;
    if (!operacion || !fecha || !moneda || !tipo) return res.status(400).json({ error: 'Operación, fecha, moneda y tipo son requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
    if (!['PEN', 'USD'].includes(moneda) || !['VENTA', 'PROPINA'].includes(tipo)) {
      return res.status(400).json({ error: 'Moneda o tipo inválido' });
    }
    if (!Array.isArray(origenIds) || !origenIds.length) return res.status(400).json({ error: 'Selecciona al menos un origen' });

    const config = await CajaConfig.findOne({ operacion }).lean();
    const tieneOficina = !!config?.tieneOficina;
    const k = comboKey(tipo, moneda);
    const origenTipo = tieneOficina ? 'ENVIO' : 'CIERRE';
    const Model = tieneOficina ? EnvioOficina : CierreCaja;

    const origenesDoc = await Model.find({ id: { $in: origenIds }, operacion });
    if (origenesDoc.length !== origenIds.length) return res.status(400).json({ error: 'Algún origen no existe' });

    let montoTotal = 0;
    const origenes = [];
    for (const doc of origenesDoc) {
      if (doc.estadoEfectivo[k] !== 'PENDIENTE') {
        return res.status(400).json({ error: `El origen del ${doc.fecha} ya fue depositado para esta combinación` });
      }
      const fuente = tieneOficina ? doc.montosRecibidos : doc.efectivoContado;
      const monto = fuente[k] || 0;
      if (monto <= 0) return res.status(400).json({ error: `El origen del ${doc.fecha} no tiene monto pendiente para esta combinación` });
      montoTotal += monto;
      origenes.push({ id: doc.id, fecha: doc.fecha, monto });
      doc.estadoEfectivo[k] = 'DEPOSITADO';
      await doc.save();
    }

    const deposito = await DepositoBancario.create({
      id: uuidv4(),
      operacion,
      fecha,
      moneda,
      tipo,
      monto: n(montoTotal),
      banco: banco || '',
      numeroOperacion: numeroOperacion || '',
      origenTipo,
      origenes,
      comentarios: comentarios || '',
      creadoPorId: req.user.id,
      creadoPorNombre: req.user.username,
    });
    res.json(deposito);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/depositos', async (req, res) => {
  try {
    if (!checkAcceso(req, res, 'deposito')) return;
    const { operacion, moneda, tipo, desde, hasta } = req.query;
    const filter = {};
    if (operacion) {
      if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Sin acceso a esa operación' });
      filter.operacion = operacion;
    } else if (req.user.role !== 'ADMIN') {
      filter.operacion = { $in: req.user.operations || [] };
    }
    if (moneda) filter.moneda = moneda;
    if (tipo) filter.tipo = tipo;
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = desde;
      if (hasta) filter.fecha.$lte = hasta;
    }
    const depositos = await DepositoBancario.find(filter).sort({ fecha: -1 }).limit(500).lean();
    res.json(depositos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

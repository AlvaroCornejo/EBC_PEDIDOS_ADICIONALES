const express = require('express');
const auth = require('../middleware/auth');

const SaldoCuentaBanco     = require('../models/SaldoCuentaBanco');
const SaldoBancoMovimiento = require('../models/SaldoBancoMovimiento');
const Config               = require('../models/Config');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.accesoSaldoBanco) return next();
  return res.status(403).json({ error: 'Sin acceso a Saldos Bancarios' });
}
router.use(requireAccess);

const CONFIG_KEY = 'saldoBancoRutaDescargas';
const RUTA_DEFAULT = 'C:\\Users\\CORP.PROCESOS\\Downloads';

// ── Config: carpeta Descargas del servidor (solo ADMIN edita) ──────────────
router.get('/config', async (req, res) => {
  try {
    const doc = await Config.findOne({ key: CONFIG_KEY }).lean();
    res.json({ ruta: doc?.value || RUTA_DEFAULT });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/config', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const { ruta } = req.body;
    if (!ruta) return res.status(400).json({ error: 'Falta ruta' });
    await Config.findOneAndUpdate({ key: CONFIG_KEY }, { value: ruta }, { upsert: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Catálogo de cuentas (mapeo cuenta banco -> sociedad/banco/moneda) ──────
router.get('/cuentas', async (req, res) => {
  try {
    const cuentas = await SaldoCuentaBanco.find({}).sort({ sociedad: 1, banco: 1 }).lean();
    res.json(cuentas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/cuentas', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const { cuenta, banco, moneda, sociedad, nombreCuenta } = req.body;
    if (!cuenta || !banco || !moneda || !sociedad) return res.status(400).json({ error: 'Faltan campos' });
    const doc = await SaldoCuentaBanco.create({ cuenta: cuenta.trim(), banco, moneda, sociedad: sociedad.trim(), nombreCuenta: nombreCuenta || '' });
    res.json(doc);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Ya existe una cuenta con ese número' });
    res.status(500).json({ error: err.message });
  }
});
router.put('/cuentas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const { banco, moneda, sociedad, nombreCuenta } = req.body;
    const update = {};
    if (banco !== undefined) update.banco = banco;
    if (moneda !== undefined) update.moneda = moneda;
    if (sociedad !== undefined) update.sociedad = sociedad.trim();
    if (nombreCuenta !== undefined) update.nombreCuenta = nombreCuenta;
    const doc = await SaldoCuentaBanco.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/cuentas/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
    const doc = await SaldoCuentaBanco.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Resumen: saldo inicial/cargos/abonos/saldo final por Día/Semana/Mes/Año,
// para la fecha elegida, de todas las cuentas ──────────────────────────────
function rangoPeriodo(fecha, tipo) {
  const d = fecha;
  if (tipo === 'dia') return { desde: d, hasta: d };
  if (tipo === 'semana') {
    const dow = d.getUTCDay() || 7; // domingo(0) -> 7
    const lunes = new Date(d); lunes.setUTCDate(d.getUTCDate() - (dow - 1));
    const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: lunes, hasta: domingo };
  }
  if (tipo === 'mes') {
    return {
      desde: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
      hasta: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
    };
  }
  return { // año
    desde: new Date(Date.UTC(d.getUTCFullYear(), 0, 1)),
    hasta: new Date(Date.UTC(d.getUTCFullYear(), 11, 31)),
  };
}
// movsOrdenados: movimientos de la cuenta, ordenados por fecha+seq ascendente
// (seq desempata movimientos del mismo día, ya que la fecha del banco no
// trae hora — sin eso, el último de un día con varios movimientos podía
// quedar mal elegido y el saldo final salía incorrecto).
function resumenPeriodo(movsOrdenados, desde, hasta) {
  const antes = movsOrdenados.filter(m => m.fecha < desde);
  const hastaIncl = movsOrdenados.filter(m => m.fecha <= hasta);
  const dentro = movsOrdenados.filter(m => m.fecha >= desde && m.fecha <= hasta);

  const cargos = dentro.reduce((s, m) => s + (m.importe < 0 ? m.importe : 0), 0);
  const abonos = dentro.reduce((s, m) => s + (m.importe > 0 ? m.importe : 0), 0);
  const saldoInicial = antes.length ? antes[antes.length - 1].saldo : (dentro.length ? dentro[0].saldo - dentro[0].importe : null);
  const saldoFinal = hastaIncl.length ? hastaIncl[hastaIncl.length - 1].saldo : (antes.length ? antes[antes.length - 1].saldo : null);
  return { saldoInicial, cargos, abonos, saldoFinal };
}

router.get('/resumen', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha requerida (YYYY-MM-DD)' });
    const [y, m, d] = fecha.split('-').map(Number);
    const fechaObj = new Date(Date.UTC(y, m - 1, d));

    const periodos = { dia: rangoPeriodo(fechaObj, 'dia'), semana: rangoPeriodo(fechaObj, 'semana'), mes: rangoPeriodo(fechaObj, 'mes'), año: rangoPeriodo(fechaObj, 'año') };
    // Rango que cubre todos los períodos (con margen de 1 semana a cada lado
    // por si la semana ISO de la fecha elegida cruza un límite de año).
    const rangoDesde = new Date(periodos['año'].desde); rangoDesde.setUTCDate(rangoDesde.getUTCDate() - 7);
    const rangoHasta = new Date(periodos['año'].hasta); rangoHasta.setUTCDate(rangoHasta.getUTCDate() + 7);

    const cuentas = await SaldoCuentaBanco.find({}).sort({ sociedad: 1, banco: 1 }).lean();
    const movs = await SaldoBancoMovimiento.find({ fecha: { $gte: rangoDesde, $lte: rangoHasta } }).sort({ fecha: 1, seq: 1 }).lean();
    const movsPorCuenta = {};
    movs.forEach(m => { (movsPorCuenta[m.cuenta] || (movsPorCuenta[m.cuenta] = [])).push(m); });

    const filas = cuentas.map(c => {
      const movsCuenta = movsPorCuenta[c.cuenta] || [];
      const out = { cuenta: c.cuenta, sociedad: c.sociedad, banco: c.banco, moneda: c.moneda, nombreCuenta: c.nombreCuenta };
      ['dia', 'semana', 'mes', 'año'].forEach(tipo => {
        out[tipo] = resumenPeriodo(movsCuenta, periodos[tipo].desde, periodos[tipo].hasta);
      });
      return out;
    });

    res.json({ fecha, periodos, filas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

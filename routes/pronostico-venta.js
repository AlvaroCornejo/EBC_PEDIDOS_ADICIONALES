const express = require('express');
const auth = require('../middleware/auth');

const VentaCanalDiaria = require('../models/VentaCanalDiaria');
const VentaForecast    = require('../models/VentaForecast');

const router = express.Router();
router.use(auth);

function requireAccess(req, res, next) {
  if (req.user.role === 'ADMIN' || req.user.puedeVerPronosticoVenta) return next();
  return res.status(403).json({ error: 'Sin acceso al Pronóstico de Venta' });
}
router.use(requireAccess);

/** Operaciones autorizadas del usuario (null = todas) */
function opsFilter(user) {
  return user.role === 'ADMIN' ? null : (user.operations || []);
}
function checkOpAccess(user, operacion) {
  const ops = opsFilter(user);
  return ops === null || ops.includes(operacion);
}

// ── Semanas ISO (lunes=1..domingo=7, mismo criterio usado en routes/pagos.js) ──
function isoYear(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}
function isoDow(date) {
  const wd = date.getUTCDay();
  return wd === 0 ? 7 : wd;
}
function weeksInYear(año) {
  return isoWeek(new Date(Date.UTC(año, 11, 28)));
}
function mondayOfIsoWeek(año, semana) {
  const jan4 = new Date(Date.UTC(año, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(monday1);
  monday.setUTCDate(monday1.getUTCDate() + (semana - 1) * 7);
  return monday;
}
function weekRange(año, semana) {
  const desde = mondayOfIsoWeek(año, semana);
  const hasta = new Date(desde);
  hasta.setUTCDate(desde.getUTCDate() + 6);
  hasta.setUTCHours(23, 59, 59, 999);
  return { desde, hasta };
}
/** Suma/resta N semanas a un (año,semana) ISO, manejando el cruce de año */
function addSemanas(año, semana, delta) {
  const d = mondayOfIsoWeek(año, semana);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return { año: isoYear(d), semana: isoWeek(d) };
}
/** Semana comparable k años atrás (mismo número de semana, acotado a semanas que existan) */
function semanaAñoAtras(año, semana, k) {
  const max = weeksInYear(año - k);
  return { año: año - k, semana: Math.min(semana, max) };
}

/** Canales LOCAL/HABERES se miden por PAX, el resto por TRANSACCIONES */
function tipoCanal(canal) {
  const up = String(canal).toUpperCase();
  return (up.includes('LOCAL') || up === 'HABERES') ? 'pax' : 'transacciones';
}

/**
 * Propuesta de proyección para un día de la semana: regresión lineal simple (mínimos
 * cuadrados) sobre la serie de las N semanas mostradas, extrapolada un paso adelante;
 * si hay serie del mismo día/semana el año pasado, se pondera 50/50 con la extrapolación
 * ajustada por el factor de variación interanual (suma actual / suma año pasado,
 * acotado a [0.5, 1.5] para no disparar el número con un solo dato atípico).
 */
function calcularPropuesta(serie, serieAñoAnterior) {
  const n = serie.length;
  if (!n) return 0;
  const mx = (n - 1) / 2;
  const my = serie.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (serie[i] - my); den += (i - mx) ** 2; }
  const pendiente = den === 0 ? 0 : num / den;
  const intercepto = my - pendiente * mx;
  let tendencia = Math.max(0, intercepto + pendiente * n); // extrapola un paso más allá del último índice (n-1)

  if (serieAñoAnterior && serieAñoAnterior.length === n) {
    const sumaActual = serie.reduce((a, b) => a + b, 0);
    const sumaAnterior = serieAñoAnterior.reduce((a, b) => a + b, 0);
    if (sumaAnterior > 0) {
      const factor = Math.min(Math.max(sumaActual / sumaAnterior, 0.5), 1.5);
      tendencia = (tendencia + tendencia * factor) / 2;
    }
  }
  return Math.round(tendencia);
}

// ── GET /operaciones ────────────────────────────────────────────────────────
router.get('/operaciones', async (req, res) => {
  try {
    const ops = opsFilter(req.user);
    const filter = ops === null ? {} : { operacion: { $in: ops } };
    const disponibles = await VentaCanalDiaria.distinct('operacion', filter);
    res.json(disponibles.filter(Boolean).sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /canales?operacion= ───────────────────────────────────────────────────
router.get('/canales', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const canales = await VentaCanalDiaria.distinct('canal', { operacion });
    res.json(canales.filter(Boolean).sort().map(c => ({ canal: c, tipo: tipoCanal(c) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /resumen?operacion=&semanaObjetivo=YYYYWW&nSemanas=&nAnios= ──────────
router.get('/resumen', async (req, res) => {
  try {
    const { operacion } = req.query;
    if (!operacion) return res.status(400).json({ error: 'Operación requerida' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const nSem = Math.min(Math.max(parseInt(req.query.nSemanas) || 8, 1), 52);
    const nAn  = Math.min(Math.max(parseInt(req.query.nAnios) || 1, 0), 5);

    const hoy = new Date();
    const actual = { año: isoYear(hoy), semana: isoWeek(hoy) };

    const historial = [];
    for (let i = nSem - 1; i >= 0; i--) historial.push(addSemanas(actual.año, actual.semana, -i));

    let objetivo;
    const semQ = req.query.semanaObjetivo;
    if (semQ && /^\d{6}$/.test(semQ)) objetivo = { año: +semQ.slice(0, 4), semana: +semQ.slice(4) };
    else objetivo = addSemanas(actual.año, actual.semana, 1);

    const aniosAnteriores = [];
    for (let k = 1; k <= nAn; k++) aniosAnteriores.push(historial.map(h => semanaAñoAtras(h.año, h.semana, k)));

    // Rango global de fechas a traer de Mongo (historial + comparables de años anteriores)
    const todasSemanas = [...historial, ...aniosAnteriores.flat()];
    const rangos = todasSemanas.map(s => weekRange(s.año, s.semana));
    const desdeGlobal = new Date(Math.min(...rangos.map(r => r.desde.getTime())));
    const hastaGlobal = new Date(Math.max(...rangos.map(r => r.hasta.getTime())));

    const docs = await VentaCanalDiaria.find({
      operacion, fecha: { $gte: desdeGlobal, $lte: hastaGlobal },
    }).lean();

    const porSemana = {}; // canal|año|semana -> { pax, transacciones, ventaBrutaMasRedencion }
    const porDia     = {}; // canal|año|semana|dia -> { pax, transacciones }
    const canalesSet = new Set();
    docs.forEach(d => {
      const iy = isoYear(d.fecha), iw = isoWeek(d.fecha), dow = isoDow(d.fecha);
      canalesSet.add(d.canal);
      const kS = `${d.canal}|${iy}|${iw}`;
      if (!porSemana[kS]) porSemana[kS] = { pax: 0, transacciones: 0, ventaBrutaMasRedencion: 0 };
      porSemana[kS].pax += d.pax; porSemana[kS].transacciones += d.transacciones;
      porSemana[kS].ventaBrutaMasRedencion += d.ventaBrutaMasRedencion;
      const kD = `${d.canal}|${iy}|${iw}|${dow}`;
      if (!porDia[kD]) porDia[kD] = { pax: 0, transacciones: 0 };
      porDia[kD].pax += d.pax; porDia[kD].transacciones += d.transacciones;
    });

    const vacioSem = { pax: 0, transacciones: 0, ventaBrutaMasRedencion: 0 };
    const vacioDia = { pax: 0, transacciones: 0 };
    const puntoSemana = (canal, h, metricKey) => {
      const s = porSemana[`${canal}|${h.año}|${h.semana}`] || vacioSem;
      const cantidad = s[metricKey];
      return { año: h.año, semana: h.semana, cantidad, ventaBrutaMasRedencion: s.ventaBrutaMasRedencion, ticketPromedio: cantidad ? s.ventaBrutaMasRedencion / cantidad : 0 };
    };

    const canales = [...canalesSet].sort().map(canal => {
      const metricKey = tipoCanal(canal);
      const serieSemanal = historial.map(h => puntoSemana(canal, h, metricKey));
      const serieAnios = aniosAnteriores.map(arr => arr.map(h => puntoSemana(canal, h, metricKey)));

      const dias = [1, 2, 3, 4, 5, 6, 7].map(dow => {
        const serie = historial.map(h => (porDia[`${canal}|${h.año}|${h.semana}|${dow}`] || vacioDia)[metricKey]);
        const serieAniosDia = aniosAnteriores.map(arr => arr.map(h => (porDia[`${canal}|${h.año}|${h.semana}|${dow}`] || vacioDia)[metricKey]));
        const propuesta = calcularPropuesta(serie, serieAniosDia[0]);
        return { diaSemana: dow, serie, serieAnios: serieAniosDia, propuesta };
      });

      return { canal, tipo: metricKey, serieSemanal, serieAnios, dias };
    });

    res.json({
      operacion, actual, objetivo,
      semanas: historial,
      aniosAnteriores: aniosAnteriores.map((arr, idx) => ({ haceAños: idx + 1, semanas: arr })),
      canales,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /forecast?operacion=&año=&semana= ─────────────────────────────────────
router.get('/forecast', async (req, res) => {
  try {
    const { operacion } = req.query;
    const año = parseInt(req.query.año), semana = parseInt(req.query.semana);
    if (!operacion || !año || !semana) return res.status(400).json({ error: 'Operación, año y semana requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });
    const fc = await VentaForecast.findOne({ operacion, año, semana }).lean();
    res.json(fc || { operacion, año, semana, canales: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /forecast — guarda Y bloquea (solo lectura hasta que un ADMIN lo reabra) ──
router.put('/forecast', async (req, res) => {
  try {
    const { operacion, año, semana, canales } = req.body;
    if (!operacion || !año || !semana) return res.status(400).json({ error: 'Operación, año y semana requeridos' });
    if (!checkOpAccess(req.user, operacion)) return res.status(403).json({ error: 'Operación no autorizada' });

    const existente = await VentaForecast.findOne({ operacion, año, semana }).lean();
    if (existente?.bloqueado) return res.status(400).json({ error: 'Este pronóstico ya fue guardado y está bloqueado — pídele a un administrador que lo reabra para poder editarlo.' });

    const fc = await VentaForecast.findOneAndUpdate(
      { operacion, año, semana },
      {
        operacion, año, semana,
        canales: Array.isArray(canales) ? canales : [],
        bloqueado: true,
        bloqueadoPor: req.user.username,
        bloqueadoEn: new Date(),
        actualizadoPor: req.user.username,
        actualizadoEn: new Date(),
      },
      { upsert: true, new: true }
    );
    res.json(fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /forecast/desbloquear — solo ADMIN, reabre un pronóstico bloqueado ──────
router.post('/forecast/desbloquear', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo un administrador puede reabrir un pronóstico bloqueado' });
    const { operacion, año, semana } = req.body;
    if (!operacion || !año || !semana) return res.status(400).json({ error: 'Operación, año y semana requeridos' });
    const fc = await VentaForecast.findOneAndUpdate(
      { operacion, año, semana },
      { bloqueado: false, bloqueadoPor: undefined, bloqueadoEn: undefined },
      { new: true }
    );
    if (!fc) return res.status(404).json({ error: 'No hay pronóstico guardado para esa semana' });
    res.json(fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

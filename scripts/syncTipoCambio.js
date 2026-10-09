// Sincroniza el Tipo de Cambio (USD -> PEN, tasas "venta" y "compra") desde la API pública
// de SUNAT (https://api.apis.net.pe/v1/tipo-cambio-sunat?fecha=YYYY-MM-DD, sin
// API key). Rellena desde la fecha más antigua que tenga movimientos de Flujo
// de Caja hasta hoy, saltando las fechas que ya están cargadas — así corre
// bien tanto la primera vez (backfill completo) como a diario (solo agrega el
// día nuevo). Si la API no tiene publicado el TC de una fecha (ej. HTTP 404),
// se guarda esa fecha con el TC del último día conocido, en vez de dejarla
// sin cargar. Uso: node scripts/syncTipoCambio.js
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const TipoCambio = require('../models/TipoCambio');
const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoSaldoInicial = require('../models/FlujoSaldoInicial');

const API_URL = 'https://api.apis.net.pe/v1/tipo-cambio-sunat';
const PAUSA_MS = 1500; // ritmo normal entre fechas
const REINTENTOS_429 = 5;
const ESPERA_429_MS = 8000; // la API pública es sensible a ráfagas — esperar bastante antes de reintentar

function ymd(d) { return d.toISOString().slice(0, 10); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function obtenerTC(fechaStr) {
  for (let intento = 1; intento <= REINTENTOS_429; intento++) {
    const res = await fetch(`${API_URL}?fecha=${fechaStr}`);
    if (res.status === 429) {
      if (intento === REINTENTOS_429) throw new Error('HTTP 429 (reintentos agotados)');
      await sleep(ESPERA_429_MS);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (typeof data.venta !== 'number') throw new Error('Respuesta sin campo venta: ' + JSON.stringify(data));
    return { venta: data.venta, compra: typeof data.compra === 'number' ? data.compra : null };
  }
}

async function main() {
  await connectDB();

  // La fecha de arranque es la más antigua entre el primer movimiento y el
  // ancla de saldo inicial más antigua (el ancla puede ser 1 día anterior al
  // primer movimiento, y sin TC para esa fecha exacta la conversión a soles
  // del saldo inicial se salta silenciosamente).
  const [primerMov, primerSaldo] = await Promise.all([
    FlujoMovimientoBancario.findOne({}).sort({ fecha: 1 }).lean(),
    FlujoSaldoInicial.findOne({}).sort({ fecha: 1 }).lean(),
  ]);
  const candidatas = [primerMov?.fecha, primerSaldo?.fecha].filter(Boolean).map(f => new Date(f));
  const desde = candidatas.length ? new Date(Math.min(...candidatas)) : new Date();
  desde.setUTCHours(0, 0, 0, 0);
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);

  const existentesDocs = await TipoCambio.find({}, 'fecha valor compra').sort({ fecha: 1 }).lean();
  const existentes = new Map(existentesDocs.map(t => [ymd(t.fecha), t.valor]));
  const compraExistente = new Map(existentesDocs.map(t => [ymd(t.fecha), t.compra]));
  // Fechas ya cargadas sin "compra" (se agregó después): se completan solo las de los últimos 120 días.
  const limiteCompra = new Date(hoy); limiteCompra.setUTCDate(limiteCompra.getUTCDate() - 120);

  // Recorre en orden cronológico llevando el último valor conocido (ya cargado
  // o recién obtenido) — si la API falla para una fecha (ej. HTTP 404, sin
  // publicación ese día), se usa ese último valor como respaldo en vez de
  // dejar la fecha sin tipo de cambio.
  let ultimoValor = null, ultimoCompra = null;
  let compraCompletadas = 0;
  let cargados = 0, saltados = 0, respaldos = 0, errores = 0;
  for (let d = new Date(desde); d <= hoy; d.setUTCDate(d.getUTCDate() + 1)) {
    const fechaStr = ymd(d);
    if (existentes.has(fechaStr)) {
      ultimoValor = existentes.get(fechaStr);
      if (compraExistente.get(fechaStr) == null && d >= limiteCompra) {
        try {
          const tc = await obtenerTC(fechaStr);
          if (tc.compra != null) {
            await TipoCambio.updateOne({ fecha: new Date(fechaStr) }, { $set: { compra: tc.compra } });
            ultimoCompra = tc.compra; compraCompletadas++;
            console.log(`✓ ${fechaStr} compra -> ${tc.compra}`);
          }
        } catch (err) { console.log(`⚠ ${fechaStr}: no se pudo completar la compra (${err.message})`); }
        await sleep(PAUSA_MS);
      } else if (compraExistente.get(fechaStr) != null) ultimoCompra = compraExistente.get(fechaStr);
      saltados++;
      continue;
    }
    try {
      const tc = await obtenerTC(fechaStr);
      await TipoCambio.create({ fecha: new Date(fechaStr), valor: tc.venta, compra: tc.compra, actualizadoPor: 'sync-automatico' });
      ultimoValor = tc.venta; ultimoCompra = tc.compra;
      cargados++;
      console.log(`✓ ${fechaStr} -> venta ${tc.venta}, compra ${tc.compra}`);
    } catch (err) {
      if (ultimoValor != null) {
        await TipoCambio.create({ fecha: new Date(fechaStr), valor: ultimoValor, compra: ultimoCompra, actualizadoPor: 'sync-automatico (TC del dia anterior, sin publicar)' });
        respaldos++;
        console.log(`⚠ ${fechaStr}: ${err.message} -> se usa TC del día anterior (${ultimoValor})`);
      } else {
        errores++;
        console.error(`✗ ${fechaStr}: ${err.message} (sin TC previo para usar de respaldo)`);
      }
    }
    await sleep(PAUSA_MS);
  }

  console.log(`\nListo. Cargados: ${cargados}, ya existían: ${saltados}, compra completada en existentes: ${compraCompletadas}, respaldados con TC del día anterior: ${respaldos}, errores sin respaldo: ${errores}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

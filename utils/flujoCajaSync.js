// Lógica de import compartida entre el sync diario
// (scripts/importFlujoCaja.js) y la carga manual (routes/flujoCaja.js) —
// ambos leen los mismos 2 directorios (configurables en Admin → Flujo de
// Caja → Rutas) y llaman estas mismas funciones, para no duplicar lógica.

const Config          = require('../models/Config');
const CompaniaCodigo  = require('../models/CompaniaCodigo');
const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoPagoERP            = require('../models/FlujoPagoERP');
const { leerMovimientoBanco, leerPagosERP, listarArchivosEstadoCuenta, listarArchivosPagosERP } = require('./flujoCajaImport');
const { reconciliar } = require('./flujoCajaReconciliar');

const BATCH = 2000;
const KEY_EECC = 'flujoCajaRutaEstadoCuenta';
const KEY_ERP  = 'flujoCajaRutaPagosERP';

async function obtenerRutas() {
  const docs = await Config.find({ key: { $in: [KEY_EECC, KEY_ERP] } }).lean();
  const map = Object.fromEntries(docs.map(d => [d.key, d.value]));
  return { rutaEstadoCuenta: map[KEY_EECC] || '', rutaPagosERP: map[KEY_ERP] || '' };
}
async function guardarRutas({ rutaEstadoCuenta, rutaPagosERP }) {
  await Promise.all([
    Config.findOneAndUpdate({ key: KEY_EECC }, { key: KEY_EECC, value: rutaEstadoCuenta || '' }, { upsert: true }),
    Config.findOneAndUpdate({ key: KEY_ERP }, { key: KEY_ERP, value: rutaPagosERP || '' }, { upsert: true }),
  ]);
}

async function obtenerMapaCias() {
  const companias = await CompaniaCodigo.find({}).lean();
  return Object.fromEntries(companias.map(c => [c.codigo, c.compania]));
}

/** Lista los archivos disponibles en ambas carpetas configuradas, listos para mostrar en la UI de carga manual. */
async function listarDisponibles() {
  const { rutaEstadoCuenta, rutaPagosERP } = await obtenerRutas();
  return {
    rutaEstadoCuenta, rutaPagosERP,
    estadoCuenta: listarArchivosEstadoCuenta(rutaEstadoCuenta),
    pagosERP: listarArchivosPagosERP(rutaPagosERP),
  };
}

/** Importa un archivo de Estado de Cuenta ya identificado (sociedad/banco/moneda/archivo). */
async function importarArchivoEstadoCuenta({ sociedad, banco, moneda, archivo }) {
  const movs = await leerMovimientoBanco(banco, archivo);
  await FlujoMovimientoBancario.deleteMany({ sociedad, banco, moneda });
  const docs = movs.map(m => ({ sociedad, banco, moneda, ...m }));
  for (let i = 0; i < docs.length; i += BATCH) {
    await FlujoMovimientoBancario.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  return docs.length;
}

/**
 * Importa un archivo CSV de Pagos ERP (contiene todas las sociedades juntas,
 * distinguidas por CompaniaCodigo). Devuelve { sociedad: cantidadFilas }.
 */
async function importarArchivoPagosERP(archivo, mapaCias) {
  const filas = leerPagosERP(archivo);
  const porSociedad = {};
  for (const f of filas) {
    const sociedad = mapaCias[f.companiaCodigo.padStart(6, '0')];
    if (!sociedad) continue; // código de compañía sin mapear en el catálogo
    if (!porSociedad[sociedad]) porSociedad[sociedad] = [];
    porSociedad[sociedad].push({
      sociedad,
      cuentaBancaria: f.cuentaBancaria, numeroPago: f.numeroPago, pagarA: f.pagarA,
      moneda: f.moneda, fechaPago: f.fechaPago, montoLocal: f.montoLocal,
      montoExtranjero: f.montoExtranjero, tipoPago: f.tipoPago, voucherPago: f.voucherPago,
    });
  }
  const resumen = {};
  for (const [sociedad, docs] of Object.entries(porSociedad)) {
    await FlujoPagoERP.deleteMany({ sociedad });
    for (let i = 0; i < docs.length; i += BATCH) {
      await FlujoPagoERP.insertMany(docs.slice(i, i + BATCH), { ordered: false });
    }
    resumen[sociedad] = docs.length;
  }
  return resumen;
}

module.exports = {
  obtenerRutas, guardarRutas, obtenerMapaCias, listarDisponibles,
  importarArchivoEstadoCuenta, importarArchivoPagosERP, reconciliar,
};

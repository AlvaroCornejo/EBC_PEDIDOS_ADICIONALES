/**
 * Kardex (consumos reales) desde Odoo → MongoDB (colección KardexOdoo). Solo LEE Odoo.
 *
 * Arma las mismas columnas de la hoja "Kardex" de los ADICIONALES — ITEM, TRX, AÑOSEM, CANTIDAD
 * (con signo), IMPORTE, OPERACION — a partir de los movimientos hechos (stock.move.line) que entran
 * o salen de cada almacén. Los traslados entre ubicaciones del mismo almacén no cambian el saldo y
 * se omiten. Mapeo de movimientos (aprobado por el usuario):
 *
 *   Ajuste de inventario con ref. INICIAL / CORRECCION CANTIDADES ............ INICIAL
 *   Proveedor (recepciones; extornos/devoluciones en negativo) ............... COMPRA
 *   Producción en plantas (PTAFK, GBPTA): producto terminado / insumos ......... PRODUCCION / CONSUMO PRODUCCION
 *   Producción en tiendas: producto / insumos ................................ TRANSFORMACION / CONSUMO TRANSFORMACION
 *   Traslado entre almacenes, Venta intercompany, entregas a empresas del grupo  TRANSFERENCIA
 *   Clientes (órdenes de PdV = consumo por receta, clientes externos) ......... VENTA
 *   <ALM>/Gastos generales .................................................... CONSUMOS
 *   <ALM>/Consumo por rancho .................................................. RANCHO
 *   Scrap ("Merma …" → MERMA) ................................................. BAJA / MERMA
 *   Otros ajustes de inventario (conteos, regularizaciones) ................... SOBRANTE / FALTANTE
 *
 * Fechas (hora de Lima), igual que los reportes de saldos de odoo-integration: la carga inicial
 * (INICIAL y CORRECCION CANTIDADES) cuenta al 31/10; una transferencia cuenta en su fecha programada
 * si es anterior a la validación (salvo recepciones programadas antes del 01/11).
 * Importe = valorización de Odoo del movimiento (stock.valuation.layer), sin IGV; 0 si Odoo no lo valorizó.
 *
 * Uso:
 *   node scripts/syncKardexOdoo.js                       lee Odoo y reemplaza KardexOdoo en MongoDB
 *   node scripts/syncKardexOdoo.js --simular             solo muestra el resumen, no escribe nada
 *   node scripts/syncKardexOdoo.js --simular --item 1160 --op CDL28
 *                                                        + detalle semanal del item y cuadre con stock.quant
 *
 * Variables de entorno: MONGODB_URI, ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY (ver utils/odooClient.js).
 */
require('dotenv').config({ quiet: true });
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const OdooClient = require('../utils/odooClient');
const KardexOdoo = require('../models/KardexOdoo');

// Almacén Odoo → operación de la app (los que no están aquí usan el mismo código)
const OPERACION_DE_ALMACEN = { PTAFK: 'PLANTA', GBPTA: 'GBPLANTA', GBGLF: 'GBGOL', GBFDR: 'GBCFR' };
const PLANTAS = new Set(['PTAFK', 'GBPTA']);

const LIMA_MS = 5 * 3600 * 1000;
const INICIO_31_10_UTC = '2026-10-31 05:00:00';   // 31/10 00:00 Lima
const NOVIEMBRE_UTC    = '2026-11-01 05:00:00';   // 01/11 00:00 Lima

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular');
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ITEM_PRUEBA = argVal('--item');
const OP_PRUEBA = (argVal('--op') || '').toUpperCase();

// ─── Reglas ───────────────────────────────────────────────────────

const esInicial = ref => /INICIAL|CORRECCION CANTIDADES/.test((ref || '').toUpperCase());
/** Carga inicial que cuenta como saldo al 31/10 (INICIAL y CORRECCION CANTIDADES de 02-03/11). */
function esApertura(ref) {
  const r = (ref || '').toUpperCase();
  return esInicial(r) && !r.startsWith('REGULARIZ') && !r.includes('POSTERIOR DESCARGOS');
}

function añoSemLima(fechaUtc) {
  const d = new Date(new Date(fechaUtc.replace(' ', 'T') + 'Z').getTime() - LIMA_MS);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  return t.getUTCFullYear() * 100 + semana;
}

/** TRX del movimiento visto desde el almacén `wh` (entra = true si el stock entra al almacén). */
function clasificar({ otra, entra, wh, ref, tipoOp, socioGrupo }) {
  const nombre = otra.complete_name || '';
  switch (otra.usage) {
    case 'supplier':   return 'COMPRA';
    case 'customer':   return socioGrupo ? 'TRANSFERENCIA' : 'VENTA';
    case 'production': return PLANTAS.has(wh)
      ? (entra ? 'PRODUCCION' : 'CONSUMO PRODUCCION')
      : (entra ? 'TRANSFORMACION' : 'CONSUMO TRANSFORMACION');
    case 'transit':
    case 'internal':   return 'TRANSFERENCIA';
    case 'inventory':
      if (/gastos generales/i.test(nombre)) return 'CONSUMOS';
      if (/rancho/i.test(nombre)) return 'RANCHO';
      if (/scrap/i.test(nombre)) return /merma/i.test(tipoOp || '') || /merma/i.test(ref || '') ? 'MERMA' : 'BAJA';
      if (/venta intercompany/i.test(nombre)) return 'TRANSFERENCIA';
      if (esInicial(ref)) return 'INICIAL';
      return entra ? 'SOBRANTE' : 'FALTANTE';
    default:
      return (otra.usage || 'OTRO').toUpperCase();
  }
}

// ─── Lectura de Odoo ──────────────────────────────────────────────

async function leerOdoo(odoo) {
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  const almacenes = await odoo.searchRead('stock.warehouse', [], ['code', 'name', 'company_id']);
  const whCode = Object.fromEntries(almacenes.map(w => [w.id, w.code]));
  const ubic = Object.fromEntries((await odoo.searchRead('stock.location', [['active', 'in', [true, false]]],
    ['complete_name', 'usage', 'warehouse_id'])).map(l => [l.id, l]));
  const sociosEmpresa = new Set((await odoo.searchRead('res.company', [], ['partner_id']))
    .map(c => c.partner_id && c.partner_id[0]).filter(Boolean));
  log(`Almacenes: ${almacenes.map(w => w.code).join(', ')}`);

  const lineas = await odoo.searchRead('stock.move.line', [['state', '=', 'done']],
    ['date', 'reference', 'location_id', 'location_dest_id', 'quantity_product_uom', 'move_id', 'product_id',
     'picking_id', 'picking_partner_id', 'picking_type_id']);
  log(`Movimientos hechos (líneas): ${lineas.length}`);

  // Producto → código legacy
  const prodIds = [...new Set(lineas.map(l => l.product_id[0]))];
  const legacy = {};
  for (let i = 0; i < prodIds.length; i += 500) {
    for (const p of await odoo.execute('product.product', 'read', [prodIds.slice(i, i + 500)],
      { fields: ['default_code_legacy', 'is_storable'] })) {
      // Solo productos con seguimiento de inventario (los consumibles sin stock no tienen saldo)
      if (p.default_code_legacy && p.is_storable) legacy[p.id] = String(p.default_code_legacy).trim();
    }
  }

  // Fecha programada de las transferencias
  const pickIds = [...new Set(lineas.filter(l => l.picking_id).map(l => l.picking_id[0]))];
  const programada = {};
  for (let i = 0; i < pickIds.length; i += 500) {
    for (const p of await odoo.execute('stock.picking', 'read', [pickIds.slice(i, i + 500)],
      { fields: ['scheduled_date', 'picking_type_code'] })) {
      if (p.scheduled_date && !(p.picking_type_code === 'incoming' && p.scheduled_date < NOVIEMBRE_UTC)) {
        programada[p.id] = p.scheduled_date;
      }
    }
  }

  // Socio de la transferencia → ¿es una empresa del grupo?
  const socioIds = [...new Set(lineas.filter(l => l.picking_partner_id).map(l => l.picking_partner_id[0]))];
  const socioGrupo = {};
  for (let i = 0; i < socioIds.length; i += 500) {
    for (const p of await odoo.execute('res.partner', 'read', [socioIds.slice(i, i + 500)],
      { fields: ['commercial_partner_id'] })) {
      socioGrupo[p.id] = sociosEmpresa.has(p.id) || !!(p.commercial_partner_id && sociosEmpresa.has(p.commercial_partner_id[0]));
    }
  }

  // Valorización por movimiento (stock.move) y cantidad total del movimiento
  const capas = await odoo.searchRead('stock.valuation.layer', [['stock_move_id', '!=', false]], ['stock_move_id', 'value']);
  const valorMov = {}, cantMov = {};
  for (const c of capas) valorMov[c.stock_move_id[0]] = (valorMov[c.stock_move_id[0]] || 0) + c.value;
  for (const l of lineas) if (l.move_id) cantMov[l.move_id[0]] = (cantMov[l.move_id[0]] || 0) + l.quantity_product_uom;
  log(`Capas de valorización: ${capas.length}`);

  const agg = new Map();
  const stats = { sinCodigo: 0, internas: 0, lineasKardex: 0 };
  const detalle = []; // movimientos del item de prueba
  const enAlmacen = l => l.usage === 'internal' && l.warehouse_id ? whCode[l.warehouse_id[0]] : null;

  for (const l of lineas) {
    const qty = l.quantity_product_uom;
    if (Math.abs(qty) < 1e-9) continue;
    const src = ubic[l.location_id[0]], dst = ubic[l.location_dest_id[0]];
    const whSrc = enAlmacen(src), whDst = enAlmacen(dst);
    if (whSrc === whDst) { stats.internas++; continue; }
    const item = legacy[l.product_id[0]];
    if (!item) { stats.sinCodigo++; continue; }

    let fecha = l.date;
    if (esApertura(l.reference)) fecha = INICIO_31_10_UTC;
    else if (l.picking_id && programada[l.picking_id[0]] && programada[l.picking_id[0]] < fecha) fecha = programada[l.picking_id[0]];
    const añosem = añoSemLima(fecha);

    const mid = l.move_id && l.move_id[0];
    const valor = mid && cantMov[mid] ? Math.abs(valorMov[mid] || 0) * qty / cantMov[mid] : 0;
    const socio = l.picking_partner_id ? socioGrupo[l.picking_partner_id[0]] : false;
    const tipoOp = l.picking_type_id ? l.picking_type_id[1] : '';

    for (const [wh, entra, otra] of [[whSrc, false, dst], [whDst, true, src]]) {
      if (!wh) continue;
      const trx = clasificar({ otra, entra, wh, ref: l.reference, tipoOp, socioGrupo: socio });
      const operacion = OPERACION_DE_ALMACEN[wh] || wh;
      const signo = entra ? 1 : -1;
      const k = `${operacion}|${item}|${añosem}|${trx}`;
      const a = agg.get(k) || { operacion, almacen: wh, item, añosem, trx, cantidad: 0, importe: 0 };
      a.cantidad += signo * qty;
      a.importe += signo * valor;
      agg.set(k, a);
      stats.lineasKardex++;
      if (ITEM_PRUEBA && item === ITEM_PRUEBA && (operacion === OP_PRUEBA || wh === OP_PRUEBA)) {
        detalle.push({ fecha, añosem, trx, cantidad: signo * qty, ref: l.reference });
      }
    }
  }
  return { filas: [...agg.values()], stats, detalle, almacenes, legacy };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log(`\nKardex desde Odoo${SIMULAR ? ' — SIMULACIÓN (no escribe nada)' : ''}`);
  const odoo = await OdooClient.conectar();
  const { filas, stats, detalle, almacenes, legacy } = await leerOdoo(odoo);

  filas.forEach(f => { f.cantidad = Math.round(f.cantidad * 1e6) / 1e6; f.importe = Math.round(f.importe * 100) / 100; });
  console.log(`\nFilas Kardex (operación × item × semana × TRX): ${filas.length}`);
  console.log(`Líneas omitidas: ${stats.internas} traslados dentro del mismo almacén, ${stats.sinCodigo} de productos sin código legacy o sin seguimiento de inventario`);

  // Resumen por operación y TRX
  const res = {};
  for (const f of filas) {
    res[f.operacion] = res[f.operacion] || {};
    res[f.operacion][f.trx] = (res[f.operacion][f.trx] || 0) + 1;
  }
  for (const [op, t] of Object.entries(res).sort()) {
    console.log(`  ${op.padEnd(9)} ${Object.entries(t).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  }
  const semanas = [...new Set(filas.map(f => f.añosem))].sort();
  console.log(`Semanas: ${semanas[0]} … ${semanas[semanas.length - 1]} (${semanas.length})`);

  // Cuadre de un item de prueba contra stock.quant
  if (ITEM_PRUEBA && OP_PRUEBA) {
    const wh = almacenes.find(w => w.code === OP_PRUEBA || (OPERACION_DE_ALMACEN[w.code] || w.code) === OP_PRUEBA);
    const op = OPERACION_DE_ALMACEN[wh.code] || wh.code;
    const propias = filas.filter(f => f.operacion === op && f.item === ITEM_PRUEBA).sort((a, b) => a.añosem - b.añosem);
    const porSem = {};
    for (const f of propias) { porSem[f.añosem] = porSem[f.añosem] || {}; porSem[f.añosem][f.trx] = f.cantidad; }
    let saldo = 0;
    console.log(`\nItem ${ITEM_PRUEBA} en ${op} (almacén Odoo ${wh.code}):`);
    for (const [s, m] of Object.entries(porSem)) {
      const ini = saldo; saldo += Object.values(m).reduce((a, b) => a + b, 0);
      console.log(`  ${s}  inicial ${ini.toFixed(3)}  ${Object.entries(m).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' | ')}  → final ${saldo.toFixed(3)}`);
    }
    const pids = Object.entries(legacy).filter(([, c]) => c === ITEM_PRUEBA).map(([id]) => +id);
    const quants = await odoo.searchRead('stock.quant', [['product_id', 'in', pids], ['location_id.usage', '=', 'internal'],
      ['location_id.warehouse_id', '=', wh.id]], ['quantity']);
    const stock = quants.reduce((a, q) => a + q.quantity, 0);
    console.log(`  Saldo Kardex: ${saldo.toFixed(3)} | Stock Odoo (stock.quant): ${stock.toFixed(3)} | ` +
      (Math.abs(saldo - stock) < 1e-3 ? 'CUADRA ✔' : `DIFERENCIA ${(saldo - stock).toFixed(3)} ✘`));
    if (args.includes('--detalle')) detalle.sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(d => console.log('   ', d.fecha, d.añosem, d.trx, d.cantidad, d.ref));
  }

  // Cuadre global: saldo del Kardex por operación × item vs. stock.quant de Odoo
  const quants = await odoo.searchRead('stock.quant', [['location_id.usage', '=', 'internal'],
    ['location_id.warehouse_id', '!=', false]], ['product_id', 'warehouse_id', 'quantity']);
  const whPorId = Object.fromEntries(almacenes.map(w => [w.id, w.code]));
  const saldoK = {}, saldoQ = {};
  for (const f of filas) saldoK[`${f.operacion}|${f.item}`] = (saldoK[`${f.operacion}|${f.item}`] || 0) + f.cantidad;
  for (const q of quants) {
    const item = legacy[q.product_id[0]];
    const wh = q.warehouse_id && whPorId[q.warehouse_id[0]];
    if (!item || !wh) continue;
    const k = `${OPERACION_DE_ALMACEN[wh] || wh}|${item}`;
    saldoQ[k] = (saldoQ[k] || 0) + q.quantity;
  }
  const difs = [...new Set([...Object.keys(saldoK), ...Object.keys(saldoQ)])]
    .map(k => ({ k, d: (saldoK[k] || 0) - (saldoQ[k] || 0) })).filter(x => Math.abs(x.d) > 1e-3);
  console.log(`\nCuadre con stock.quant: ${Object.keys(saldoK).length} operación×item; ${difs.length} con diferencia` +
    (difs.length ? ` (p.ej. ${difs.slice(0, 5).map(x => `${x.k}: ${x.d.toFixed(3)}`).join(', ')})` : ' ✔'));

  if (SIMULAR) { console.log('\nSimulación: no se escribió en MongoDB.'); return; }

  await mongoose.connect(process.env.MONGODB_URI);
  const ahora = new Date();
  await KardexOdoo.deleteMany({});
  for (let i = 0; i < filas.length; i += 5000) {
    await KardexOdoo.insertMany(filas.slice(i, i + 5000).map(f => ({ ...f, sincronizadoEn: ahora })), { ordered: false });
  }
  console.log(`\nMongoDB: KardexOdoo reemplazado con ${filas.length} filas.`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

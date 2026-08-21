// Reconciliación de movimientos bancarios sin asignar — usada tanto por el
// sync diario (scripts/importFlujoCaja.js) como por el endpoint manual
// (POST /api/flujo-caja/reconciliar). Aplica, en orden:
//   1. Reglas de glosa (FlujoGlosaRegla)
//   2. Cruce contra pagos del ERP, agrupados por (cuentaBancaria, numeroPago)
//      y sumados, contra el proveedor -> subdetalle (FlujoProveedorDetalle)
// Ambos métodos asignan subdetalleCodigo (el nivel más granular) — LINEA y
// DETALLE se derivan de ahí, no se guardan por separado. Los movimientos
// que ninguno de los dos métodos resuelve quedan con subdetalleCodigo=null,
// para asignación manual (método 3) desde la app.

const FlujoMovimientoBancario = require('../models/FlujoMovimientoBancario');
const FlujoPagoERP            = require('../models/FlujoPagoERP');
const FlujoGlosaRegla         = require('../models/FlujoGlosaRegla');
const FlujoProveedorDetalle   = require('../models/FlujoProveedorDetalle');
const FlujoCuentaBanco        = require('../models/FlujoCuentaBanco');

const TOL_IMPORTE = 1; // soles/dólares de tolerancia por comisiones/ITF del banco

function normBeneficiario(s) { return String(s || '').trim().toUpperCase(); }
// El número de operación del banco puede venir con ceros a la izquierda
// (ej. BBVA: "0000004569") mientras que NumeroPago del ERP es numérico —
// se normalizan ambos a entero antes de comparar.
function normNumOp(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

// Un movimiento ya desglosado manualmente (splits) no debe ser tocado por los
// métodos automáticos, aunque subdetalleCodigo quede en null para ese caso.
const SIN_ASIGNAR = { subdetalleCodigo: null, $or: [{ splits: { $exists: false } }, { splits: { $size: 0 } }] };

async function asignarPorGlosa(sociedad) {
  const reglas = await FlujoGlosaRegla.find({}).lean();
  if (!reglas.length) return 0;
  const pendientes = await FlujoMovimientoBancario.find({ sociedad, ...SIN_ASIGNAR }).lean();

  let asignados = 0;
  const ops = [];
  for (const mov of pendientes) {
    const glosa = mov.glosa || '';
    const regla = reglas.find(r => r.criterio === 'exacta' ? glosa === r.texto : glosa.includes(r.texto));
    if (!regla) continue;
    ops.push({
      updateOne: {
        filter: { _id: mov._id },
        update: { subdetalleCodigo: regla.subdetalleCodigo, metodoAsignacion: 'glosa', asignadoEn: new Date() },
      },
    });
    asignados++;
  }
  if (ops.length) await FlujoMovimientoBancario.bulkWrite(ops);
  return asignados;
}

async function asignarPorERP(sociedad) {
  const [cuentas, proveedores, pendientes] = await Promise.all([
    FlujoCuentaBanco.find({ sociedad }).lean(),
    FlujoProveedorDetalle.find({}).lean(),
    FlujoMovimientoBancario.find({ sociedad, ...SIN_ASIGNAR }).lean(),
  ]);
  if (!pendientes.length || !cuentas.length) return 0;

  // Igual que las reglas de glosa: 'exacta' se resuelve por Map (O(1)),
  // 'contiene' requiere recorrer la lista buscando si el texto configurado
  // está contenido en el PAGARA del pago.
  const provExactos = new Map(
    proveedores.filter(p => (p.criterio || 'exacta') === 'exacta')
      .map(p => [normBeneficiario(p.beneficiario), p.subdetalleCodigo])
  );
  const provContiene = proveedores.filter(p => p.criterio === 'contiene');
  function resolverProveedor(pagarA) {
    const norm = normBeneficiario(pagarA);
    if (provExactos.has(norm)) return provExactos.get(norm);
    const match = provContiene.find(p => norm.includes(normBeneficiario(p.beneficiario)));
    return match ? match.subdetalleCodigo : null;
  }

  // Agrupar pagos ERP por cuenta bancaria + numeroPago, resolviendo cada
  // cuenta a su banco/moneda para saber contra qué movimientos comparar.
  const pagos = await FlujoPagoERP.find({ sociedad }).lean();
  const grupos = new Map(); // "banco|moneda|numeroPago" -> { montoLocal, montoExtranjero, pagarA }
  for (const p of pagos) {
    const cuenta = cuentas.find(c => c.cuentaBancaria === p.cuentaBancaria);
    if (!cuenta) continue; // cuenta ERP sin mapear a banco/moneda todavía
    const key = `${cuenta.banco}|${cuenta.moneda}|${p.numeroPago}`;
    if (!grupos.has(key)) grupos.set(key, { montoLocal: 0, montoExtranjero: 0, pagarA: p.pagarA });
    const g = grupos.get(key);
    g.montoLocal += p.montoLocal || 0;
    g.montoExtranjero += p.montoExtranjero || 0;
  }

  let asignados = 0;
  const ops = [];
  const usados = new Set(); // movimiento._id ya reclamado en esta pasada
  for (const mov of pendientes) {
    const numOp = normNumOp(mov.numeroOperacion);
    if (numOp === null) continue;
    const key = `${mov.banco}|${mov.moneda}|${numOp}`;
    const g = grupos.get(key);
    if (!g) continue;
    const montoErp = mov.moneda === 'USD' ? g.montoExtranjero : g.montoLocal;
    if (Math.abs(montoErp - Math.abs(mov.importe)) > TOL_IMPORTE) continue;
    const subdetalleCodigo = resolverProveedor(g.pagarA);
    if (!subdetalleCodigo) continue; // el proveedor existe pero no está mapeado a un subdetalle
    if (usados.has(String(mov._id))) continue;
    usados.add(String(mov._id));
    ops.push({
      updateOne: {
        filter: { _id: mov._id },
        update: { subdetalleCodigo, metodoAsignacion: 'erp', asignadoEn: new Date(), proveedor: g.pagarA || '' },
      },
    });
    asignados++;
  }
  if (ops.length) await FlujoMovimientoBancario.bulkWrite(ops);
  return asignados;
}

/** Corre los métodos 1 y 2 sobre los movimientos sin asignar de una sociedad. Idempotente. */
async function reconciliar(sociedad) {
  const porGlosa = await asignarPorGlosa(sociedad);
  const porERP = await asignarPorERP(sociedad);
  const sinAsignar = await FlujoMovimientoBancario.countDocuments({ sociedad, subdetalleCodigo: null });
  return { porGlosa, porERP, sinAsignar };
}

module.exports = { reconciliar };

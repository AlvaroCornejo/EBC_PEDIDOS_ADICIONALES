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

// El ERP a veces trae espacios dobles/múltiples entre palabras (ej. "MINCHAN  APARICIO"
// con doble espacio) — se colapsan a uno solo para que el criterio "contiene" no falle
// por un problema de formato del dato de origen, no del beneficiario en sí.
function normBeneficiario(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }
// El número de operación del banco puede venir con ceros a la izquierda
// (ej. BBVA: "0000004569") mientras que NumeroPago del ERP es numérico —
// se normalizan ambos a entero antes de comparar.
function normNumOp(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

// Un movimiento ya desglosado manualmente (splits) no debe ser tocado por los
// métodos automáticos, aunque subdetalleCodigo quede en null para ese caso.
const SIN_ASIGNAR = { subdetalleCodigo: null, $or: [{ splits: { $exists: false } }, { splits: { $size: 0 } }] };

// Prioridad, de mayor a menor: exacta+específica de la sociedad, exacta
// global (sin sociedad), contiene+específica, contiene global. Una regla
// con sociedad solo se evalúa para movimientos de esa sociedad; sin
// sociedad (vacío) aplica a todas. Entre varias reglas del mismo nivel de
// prioridad, gana la primera en el orden que devuelve Mongo.
function resolverReglaGlosa(reglas, glosa, sociedad) {
  const aplica = r => !r.sociedad || r.sociedad === sociedad;
  const candidatas = reglas.filter(aplica);
  return candidatas.find(r => r.criterio === 'exacta' && r.sociedad && glosa === r.texto)
    || candidatas.find(r => r.criterio === 'exacta' && !r.sociedad && glosa === r.texto)
    || candidatas.find(r => r.criterio === 'contiene' && r.sociedad && glosa.includes(r.texto))
    || candidatas.find(r => r.criterio === 'contiene' && !r.sociedad && glosa.includes(r.texto))
    || null;
}

// Mismo patrón de prioridad que resolverReglaGlosa, aplicado a Proveedores
// (beneficiario -> subdetalle). Devuelve el subdetalleCodigo o null.
function resolverProveedor(proveedores, pagarA, sociedad) {
  const norm = normBeneficiario(pagarA);
  const aplica = p => !p.sociedad || p.sociedad === sociedad;
  const candidatos = proveedores.filter(aplica);
  const match = candidatos.find(p => (p.criterio || 'exacta') === 'exacta' && p.sociedad && normBeneficiario(p.beneficiario) === norm)
    || candidatos.find(p => (p.criterio || 'exacta') === 'exacta' && !p.sociedad && normBeneficiario(p.beneficiario) === norm)
    || candidatos.find(p => p.criterio === 'contiene' && p.sociedad && norm.includes(normBeneficiario(p.beneficiario)))
    || candidatos.find(p => p.criterio === 'contiene' && !p.sociedad && norm.includes(normBeneficiario(p.beneficiario)))
    || null;
  return match ? match.subdetalleCodigo : null;
}

async function asignarPorGlosa(sociedad) {
  const reglas = await FlujoGlosaRegla.find({}).lean();
  if (!reglas.length) return 0;
  const pendientes = await FlujoMovimientoBancario.find({ sociedad, ...SIN_ASIGNAR }).lean();

  let asignados = 0;
  const ops = [];
  for (const mov of pendientes) {
    const glosa = mov.glosa || '';
    const regla = resolverReglaGlosa(reglas, glosa, sociedad);
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

  // Agrupar pagos ERP por cuenta bancaria + numeroPago, resolviendo cada
  // cuenta a su banco/moneda para saber contra qué movimientos comparar.
  // Se guarda el arreglo completo de pagos del grupo (no solo el primero) —
  // un pago masivo trae varios beneficiarios bajo el mismo número de
  // operación, y cada uno debe ir a su propio subdetalle.
  const pagos = await FlujoPagoERP.find({ sociedad }).lean();
  const grupos = new Map(); // "banco|moneda|numeroPago" -> [pagos...]
  for (const p of pagos) {
    const cuenta = cuentas.find(c => c.cuentaBancaria === p.cuentaBancaria);
    if (!cuenta) continue; // cuenta ERP sin mapear a banco/moneda todavía
    const key = `${cuenta.banco}|${cuenta.moneda}|${p.numeroPago}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }

  let asignados = 0;
  const ops = [];
  const usados = new Set(); // movimiento._id ya reclamado en esta pasada
  for (const mov of pendientes) {
    const numOp = normNumOp(mov.numeroOperacion);
    if (numOp === null) continue;
    const key = `${mov.banco}|${mov.moneda}|${numOp}`;
    const grupo = grupos.get(key);
    if (!grupo || !grupo.length) continue;
    const montoLocalTotal = grupo.reduce((s, p) => s + (p.montoLocal || 0), 0);
    const montoExtTotal = grupo.reduce((s, p) => s + (p.montoExtranjero || 0), 0);
    const montoErp = mov.moneda === 'USD' ? montoExtTotal : montoLocalTotal;
    if (Math.abs(montoErp - Math.abs(mov.importe)) > TOL_IMPORTE) continue;
    if (usados.has(String(mov._id))) continue;

    if (grupo.length === 1) {
      const subdetalleCodigo = resolverProveedor(proveedores, grupo[0].pagarA, sociedad);
      if (!subdetalleCodigo) continue; // el proveedor existe pero no está mapeado a un subdetalle
      usados.add(String(mov._id));
      ops.push({
        updateOne: {
          filter: { _id: mov._id },
          update: { subdetalleCodigo, metodoAsignacion: 'erp', asignadoEn: new Date(), proveedor: grupo[0].pagarA || '' },
        },
      });
      asignados++;
      continue;
    }

    // Pago masivo: resolver cada beneficiario a su propio subdetalle. Si
    // alguno no está mapeado, no se asigna nada — mejor dejarlo pendiente
    // (visible en "sin asignar", con motivo) que repartir mal el importe.
    const signo = mov.importe < 0 ? -1 : 1;
    const porSubdetalle = new Map(); // subdetalleCodigo -> monto acumulado
    let faltante = false;
    for (const p of grupo) {
      const subdetalleCodigo = resolverProveedor(proveedores, p.pagarA, sociedad);
      if (!subdetalleCodigo) { faltante = true; break; }
      const montoAbs = mov.moneda === 'USD' ? (p.montoExtranjero || 0) : (p.montoLocal || 0);
      porSubdetalle.set(subdetalleCodigo, (porSubdetalle.get(subdetalleCodigo) || 0) + signo * montoAbs);
    }
    if (faltante || !porSubdetalle.size) continue;

    const splits = [...porSubdetalle.entries()].map(([subdetalleCodigo, monto]) => ({ subdetalleCodigo, monto }));
    // La suma exacta de los pagos individuales puede diferir del importe real
    // del banco por centavos (comisiones/redondeo) — se ajusta en la última
    // línea para que splits siempre sume exactamente el importe del movimiento.
    const diff = mov.importe - splits.reduce((s, x) => s + x.monto, 0);
    if (Math.abs(diff) > 0.001) splits[splits.length - 1].monto += diff;

    usados.add(String(mov._id));
    ops.push({
      updateOne: {
        filter: { _id: mov._id },
        update: { subdetalleCodigo: null, splits, metodoAsignacion: 'erp', asignadoEn: new Date(), proveedor: '' },
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

/**
 * Explica, sin modificar nada, por qué cada movimiento de `pendientes` no
 * quedó asignado — replica la misma lógica de asignarPorGlosa/asignarPorERP
 * pero devolviendo el motivo de cada fallo en vez de aplicar el resultado.
 * Usado por GET /movimientos?sinAsignar=true para mostrarle al usuario si
 * falló por glosa, por el cruce ERP (sin pago / importe no coincide) o por
 * proveedor sin mapear.
 */
async function diagnosticar(sociedad, pendientes) {
  if (!pendientes.length) return pendientes;

  const [reglas, cuentas, proveedores, pagos] = await Promise.all([
    FlujoGlosaRegla.find({}).lean(),
    FlujoCuentaBanco.find({ sociedad }).lean(),
    FlujoProveedorDetalle.find({}).lean(),
    FlujoPagoERP.find({ sociedad }).lean(),
  ]);

  const grupos = new Map(); // "banco|moneda|numeroPago" -> [pagos...]
  for (const p of pagos) {
    const cuenta = cuentas.find(c => c.cuentaBancaria === p.cuentaBancaria);
    if (!cuenta) continue;
    const key = `${cuenta.banco}|${cuenta.moneda}|${p.numeroPago}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }

  return pendientes.map(mov => {
    const motivos = [];
    const glosa = mov.glosa || '';

    if (!reglas.length) motivos.push('Glosa: no hay reglas configuradas');
    else if (!glosa) motivos.push('Glosa: el movimiento no trae texto de glosa');
    else {
      const regla = resolverReglaGlosa(reglas, glosa, sociedad);
      if (!regla) motivos.push('Glosa: ninguna regla coincide con el texto');
    }

    const numOp = normNumOp(mov.numeroOperacion);
    if (numOp === null) {
      motivos.push('ERP: sin número de operación legible');
    } else if (!cuentas.length) {
      motivos.push('ERP: la sociedad no tiene cuentas bancarias mapeadas (Cuentas ERP↔Banco)');
    } else {
      const key = `${mov.banco}|${mov.moneda}|${numOp}`;
      const grupo = grupos.get(key);
      if (!grupo || !grupo.length) {
        motivos.push('ERP: no hay ningún pago con ese número de operación');
      } else {
        const montoLocalTotal = grupo.reduce((s, p) => s + (p.montoLocal || 0), 0);
        const montoExtTotal = grupo.reduce((s, p) => s + (p.montoExtranjero || 0), 0);
        const montoErp = mov.moneda === 'USD' ? montoExtTotal : montoLocalTotal;
        if (Math.abs(montoErp - Math.abs(mov.importe)) > TOL_IMPORTE) {
          motivos.push(`ERP: el importe no coincide (pago ERP: ${montoErp.toFixed(2)}, banco: ${Math.abs(mov.importe).toFixed(2)})`);
        } else if (grupo.length === 1) {
          const subdetalleCodigo = resolverProveedor(proveedores, grupo[0].pagarA, sociedad);
          if (!subdetalleCodigo) motivos.push(`Proveedor: "${grupo[0].pagarA}" no está mapeado a un subdetalle`);
        } else {
          const faltantes = grupo.filter(p => !resolverProveedor(proveedores, p.pagarA, sociedad));
          if (faltantes.length) {
            const nombres = [...new Set(faltantes.map(p => p.pagarA))];
            motivos.push(`Pago masivo (${grupo.length} beneficiarios): ${faltantes.length} sin mapear — ${nombres.slice(0, 3).map(n => `"${n}"`).join(', ')}${nombres.length > 3 ? `, +${nombres.length - 3} más` : ''}`);
          }
        }
      }
    }

    if (!motivos.length) motivos.push('Sin motivo determinado');
    return { ...mov, motivos };
  });
}

/**
 * Arma el desglose por beneficiario de un movimiento que corresponde a un
 * pago masivo del ERP (mismo numeroPago, varios PagoERP), para precargar el
 * modal de reclasificación manual. Agrupa los beneficiarios que sí resuelven
 * a un subdetalle (sumando su monto), y deja una fila aparte por cada
 * beneficiario sin mapear, para que el usuario solo tenga que completar esas.
 * Devuelve null si no aplica (sin numeroOperacion, o no es un pago masivo).
 */
async function desgloseErpMovimiento(mov) {
  const numOp = normNumOp(mov.numeroOperacion);
  if (numOp === null) return null;

  const [cuentas, pagos, proveedores] = await Promise.all([
    FlujoCuentaBanco.find({ sociedad: mov.sociedad }).lean(),
    FlujoPagoERP.find({ sociedad: mov.sociedad }).lean(),
    FlujoProveedorDetalle.find({}).lean(),
  ]);

  const grupos = new Map();
  for (const p of pagos) {
    const cuenta = cuentas.find(c => c.cuentaBancaria === p.cuentaBancaria);
    if (!cuenta) continue;
    const key = `${cuenta.banco}|${cuenta.moneda}|${p.numeroPago}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }

  const key = `${mov.banco}|${mov.moneda}|${numOp}`;
  const grupo = grupos.get(key);
  if (!grupo || grupo.length <= 1) return null;

  const signo = mov.importe < 0 ? -1 : 1;
  const resueltos = new Map(); // subdetalleCodigo -> { monto, beneficiarios:Set }
  const filas = [];
  for (const p of grupo) {
    const montoAbs = mov.moneda === 'USD' ? (p.montoExtranjero || 0) : (p.montoLocal || 0);
    const monto = signo * montoAbs;
    const subdetalleCodigo = resolverProveedor(proveedores, p.pagarA, mov.sociedad);
    if (subdetalleCodigo) {
      if (!resueltos.has(subdetalleCodigo)) resueltos.set(subdetalleCodigo, { monto: 0, beneficiarios: new Set() });
      const acc = resueltos.get(subdetalleCodigo);
      acc.monto += monto;
      acc.beneficiarios.add(p.pagarA);
    } else {
      filas.push({ subdetalleCodigo: null, monto, beneficiarios: [p.pagarA] });
    }
  }
  for (const [subdetalleCodigo, { monto, beneficiarios }] of resueltos) {
    filas.unshift({ subdetalleCodigo, monto, beneficiarios: [...beneficiarios] });
  }

  // Ajuste de redondeo (centavos de comisión) a la última fila, igual que en asignarPorERP.
  const diff = mov.importe - filas.reduce((s, f) => s + f.monto, 0);
  if (filas.length && Math.abs(diff) > 0.001) filas[filas.length - 1].monto += diff;

  return filas;
}

module.exports = { reconciliar, diagnosticar, desgloseErpMovimiento };

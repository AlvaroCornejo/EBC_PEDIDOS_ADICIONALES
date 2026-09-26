const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiMetaVersion = require('../models/KpiMetaVersion');
const KpiArea        = require('../models/KpiArea');

// Carga inicial del catálogo de Indicadores GAF (40 KPIs), editable después por el admin.
// Metas acordadas con el usuario; los umbrales ámbar son valores por defecto propuestos
// (margen razonable según la unidad) para que el admin los ajuste. KPIs sin meta quedan
// informativos. Unidades y responsables van vacíos: los asigna el admin (no todas las
// operaciones tienen todos los KPIs). Todos DIRECTO; el admin puede pasarlos a RATIO.
//
// Formato: [codigo, nombre, unidad, sentido, frecuencia, fuente, meta]
//   meta MAYOR/MENOR: [meta, umbralAmbar] · RANGO: [min, max, tolerancia] · null: informativo
const M = 'MENSUAL', S = 'SEMANAL';
const CATALOGO = {
  COMPRAS: [
    ['COM-01', 'Tiempo de emisión de OC', 'horas', 'MENOR', M, 'SPRING', [24, 36]],
    ['COM-02', 'OTIF de proveedores', '%', 'MAYOR', M, 'SPRING', [95, 90]],
    ['COM-03', 'Compras urgentes', '%', 'MENOR', M, 'SPRING', [10, 15]],
    ['COM-04', 'Variación de precio de top 20 insumos', '%', 'MENOR', M, 'SPRING', null],
    ['COM-05', 'Ahorro en cotizaciones', 'S/', 'MAYOR', M, 'Manual', null],
    ['COM-06', 'Compras sin OC', '%', 'MENOR', M, 'SPRING', [2, 3]],
    ['COM-07', 'Match OC–guía–factura a la primera', '%', 'MAYOR', M, 'SPRING', [95, 90]],
  ],
  TESORERIA: [
    ['TES-01', 'Cumplimiento de la corrida semanal de pagos', '%', 'MAYOR', S, 'EBC Gestión de Pagos', [100, 95]],
    ['TES-02', 'Pagos fuera de corrida', 'numero', 'MENOR', S, 'EBC Gestión de Pagos', null],
    ['TES-03', 'Detracciones pagadas a tiempo', '%', 'MAYOR', M, 'SUNAT', [100, 95]],
    ['TES-04', 'Cuentas conciliadas al día 5', '%', 'MAYOR', M, 'BBVA', [100, 95]],
    ['TES-05', 'Partidas conciliatorias mayores a 30 días', 'numero', 'MENOR', M, 'BBVA', [0, 3]],
    ['TES-06', 'Precisión del flujo de caja', '%', 'RANGO', M, 'EBC Flujo de Caja', [-10, 10, 5]],
    ['TES-07', 'Spread de tipo de cambio vs referencia', '%', 'MENOR', M, 'BBVA', null],
  ],
  CONTABILIDAD: [
    ['CON-01', 'Días hábiles de cierre', 'dias', 'MENOR', M, 'Manual', [8, 10]],
    ['CON-02', 'Cumplimiento del cronograma de cierre', '%', 'MAYOR', M, 'Manual', [95, 90]],
    ['CON-03', 'Obligaciones tributarias y laborales a tiempo', '%', 'MAYOR', M, 'SUNAT', [100, 95]],
    ['CON-04', 'Multas e intereses SUNAT', 'S/', 'MENOR', M, 'SUNAT', [0, 0]],
    ['CON-05', 'Ajustes post-cierre', 'numero', 'MENOR', M, 'SPRING', null],
    ['CON-06', 'Cuentas de balance analizadas', '%', 'MAYOR', M, 'Manual', [100, 95]],
    ['CON-07', 'Comprobantes pendientes al cierre', 'numero', 'MENOR', M, 'SPRING', null],
    ['CON-08', 'Diferencias con el SIRE', 'numero', 'MENOR', M, 'SIRE', [0, 3]],
  ],
  TI: [
    ['TI-01', 'Disponibilidad de sistemas críticos', '%', 'MAYOR', M, 'Monitoreo TI', [99.5, 99]],
    ['TI-02', 'Incidentes que detienen la venta', 'numero', 'MENOR', M, 'Tickets TI', [0, 0]],
    ['TI-03', 'Tickets dentro del SLA', '%', 'MAYOR', M, 'Tickets TI', [90, 85]],
    ['TI-04', 'Primera respuesta en tickets críticos', 'horas', 'MENOR', M, 'Tickets TI', [2, 4]],
    ['TI-05', 'Backups exitosos', '%', 'MAYOR', M, 'Manual', [100, 95]],
    ['TI-06', 'Equipos con antivirus y parches al día', '%', 'MAYOR', M, 'Manual', [95, 90]],
    ['TI-07', 'Bajas de accesos en ≤48 h', '%', 'MAYOR', M, 'Tickets TI', [100, 95]],
  ],
  PROYECTOS: [
    ['PRY-01', 'Proyectos en plazo', '%', 'MAYOR', M, 'Manual', [80, 75]],
    ['PRY-02', 'Proyectos en presupuesto (desviación)', '%', 'RANGO', M, 'Manual', [-10, 10, 5]],
    ['PRY-03', 'Hitos cumplidos', '%', 'MAYOR', M, 'Manual', [90, 85]],
    ['PRY-04', 'Beneficio logrado vs esperado', '%', 'MAYOR', M, 'Manual', [80, 75]],
  ],
  COSTOS: [
    ['COS-01', 'Food cost real vs teórico', 'pp', 'MENOR', M, 'SPRING', [1.5, 2]],
    ['COS-02', 'Diferencias de inventario / costo de ventas', '%', 'MENOR', M, 'SPRING', [1, 1.5]],
    ['COS-03', 'Exactitud de inventario', '%', 'MAYOR', M, 'SPRING', [95, 90]],
    ['COS-04', 'Recetas actualizadas', '%', 'MAYOR', M, 'SPRING', [100, 95]],
    ['COS-05', 'Productos vendidos sin receta', 'numero', 'MENOR', M, 'SPRING', [0, 5]],
    ['COS-06', 'Merma registrada vs esperada', '%', 'MENOR', M, 'SPRING', null],
    ['COS-07', 'Inventarios ejecutados según calendario', '%', 'MAYOR', M, 'Manual', [100, 95]],
  ],
};

const VIGENTE_DESDE = '2026-01-01';
const PLAZO = { SEMANAL: 2, MENSUAL: 8 };

// Idempotente: solo crea los KPIs cuyo código no existe (nunca pisa lo editado por el admin).
async function sembrarKpis(creadoPor = 'SEED') {
  await KpiArea.asegurarSeed();
  let creados = 0;
  for (const [areaCodigo, kpis] of Object.entries(CATALOGO)) {
    for (const [codigo, nombre, unidad, sentido, frecuencia, fuente, meta] of kpis) {
      if (await KpiDefinicion.exists({ codigo })) continue;
      const kpi = await KpiDefinicion.create({
        codigo, nombre, areaCodigo, unidad, sentido, frecuencia, fuente,
        plazoCapturaDias: PLAZO[frecuencia], creadoPor,
      });
      if (meta) {
        const campos = sentido === 'RANGO'
          ? { rangoMin: meta[0], rangoMax: meta[1], tolerancia: meta[2] }
          : { meta: meta[0], umbralAmbar: meta[1] };
        await KpiMetaVersion.create({ kpiId: kpi._id, vigenteDesde: VIGENTE_DESDE, motivo: 'Carga inicial', creadoPor, ...campos });
      }
      creados++;
    }
  }
  return creados;
}

module.exports = { sembrarKpis, CATALOGO };

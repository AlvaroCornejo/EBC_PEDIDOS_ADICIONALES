const KpiDefinicion  = require('../models/KpiDefinicion');
const KpiArea        = require('../models/KpiArea');
const KpiRegistro    = require('../models/KpiRegistro');
const User           = require('../models/User');
const Config         = require('../models/Config');
const P = require('./kpiPeriodo');
const { resumenArea } = require('./kpiSemaforo');
const { metaVigente, versionesPorKpi, snapshot } = require('./kpiMetas');

// Cálculo del dashboard de Indicadores GAF. Compartido por el dashboard, el panel de
// pendientes, la exportación a Excel y las notificaciones, para que todos digan lo mismo.
// `acc` = resultado de utils/kpiAcceso.resolverAcceso (limita TODO a las áreas visibles).
// `hoy` se recibe como parámetro ('YYYY-MM-DD') para poder probar fechas fijas.
//
// Estado de un KPI×unidad en un periodo:
//   VERDE / AMBAR / ROJO — registrado, con meta
//   null (informativo)   — registrado, sin meta
//   SIN_DATO             — venció el plazo de captura y no hay registro (semáforo gris)
//   PENDIENTE            — sin registro pero todavía en plazo (no cuenta para el resumen)
//   NO_EXIGIBLE          — venció antes de que el KPI existiera (no se exige ni se cuenta)

// Periodo que representa a un KPI cuando el filtro es el mes `mes` ('YYYY-MM'):
// mensual → ese mes; semanal → la última semana que empieza dentro del mes (sin pasar de hoy).
function periodoReferencia(frecuencia, mes, hoy) {
  if (frecuencia === 'MENSUAL') return mes;
  const { inicio, fin } = P.rango(mes);
  let semana = P.periodoDeFecha(inicio, 'SEMANAL');
  if (P.rango(semana).inicio < inicio) semana = P.desplazar(semana, 1);
  const primera = semana;
  for (let s = semana; P.rango(s).inicio <= fin && P.rango(s).inicio <= hoy; s = P.desplazar(s, 1)) semana = s;
  return P.rango(semana).inicio <= hoy ? semana : primera;
}

const fechaLima = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(d));

function estadoSinRegistro(kpi, periodo, hoy) {
  const vence = P.vencimiento(periodo, kpi.plazoCapturaDias);
  if (vence >= hoy) return 'PENDIENTE';
  return vence < fechaLima(kpi.creadoEn) ? 'NO_EXIGIBLE' : 'SIN_DATO';
}

// ¿La variación es una mejora? true/false/null según el sentido del KPI.
function esMejora(kpi, meta, actual, anterior) {
  if (actual === anterior) return null;
  if (kpi.sentido === 'MAYOR') return actual > anterior;
  if (kpi.sentido === 'MENOR') return actual < anterior;
  if (!meta || meta.rangoMin == null) return null;
  const dist = (v) => Math.max(meta.rangoMin - v, 0, v - meta.rangoMax); // distancia al rango
  const da = dist(actual), db = dist(anterior);
  return da === db ? null : da < db;
}

async function kpisVisibles(acc, { area, unidad, kpiId } = {}) {
  const f = { ...acc.filtroAreas(), activo: true, 'unidades.0': { $exists: true } };
  if (area) f.areaCodigo = acc.puedeVer(area) ? area : '__ninguna__';
  if (unidad) f.unidades = unidad;
  if (kpiId) f._id = kpiId;
  return KpiDefinicion.find(f).sort({ areaCodigo: 1, codigo: 1 }).lean();
}

// Registros de los KPIs indicados desde `desde` ('YYYY-MM-DD'), indexados por kpi|unidad|periodo.
async function indiceRegistros(kpis, desde) {
  const regs = await KpiRegistro.find({ kpiId: { $in: kpis.map(k => k._id) }, periodoInicio: { $gte: desde } }).lean();
  return new Map(regs.map(r => [`${r.kpiId}|${r.unidadCodigo}|${r.periodo}`, r]));
}

async function reglaResumen() {
  return (await Config.findOne({ key: 'kpiReglaResumen' }).lean())?.value || 'MAS_FRECUENTE_PISO_AMBAR';
}

async function construirTablero(acc, { mes, area, unidad, hoy = P.hoyLima() } = {}) {
  mes = P.esValido(mes || '', 'MENSUAL') ? mes : P.anterior(P.periodoDeFecha(hoy, 'MENSUAL'));
  const [kpis, areas, regla, todos] = await Promise.all([
    kpisVisibles(acc, { area, unidad }),
    KpiArea.find({ codigo: { $in: [...acc.lectura] } }).sort({ orden: 1 }).lean(),
    reglaResumen(),
    kpisVisibles(acc), // para la lista de unidades del filtro
  ]);
  const refs = new Map(kpis.map(k => [String(k._id), periodoReferencia(k.frecuencia, mes, hoy)]));
  const ventanas = new Map(kpis.map(k => [String(k._id), P.ultimos(refs.get(String(k._id)), 12)]));
  const desde = [...ventanas.values()].map(v => P.rango(v[0]).inicio).sort()[0] || mes;
  const [indice, versiones] = await Promise.all([indiceRegistros(kpis, desde), versionesPorKpi(kpis.map(k => k._id))]);

  const porArea = new Map(areas.map(a => [a.codigo, []]));
  for (const k of kpis) {
    const id = String(k._id), ref = refs.get(id), vs = versiones.get(id) || [];
    const filas = k.unidades.filter(u => !unidad || u === unidad).map(u => {
      const reg = indice.get(`${id}|${u}|${ref}`);
      const ant = indice.get(`${id}|${u}|${P.anterior(ref)}`);
      const meta = reg ? reg.meta : snapshot(metaVigente(vs, u, P.rango(ref).inicio));
      return {
        unidad: u, periodo: ref, etiqueta: P.etiqueta(ref),
        vence: P.vencimiento(ref, k.plazoCapturaDias),
        estado: reg ? reg.semaforo : estadoSinRegistro(k, ref, hoy),
        registrado: !!reg, registroId: reg?._id || null, valor: reg?.valor ?? null, meta,
        corregido: !!reg?.corregido, comentario: reg?.comentario || '', adjuntos: reg?.adjuntos.length || 0,
        anterior: ant ? { periodo: ant.periodo, valor: ant.valor } : null,
        variacion: reg && ant ? Math.round((reg.valor - ant.valor) * 1e6) / 1e6 : null, // sin ruido de coma flotante
        mejora: reg && ant ? esMejora(k, meta, reg.valor, ant.valor) : null,
        tendencia: ventanas.get(id).map(p => {
          const r = indice.get(`${id}|${u}|${p}`);
          return { periodo: p, etiqueta: P.etiqueta(p), valor: r?.valor ?? null, semaforo: r ? r.semaforo : null, registrado: !!r };
        }),
      };
    });
    porArea.get(k.areaCodigo)?.push({
      _id: k._id, codigo: k.codigo, nombre: k.nombre, unidad: k.unidad, sentido: k.sentido,
      frecuencia: k.frecuencia, tipoCaptura: k.tipoCaptura, filas,
    });
  }

  return {
    mes, etiquetaMes: P.etiqueta(mes), regla, hoy,
    unidades: [...new Set(todos.flatMap(k => k.unidades))].sort(),
    areas: areas.filter(a => !area || a.codigo === area).map(a => {
      const ks = porArea.get(a.codigo) || [];
      const estados = ks.flatMap(k => k.filas.map(f => f.estado));
      const { color, conteo } = resumenArea(estados, regla);
      return {
        codigo: a.codigo, nombre: a.nombre, color, conteo,
        pendientes: estados.filter(e => e === 'PENDIENTE').length,
        informativos: estados.filter(e => e === null).length,
        kpis: ks,
      };
    }),
  };
}

// Capturas faltantes de los últimos 12 periodos cerrados, agrupadas por responsable.
// vencidos: pasó el plazo sin registro. porVencer: periodo cerrado, aún dentro del plazo.
async function pendientesDeCaptura(acc, { area, unidad, hoy = P.hoyLima(), incluirPorVencer = false } = {}) {
  const kpis = await kpisVisibles(acc, { area, unidad });
  const ventanas = new Map(kpis.map(k => [String(k._id), P.ultimos(P.anterior(P.periodoDeFecha(hoy, k.frecuencia)), 12)]));
  const desde = [...ventanas.values()].map(v => P.rango(v[0]).inicio).sort()[0] || hoy;
  const indice = await indiceRegistros(kpis, desde);
  const ids = [...new Set(kpis.flatMap(k => k.responsables))];
  const nombres = Object.fromEntries((await User.find({ id: { $in: ids } }, { id: 1, username: 1, email: 1, activo: 1 }).lean())
    .map(u => [u.id, u]));

  const items = [];
  for (const k of kpis) {
    for (const u of k.unidades.filter(x => !unidad || x === unidad)) {
      for (const periodo of ventanas.get(String(k._id))) {
        if (indice.has(`${k._id}|${u}|${periodo}`)) continue;
        const estado = estadoSinRegistro(k, periodo, hoy);
        if (estado === 'NO_EXIGIBLE' || (estado === 'PENDIENTE' && !incluirPorVencer)) continue;
        const vence = P.vencimiento(periodo, k.plazoCapturaDias);
        items.push({
          kpiId: k._id, codigo: k.codigo, nombre: k.nombre, areaCodigo: k.areaCodigo, unidad: u,
          periodo, etiqueta: P.etiqueta(periodo), vence, vencido: estado === 'SIN_DATO',
          diasAtraso: Math.max(0, Math.round((new Date(hoy) - new Date(vence)) / 864e5)),
          responsables: k.responsables,
        });
      }
    }
  }
  // Un grupo por responsable (un KPI con 2 responsables aparece en ambos); sin responsable aparte.
  const grupos = new Map();
  for (const it of items) {
    const resp = it.responsables.filter(id => nombres[id] && nombres[id].activo !== false);
    for (const id of resp.length ? resp : ['']) {
      if (!grupos.has(id)) grupos.set(id, { responsableId: id, responsable: id ? nombres[id].username : 'Sin responsable', email: id ? nombres[id].email : '', items: [] });
      grupos.get(id).items.push(it);
    }
  }
  const lista = [...grupos.values()].sort((a, b) => (!a.responsableId) - (!b.responsableId) || a.responsable.localeCompare(b.responsable));
  lista.forEach(g => g.items.sort((a, b) => b.diasAtraso - a.diasAtraso || a.codigo.localeCompare(b.codigo)));
  return { hoy, total: items.length, grupos: lista };
}

// Serie histórica de un KPI para una unidad: los últimos `n` periodos hasta el actual.
async function historico(acc, kpiId, { unidad, n = 24, hoy = P.hoyLima() } = {}) {
  const [k] = await kpisVisibles(acc, { kpiId });
  if (!k) return null;
  const u = k.unidades.includes(unidad) ? unidad : k.unidades[0];
  const periodos = P.ultimos(P.periodoDeFecha(hoy, k.frecuencia), Math.min(Math.max(Number(n) || 24, 4), 60));
  const regs = await KpiRegistro.find({ kpiId: k._id, unidadCodigo: u, periodo: { $in: periodos } }).lean();
  const porPeriodo = new Map(regs.map(r => [r.periodo, r]));
  const vs = (await versionesPorKpi([k._id])).get(String(k._id)) || [];
  return {
    kpi: k, unidad: u,
    puntos: periodos.map(p => {
      const r = porPeriodo.get(p);
      return {
        periodo: p, etiqueta: P.etiqueta(p), inicio: P.rango(p).inicio, vence: P.vencimiento(p, k.plazoCapturaDias),
        estado: r ? r.semaforo : estadoSinRegistro(k, p, hoy),
        valor: r?.valor ?? null, meta: r ? r.meta : snapshot(metaVigente(vs, u, P.rango(p).inicio)),
        registroId: r?._id || null, corregido: !!r?.corregido, comentario: r?.comentario || '',
        adjuntos: r?.adjuntos || [], registradoPorNombre: r?.registradoPorNombre || '', registradoEn: r?.registradoEn || null,
        numerador: r?.numerador ?? null, denominador: r?.denominador ?? null,
      };
    }),
  };
}

module.exports = { construirTablero, pendientesDeCaptura, historico, periodoReferencia, esMejora };

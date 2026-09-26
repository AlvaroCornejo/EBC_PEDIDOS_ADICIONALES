const KpiMetaVersion = require('../models/KpiMetaVersion');

// Versión de meta que aplica a una unidad en una fecha (inicio del periodo, 'YYYY-MM-DD').
// Una versión específica de la unidad gana sobre la general (''); dentro de cada grupo
// manda la de `vigenteDesde` más reciente (y, a igual fecha, la creada después).
function metaVigente(versiones, unidadCodigo, fecha) {
  const aplicables = versiones.filter(v => v.vigenteDesde <= fecha);
  const masReciente = (lista) => lista.reduce((a, b) =>
    !a || b.vigenteDesde > a.vigenteDesde || (b.vigenteDesde === a.vigenteDesde && b.creadoEn > a.creadoEn) ? b : a, null);
  return masReciente(aplicables.filter(v => unidadCodigo && v.unidadCodigo === unidadCodigo))
    || masReciente(aplicables.filter(v => !v.unidadCodigo));
}

// Map kpiId(string) → versiones, en una sola consulta.
async function versionesPorKpi(kpiIds) {
  const docs = await KpiMetaVersion.find({ kpiId: { $in: kpiIds } }).sort({ vigenteDesde: 1, creadoEn: 1 }).lean();
  const mapa = new Map(kpiIds.map(id => [String(id), []]));
  for (const d of docs) mapa.get(String(d.kpiId))?.push(d);
  return mapa;
}

// Copia de los campos de una versión que se congela en cada registro.
function snapshot(v) {
  if (!v) return null;
  const { _id, vigenteDesde, unidadCodigo, meta, umbralAmbar, rangoMin, rangoMax, tolerancia } = v;
  return { versionId: _id, vigenteDesde, unidadCodigo, meta, umbralAmbar, rangoMin, rangoMax, tolerancia };
}

module.exports = { metaVigente, versionesPorKpi, snapshot };

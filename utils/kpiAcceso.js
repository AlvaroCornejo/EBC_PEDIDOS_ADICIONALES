const User    = require('../models/User');
const KpiArea = require('../models/KpiArea');

// Permisos de Indicadores GAF, resueltos EN VIVO contra la base en cada request —
// nunca desde el JWT (ver bug de buildPayload en CLAUDE.md, Sesión 14): un cambio
// de áreas hecho por ADMIN aplica de inmediato, sin esperar a que el usuario
// vuelva a iniciar sesión.
//
// Resultado:
//   esAdmin  — rol ADMIN de la app o kpiRol='admin': todo, incluido catálogo y correcciones
//   esLector — kpiRol='lector': ve todas las áreas, no captura
//   lectura  — Set de áreas que puede VER (captura implica lectura)
//   captura  — Set de áreas donde puede REGISTRAR valores
async function resolverAcceso(userId) {
  const user = await User.findOne({ id: userId }).lean();
  if (!user || user.activo === false) return null;

  const esAdmin  = user.role === 'ADMIN' || user.kpiRol === 'admin';
  const esLector = !esAdmin && user.kpiRol === 'lector';
  const areasActivas = await KpiArea.distinct('codigo', { activo: true });

  let lectura, captura;
  if (esAdmin) {
    lectura = new Set(areasActivas);
    captura = new Set(areasActivas);
  } else {
    const activas = new Set(areasActivas);
    const propias = (user.kpiAreas || []).filter(a => activas.has(a.area));
    captura = new Set(propias.filter(a => a.nivel === 'CAPTURA').map(a => a.area));
    lectura = esLector ? new Set(areasActivas) : new Set(propias.map(a => a.area));
  }

  return {
    userId: user.id,
    username: user.username,
    esAdmin,
    esLector,
    lectura,
    captura,
    puedeVer:       (area) => lectura.has(area),
    puedeCapturar:  (area) => captura.has(area),
    // Filtro Mongo para cualquier colección con campo `areaCodigo`: toda consulta
    // de datos del módulo debe pasar por aquí para no filtrar áreas no asignadas.
    filtroAreas:    (campo = 'areaCodigo') => ({ [campo]: { $in: [...lectura] } }),
  };
}

// Middleware: exige acceso a al menos un área del módulo y deja el resultado en req.kpi.
function requiereAcceso(req, res, next) {
  resolverAcceso(req.user.id).then(acc => {
    if (!acc || (!acc.esAdmin && acc.lectura.size === 0)) {
      return res.status(403).json({ error: 'Sin acceso a Indicadores GAF' });
    }
    req.kpi = acc;
    next();
  }).catch(err => res.status(500).json({ error: err.message }));
}

// Usar DESPUÉS de requiereAcceso.
function soloAdmin(req, res, next) {
  if (!req.kpi?.esAdmin) return res.status(403).json({ error: 'Solo administradores de Indicadores' });
  next();
}

// Acceso de sistema (todas las áreas activas) para procesos sin usuario, como la tarea
// diaria de notificaciones. Misma forma que resolverAcceso.
async function accesoSistema() {
  const areas = new Set(await KpiArea.distinct('codigo', { activo: true }));
  return {
    userId: 'SISTEMA', username: 'SISTEMA', esAdmin: true, esLector: false, lectura: areas, captura: areas,
    puedeVer: (a) => areas.has(a), puedeCapturar: (a) => areas.has(a),
    filtroAreas: (campo = 'areaCodigo') => ({ [campo]: { $in: [...areas] } }),
  };
}

module.exports = { resolverAcceso, requiereAcceso, soloAdmin, accesoSistema };

// Reglas del semáforo de Indicadores GAF. Funciones puras (sin base de datos) para que el
// cálculo sea el mismo al guardar un registro, en el dashboard y en las pruebas.
//
// meta = snapshot de la versión de meta vigente: { meta, umbralAmbar, rangoMin, rangoMax, tolerancia }
//   MAYOR (mayor es mejor): VERDE si valor ≥ meta; AMBAR si valor ≥ umbralAmbar; si no ROJO.
//   MENOR (menor es mejor): VERDE si valor ≤ meta; AMBAR si valor ≤ umbralAmbar; si no ROJO.
//   RANGO: VERDE dentro de [rangoMin, rangoMax]; AMBAR dentro de ± tolerancia; si no ROJO.
// Sin meta definida el KPI es informativo: devuelve null (no cuenta para el resumen del área).

const EPS = 1e-9; // evita que 94.99999999 (redondeo de un ratio) caiga en el color equivocado
const COLORES = ['VERDE', 'AMBAR', 'ROJO'];
const GRAVEDAD = { VERDE: 0, AMBAR: 1, ROJO: 2 };
const n = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

function tieneMeta(sentido, m) {
  if (!m) return false;
  if (sentido === 'RANGO') return n(m.rangoMin) !== null && n(m.rangoMax) !== null;
  return n(m.meta) !== null;
}

function calcularSemaforo(valor, sentido, m) {
  const v = n(valor);
  if (v === null || Number.isNaN(v) || !tieneMeta(sentido, m)) return null;

  if (sentido === 'MAYOR') {
    const meta = n(m.meta), ambar = n(m.umbralAmbar) ?? meta;
    if (v >= meta - EPS) return 'VERDE';
    return v >= ambar - EPS ? 'AMBAR' : 'ROJO';
  }
  if (sentido === 'MENOR') {
    const meta = n(m.meta), ambar = n(m.umbralAmbar) ?? meta;
    if (v <= meta + EPS) return 'VERDE';
    return v <= ambar + EPS ? 'AMBAR' : 'ROJO';
  }
  if (sentido === 'RANGO') {
    const min = n(m.rangoMin), max = n(m.rangoMax), tol = n(m.tolerancia) ?? 0;
    if (v >= min - EPS && v <= max + EPS) return 'VERDE';
    return v >= min - tol - EPS && v <= max + tol + EPS ? 'AMBAR' : 'ROJO';
  }
  return null;
}

// Valida que los umbrales de una versión de meta sean coherentes con el sentido.
// Devuelve un mensaje de error o null. Una versión sin meta es válida (KPI informativo).
function validarMeta(sentido, m) {
  const meta = n(m.meta), ambar = n(m.umbralAmbar);
  const min = n(m.rangoMin), max = n(m.rangoMax), tol = n(m.tolerancia);
  const nums = [meta, ambar, min, max, tol].filter(x => x !== null);
  if (nums.some(x => Number.isNaN(x))) return 'Los valores de meta y umbrales deben ser numéricos';
  if (sentido === 'RANGO') {
    if ((min === null) !== (max === null)) return 'Indique el mínimo y el máximo del rango';
    if (min !== null && min > max) return 'El mínimo del rango no puede ser mayor que el máximo';
    if (tol !== null && tol < 0) return 'La tolerancia no puede ser negativa';
    return null;
  }
  if (meta === null) return ambar === null ? null : 'Indique la meta antes del umbral ámbar';
  if (ambar !== null && sentido === 'MAYOR' && ambar > meta) return 'En "mayor es mejor", el umbral ámbar debe ser menor o igual a la meta';
  if (ambar !== null && sentido === 'MENOR' && ambar < meta) return 'En "menor es mejor", el umbral ámbar debe ser mayor o igual a la meta';
  return null;
}

// Resumen de un área a partir de los semáforos de sus KPIs (null = informativo, se ignora;
// 'SIN_DATO' = KPI vencido sin registro). Reglas configurables:
//   MAS_FRECUENTE_PISO_AMBAR (default): el color más frecuente, pero si hay algún rojo el
//     área queda al menos en ámbar.
//   MAS_FRECUENTE: solo el color más frecuente.
//   PEOR: el peor color presente.
// Empates en "más frecuente" se resuelven hacia el color más grave. Si ningún KPI tiene
// color (todo sin dato), el área queda 'SIN_DATO'.
const REGLAS_RESUMEN = ['MAS_FRECUENTE_PISO_AMBAR', 'MAS_FRECUENTE', 'PEOR'];

function resumenArea(semaforos, regla = 'MAS_FRECUENTE_PISO_AMBAR') {
  const conteo = { VERDE: 0, AMBAR: 0, ROJO: 0, SIN_DATO: 0 };
  for (const s of semaforos) if (s in conteo) conteo[s]++;
  const conColor = COLORES.filter(c => conteo[c] > 0);
  if (!conColor.length) return { color: conteo.SIN_DATO ? 'SIN_DATO' : null, conteo };

  let color;
  if (regla === 'PEOR') {
    color = conColor.reduce((a, b) => (GRAVEDAD[b] > GRAVEDAD[a] ? b : a));
  } else {
    color = conColor.reduce((a, b) =>
      conteo[b] > conteo[a] || (conteo[b] === conteo[a] && GRAVEDAD[b] > GRAVEDAD[a]) ? b : a);
    if (regla !== 'MAS_FRECUENTE' && conteo.ROJO > 0 && color === 'VERDE') color = 'AMBAR';
  }
  return { color, conteo };
}

module.exports = { calcularSemaforo, validarMeta, tieneMeta, resumenArea, REGLAS_RESUMEN };

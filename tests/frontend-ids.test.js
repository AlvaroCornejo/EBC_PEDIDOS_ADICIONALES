// Las pestañas de Indicadores GAF (Dashboard, Captura, Registros, Configuración) y los
// modales conviven en el DOM, así que un id repetido hace que getElementById lea el
// elemento equivocado. Pasó: el filtro de área del Dashboard y el formulario de KPI usaban
// ambos "kd-area" y el formulario guardaba "Área inválida".
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Ids que se repiten a propósito: vistas alternativas dentro del mismo contenedor
// (nunca están en el DOM al mismo tiempo).
const PERMITIDOS = new Set(['kd-volver']);

it('public/kpis.js no repite ids de elementos', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/kpis.js'), 'utf8');
  const ids = [...src.matchAll(/id="([a-z][\w-]*)"/g)].map(m => m[1]);
  const vistos = new Map();
  ids.forEach(id => vistos.set(id, (vistos.get(id) || 0) + 1));
  const repetidos = [...vistos].filter(([id, n]) => n > 1 && !PERMITIDOS.has(id)).map(([id]) => id);
  assert.deepEqual(repetidos, []);
});

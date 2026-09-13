// Cliente mínimo de la API de Box (Server Authentication — Client Credentials Grant),
// implementado con fetch nativo (Node 18+) para no agregar box-node-sdk como dependencia
// nueva — mismo criterio que scripts/syncTipoCambio.js para llamar APIs públicas.
//
// Credenciales/ruta base en Config (Admin → Configuración), no en .env, igual que SMTP
// (utils/sendEmail.js): boxClientId, boxClientSecret, boxEnterpriseId,
// cierreContableRutaBoxBase (ej. "Cierre Contable" — carpeta raíz visible para la Service
// Account de la app, ya colaborada desde el Box Admin Console).
const Config = require('../models/Config');

let cachedToken = null; // { token, expiresAt }

async function getBoxConfig() {
  const docs = await Config.find({ key: { $in: ['boxClientId', 'boxClientSecret', 'boxEnterpriseId', 'cierreContableRutaBoxBase'] } }).lean();
  const cfg = {};
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.token;
  const cfg = await getBoxConfig();
  if (!cfg.boxClientId || !cfg.boxClientSecret) {
    throw new Error('Box no está configurado — faltan boxClientId/boxClientSecret en Admin → Configuración');
  }
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.boxClientId,
      client_secret: cfg.boxClientSecret,
      ...(cfg.boxEnterpriseId ? { box_subject_type: 'enterprise', box_subject_id: cfg.boxEnterpriseId } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Box token error: ${data.error_description || data.error || res.status}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function boxFetch(url, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Box API error (${res.status}): ${data.message || JSON.stringify(data)}`);
  return data;
}

// Busca una subcarpeta por nombre dentro de parentId, o la crea si no existe.
async function obtenerOCrearCarpeta(nombre, parentId) {
  const listado = await boxFetch(`https://api.box.com/2.0/folders/${parentId}/items?fields=id,name,type&limit=1000`);
  const existente = (listado.entries || []).find(e => e.type === 'folder' && e.name === nombre);
  if (existente) return existente.id;
  const creada = await boxFetch('https://api.box.com/2.0/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, parent: { id: parentId } }),
  });
  return creada.id;
}

// Resuelve (creando lo que falte) la carpeta {rutaBase}/{periodo}/{sociedad}/{operacion|_SOCIEDAD}/{actividad}/
async function resolverCarpetaDestino({ periodo, sociedadCodigo, operacionCodigo, actividadNombre }) {
  const cfg = await getBoxConfig();
  if (!cfg.cierreContableRutaBoxBase) {
    throw new Error('Falta configurar la carpeta base de Box (cierreContableRutaBoxBase) en Admin → Configuración');
  }
  // cierreContableRutaBoxBase guarda el ID de la carpeta raíz en Box (no una ruta de texto:
  // la API de Box navega por ID, no por path).
  let folderId = cfg.cierreContableRutaBoxBase;
  for (const segmento of [periodo, sociedadCodigo, operacionCodigo || '_SOCIEDAD', actividadNombre]) {
    folderId = await obtenerOCrearCarpeta(String(segmento).slice(0, 255), folderId);
  }
  return folderId;
}

// Sube un archivo (Buffer en memoria, viene de multer memoryStorage) a la carpeta resuelta.
// Nombre único con timestamp — los adjuntos nunca se sobrescriben/eliminan.
async function subirArchivo({ buffer, nombreOriginal, periodo, sociedadCodigo, operacionCodigo, actividadNombre }) {
  const folderId = await resolverCarpetaDestino({ periodo, sociedadCodigo, operacionCodigo, actividadNombre });
  const nombreUnico = `${Date.now()}_${nombreOriginal}`.slice(0, 255);

  const token = await getAccessToken();
  const form = new FormData();
  form.append('attributes', JSON.stringify({ name: nombreUnico, parent: { id: folderId } }));
  form.append('file', new Blob([buffer]), nombreUnico);

  const res = await fetch('https://upload.box.com/api/2.0/files/content', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Box upload error (${res.status}): ${data.message || JSON.stringify(data)}`);
  const archivo = data.entries[0];

  const link = await crearOEnlaceExistente(archivo.id);
  return { boxFileId: archivo.id, boxFileName: nombreUnico, rutaBox: `${periodo}/${sociedadCodigo}/${operacionCodigo || '_SOCIEDAD'}/${actividadNombre}`, sharedLink: link };
}

// access:'open' (no 'company') a propósito: muchos usuarios de la app no tienen licencia
// de Box, así que el link tiene que abrirse sin necesitar sesión de Box ni ser miembro del
// Enterprise — cualquiera con el link puede verlo.
async function crearOEnlaceExistente(fileId) {
  const detalle = await boxFetch(`https://api.box.com/2.0/files/${fileId}?fields=shared_link`);
  if (detalle.shared_link) return detalle.shared_link.url;
  const actualizado = await boxFetch(`https://api.box.com/2.0/files/${fileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shared_link: { access: 'open' } }),
  });
  return actualizado.shared_link?.url || null;
}

module.exports = { subirArchivo, getBoxConfig };

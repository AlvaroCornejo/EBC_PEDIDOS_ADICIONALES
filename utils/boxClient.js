// Cliente mínimo de la API de Box (Server Authentication — Client Credentials Grant), con
// fetch nativo (sin box-node-sdk). Recuperado del extinto Cierre Contable (Sesión 15) y
// generalizado. Credenciales en Config (boxClientId, boxClientSecret, boxEnterpriseId); la
// app de Box usa nivel de acceso "Aplicación + Empresa" (box_subject_type=enterprise).
//
// A diferencia de Cierre Contable, NO se crean links compartidos públicos: los archivos se
// descargan a través de la app (urlDescarga), que antes valida los permisos del usuario.
const dns = require('dns');
const Config = require('../models/Config');

// La API de Box dio ETIMEDOUT por una ruta IPv6 poco confiable (Sesión 15).
dns.setDefaultResultOrder('ipv4first');

let cachedToken = null; // { token, expiresAt }

async function getBoxConfig() {
  const docs = await Config.find({ key: { $in: ['boxClientId', 'boxClientSecret', 'boxEnterpriseId'] } }).lean();
  return Object.fromEntries(docs.map(d => [d.key, d.value]));
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.token;
  const cfg = await getBoxConfig();
  if (!cfg.boxClientId || !cfg.boxClientSecret) throw new Error('Box no está configurado (faltan las credenciales de la app de Box)');
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
  if (!res.ok) throw new Error(`Box: error de autenticación (${data.error_description || data.error || res.status})`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function boxFetch(url, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Box (${res.status}): ${data.message || JSON.stringify(data)}`);
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

// Sube un Buffer (multer memoryStorage) a {carpetaBaseId}/{segmentos...}/, creando lo que
// falte. Nombre con timestamp para no sobrescribir nunca.
async function subirArchivo({ buffer, nombreOriginal, carpetaBaseId, segmentos = [] }) {
  if (!carpetaBaseId) throw new Error('Falta configurar la carpeta de Box para las evidencias');
  let folderId = String(carpetaBaseId);
  for (const s of segmentos) folderId = await obtenerOCrearCarpeta(String(s).replace(/[\\/]/g, '-').slice(0, 255), folderId);

  const nombre = `${Date.now()}_${nombreOriginal}`.replace(/[\\/]/g, '-').slice(0, 255);
  const token = await getAccessToken();
  const form = new FormData();
  form.append('attributes', JSON.stringify({ name: nombre, parent: { id: folderId } }));
  form.append('file', new Blob([buffer]), nombre);
  const res = await fetch('https://upload.box.com/api/2.0/files/content', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Box: no se pudo subir el archivo (${res.status}: ${data.message || ''})`);
  return { boxFileId: data.entries[0].id, nombre, ruta: segmentos.join('/') };
}

// URL temporal de descarga (Box la invalida a los pocos minutos). Box responde 302 con la
// ubicación; se devuelve esa URL en vez de seguirla.
async function urlDescarga(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.box.com/2.0/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'manual',
  });
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) return location;
  throw new Error(`Box: no se pudo obtener el archivo (${res.status})`);
}

// Solo para deshacer una subida cuando el registro no llegó a guardarse.
async function eliminarArchivo(fileId) {
  const token = await getAccessToken();
  await fetch(`https://api.box.com/2.0/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

async function probarConexion(carpetaId) {
  const carpeta = await boxFetch(`https://api.box.com/2.0/folders/${carpetaId}?fields=id,name`);
  return { id: carpeta.id, nombre: carpeta.name };
}

module.exports = { subirArchivo, urlDescarga, eliminarArchivo, probarConexion, getBoxConfig };

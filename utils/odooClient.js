/**
 * Cliente XML-RPC mínimo para Odoo (solo servidor — nunca se usa desde el navegador).
 *
 * Credenciales desde variables de entorno (.env del servidor, nunca en git ni en el frontend):
 *   ODOO_URL      p.ej. https://ebc.com.pe
 *   ODOO_DB       p.ej. ebc_restaurante
 *   ODOO_USER     usuario (login) de la API
 *   ODOO_API_KEY  clave API del usuario
 *
 * Uso:
 *   const odoo = await OdooClient.conectar();
 *   const filas = await odoo.searchRead('stock.warehouse', [], ['code', 'name']);
 */

// ─── Serialización XML-RPC ────────────────────────────────────────

const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function valor(v) {
  if (v === null || v === undefined) return '<value><nil/></value>';
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 2 ** 31
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === 'string') return `<value><string>${escXml(v)}</string></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(valor).join('')}</data></array></value>`;
  if (typeof v === 'object') {
    const miembros = Object.entries(v)
      .map(([k, x]) => `<member><name>${escXml(k)}</name>${valor(x)}</member>`).join('');
    return `<value><struct>${miembros}</struct></value>`;
  }
  throw new Error(`Tipo no soportado en XML-RPC: ${typeof v}`);
}

function llamadaXml(metodo, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${metodo}</methodName><params>${
    params.map(p => `<param>${valor(p)}</param>`).join('')}</params></methodCall>`;
}

// ─── Parser de la respuesta XML-RPC ───────────────────────────────

const unescXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

function tokenizar(xml) {
  const tokens = [];
  const re = /<(\/?)([a-zA-Z0-9_.:-]+)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) tokens.push({ t: 'txt', v: m[4] });
    else if (m[3]) tokens.push({ t: 'vacio', n: m[2] });
    else tokens.push({ t: m[1] ? 'cierra' : 'abre', n: m[2] });
  }
  return tokens;
}

function parsearRespuesta(xml) {
  const tk = tokenizar(xml.replace(/<\?xml[^>]*\?>/, ''));
  let i = 0;
  const saltarEspacios = () => { while (i < tk.length && tk[i].t === 'txt' && !tk[i].v.trim()) i++; };
  const espera = (t, n) => {
    saltarEspacios();
    const x = tk[i++];
    if (!x || x.t !== t || (n && x.n !== n)) throw new Error(`XML-RPC: se esperaba ${t} ${n || ''}`);
    return x;
  };
  const texto = () => { let s = ''; while (i < tk.length && tk[i].t === 'txt') s += tk[i++].v; return unescXml(s); };

  function leerValor() {
    espera('abre', 'value');
    // <value>texto</value> sin tipo = string
    if (tk[i] && tk[i].t === 'txt' && tk[i + 1] && tk[i + 1].t === 'cierra' && tk[i + 1].n === 'value') {
      const s = texto(); espera('cierra', 'value'); return s;
    }
    saltarEspacios();
    const x = tk[i++];
    let r;
    if (x.t === 'cierra' && x.n === 'value') return '';
    if (x.t === 'vacio') {
      r = x.n === 'nil' ? null : x.n === 'string' ? '' : x.n === 'array' ? [] : x.n === 'struct' ? {} : null;
    } else {
      const tipo = x.n;
      if (tipo === 'array') {
        r = [];
        saltarEspacios();
        if (tk[i].t === 'vacio' && tk[i].n === 'data') i++;
        else {
          espera('abre', 'data');
          for (;;) { saltarEspacios(); if (tk[i].t === 'cierra') break; r.push(leerValor()); }
          espera('cierra', 'data');
        }
      } else if (tipo === 'struct') {
        r = {};
        for (;;) {
          saltarEspacios();
          if (tk[i].t === 'cierra') break;
          espera('abre', 'member');
          espera('abre', 'name'); const k = texto(); espera('cierra', 'name');
          r[k] = leerValor();
          espera('cierra', 'member');
        }
      } else {
        const s = texto();
        if (tipo === 'int' || tipo === 'i4' || tipo === 'i8') r = parseInt(s, 10);
        else if (tipo === 'double') r = parseFloat(s);
        else if (tipo === 'boolean') r = s.trim() === '1';
        else if (tipo === 'nil') r = null;
        else r = s; // string, dateTime.iso8601, base64
      }
      espera('cierra', tipo);
    }
    espera('cierra', 'value');
    return r;
  }

  espera('abre', 'methodResponse');
  saltarEspacios();
  if (tk[i].t === 'abre' && tk[i].n === 'fault') {
    i++;
    const f = leerValor();
    const err = new Error(`Odoo: ${(f.faultString || '').split('\n').filter(Boolean).slice(-1)[0] || 'error XML-RPC'}`);
    err.detalle = f.faultString;
    throw err;
  }
  espera('abre', 'params'); espera('abre', 'param');
  return leerValor();
}

async function llamar(url, metodo, params, intentos = 3) {
  const body = llamadaXml(metodo, params);
  for (let n = 1; ; n++) {
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
      if (!resp.ok) throw new Error(`Odoo HTTP ${resp.status} en ${metodo}`);
      return parsearRespuesta(await resp.text());
    } catch (err) {
      // Reintenta solo fallas de red (no errores de Odoo)
      if (err.message.startsWith('Odoo:') || n >= intentos) {
        if (err.cause) err.message += ` (${err.cause.code || err.cause.message})`;
        throw err;
      }
      await new Promise(r => setTimeout(r, 2000 * n));
    }
  }
}

// ─── Cliente ──────────────────────────────────────────────────────

class OdooClient {
  constructor({ url, db, user, apiKey }) {
    this.url = url.replace(/\/+$/, '');
    this.db = db;
    this.user = user;
    this.apiKey = apiKey;
    this.uid = null;
    this.contexto = {};
  }

  static async conectar() {
    const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = process.env;
    if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_API_KEY) {
      throw new Error('Faltan variables de entorno ODOO_URL / ODOO_DB / ODOO_USER / ODOO_API_KEY');
    }
    const c = new OdooClient({ url: ODOO_URL, db: ODOO_DB, user: ODOO_USER, apiKey: ODOO_API_KEY });
    c.uid = await llamar(`${c.url}/xmlrpc/2/common`, 'authenticate', [c.db, c.user, c.apiKey, {}]);
    if (!c.uid) throw new Error('Odoo: autenticación fallida (revisar ODOO_USER / ODOO_API_KEY)');
    // Todas las empresas del usuario, para leer los movimientos de los 4 grupos
    const [u] = await c.execute('res.users', 'read', [[c.uid]], { fields: ['company_id', 'company_ids'] });
    c.contexto = { allowed_company_ids: [u.company_id[0], ...u.company_ids.filter(x => x !== u.company_id[0])], active_test: false };
    return c;
  }

  execute(model, method, args = [], kwargs = {}) {
    return llamar(`${this.url}/xmlrpc/2/object`, 'execute_kw',
      [this.db, this.uid, this.apiKey, model, method, args, { context: this.contexto, ...kwargs }]);
  }

  /** search_read paginado (lee todo, de `pagina` en `pagina` registros). */
  async searchRead(model, domain, fields, { order = 'id', pagina = 5000 } = {}) {
    const out = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await this.execute(model, 'search_read', [domain], { fields, order, limit: pagina, offset });
      out.push(...lote);
      if (lote.length < pagina) return out;
    }
  }
}

module.exports = OdooClient;
module.exports._parsearRespuesta = parsearRespuesta; // para pruebas

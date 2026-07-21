/* ═══════════════════════════════════════════════════════════════
   Sistema de Pedidos — app.js  v2026-07-01
═══════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────
const API = '/api';
const ROLES = { ADMIN: 'ADMIN', SOL: 'OPERADOR_SOLICITUD', APR: 'OPERADOR_APROBACION', ATE: 'OPERADOR_ATENCION', PLT: 'OPERADOR_PLANTA', CONS: 'OPERADOR_CONSULTA' };
const ROLE_LABELS = { ADMIN: 'Administrador', OPERADOR_SOLICITUD: 'Solicitador', OPERADOR_APROBACION: 'Aprobador', OPERADOR_ATENCION: 'Compras', OPERADOR_PLANTA: 'Planta', OPERADOR_CONSULTA: 'Consultas' };
const ITEMS_ROLES = [['','— Sin acceso —'],['solicitante','Solicitante'],['validador','Validador / Aprobador'],['registrador','Registrador ERP'],['admin','Administrador']];
const PAGO_ROLES  = [['','— Sin acceso —'],['programador','Programador (Paso 1)'],['aprobador','Aprobador (Paso 2)'],['pagador','Pagador (Paso 3 y 5)'],['autorizador','Autorizador (Paso 4)'],['admin','Administrador']];
const BCT_ROLES   = [['','— Sin acceso —'],['SOLICITUD','Solicitud'],['REGISTRO','Registro'],['CONSULTA','Consulta']];
const ROL86       = [['','— Sin acceso —'],['REGISTRO','Registro'],['CONSULTA','Consulta']];
const CAJA_ROLES  = [['','— Sin acceso —'],['REGISTRO','Registro'],['CONSULTA','Consulta']];
const OBLIG_ROLES = [['','— Sin acceso —'],['autorizador','Autorizador de Pagos']];
const ESTADOS = ['SOLICITADO', 'APROBADO', 'RECHAZADO', 'REVISAR', 'ATENDIDO'];
const ALL_OPS = ['AASI', 'CORPQ', 'CDLAO', 'PLANTA', 'CORPFK', 'CDL28', 'MUVON', 'GBGOL', 'GBADC', 'GBSRQ', 'GBCFR', 'GBCRP', 'GBPLANTA', 'GBCORP'];
const ALL_OPS_ROW1 = ['AASI', 'CORPQ', 'CDLAO', 'PLANTA', 'CORPFK', 'CDL28', 'MUVON'];
const ALL_OPS_ROW2 = ['GBGOL', 'GBADC', 'GBSRQ', 'GBCFR', 'GBCRP', 'GBPLANTA', 'GBCORP'];
const ALL_SOCS_COMPRA = ['ERSAC', 'FRQ1', 'GB', 'MUVON', 'QUIASMO', 'FACTORIAL K'];

// ─── State ───────────────────────────────────────────────────────
let S = {
  user: null, token: null, view: null,
  items: [],
  form: { id: null, operacion: '', fecha: today(), lineas: [] }
};

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── API helpers ─────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const text = await res.text();
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch(_) { data = {}; } }
  if (res.status === 401) {
    // Solo hacer auto-logout si la petición llevaba token (ruta protegida)
    // Si no llevaba token (ej: /auth/login con contraseña incorrecta), mostrar el error normal
    if (S.token) {
      S.user = null; S.token = null;
      localStorage.removeItem('ebc_token');
      localStorage.removeItem('ebc_user');
      document.getElementById('app').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      toast('Tu sesión expiró. Por favor vuelve a iniciar sesión.', 'error');
      throw new Error('Sesión expirada');
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.data   = data;          // permite leer campos extra como { requiereCascada, hijas }
    throw err;
  }
  return data;
}
const GET  = (p)    => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT  = (p, b) => api('PUT', p, b);
const DEL  = (p)    => api('DELETE', p);
// Defensivo: algunos endpoints pueden devolver {} (p.ej. respuesta vacía/no-JSON) en vez de array
const arr  = (x)    => Array.isArray(x) ? x : [];

// Upload helper (multipart)
async function upload(file, tipo) {
  const fd = new FormData();
  fd.append('file', file);
  const url = tipo ? `${API}/upload?tipo=${tipo}` : `${API}/upload`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${S.token}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error al subir');
  return data;
}

// ─── Formatting ──────────────────────────────────────────────────
const fmt = (n, dec = 2) => n == null || n === '' ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMoney = (n) => n == null ? '—' : 'S/ ' + Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? d.split('T')[0] : '—';
const fmtTime = (d) => { if (!d) return ''; const dt = new Date(d); return isNaN(dt) ? '' : dt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }); };
const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ─── Toast ───────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Modal ───────────────────────────────────────────────────────
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

function openModal(title, html, onClose, opts = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
  const box = document.querySelector('.modal-box');
  box.classList.toggle('modal-wide', !!opts.wide);
  box.classList.toggle('modal-fullwide', !!opts.fullwide);
  box.classList.toggle('modal-medium', !!opts.medium);
  const close = () => { document.getElementById('modal').classList.add('hidden'); box.classList.remove('modal-wide', 'modal-fullwide', 'modal-medium'); onClose?.(); };
  document.getElementById('modal-close').onclick = close;
  document.getElementById('modal-backdrop').onclick = close;
}

// ─── Auth ─────────────────────────────────────────────────────────
async function login(username, password) {
  const data = await POST('/auth/login', { username, password });
  S.user = data.user;
  S.token = data.token;
  localStorage.setItem('ebc_token', data.token);
  localStorage.setItem('ebc_user', JSON.stringify(data.user));
  return data;
}

function showChangePasswordModal() {
  const overlay = document.createElement('div');
  overlay.id = 'chpwd-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:32px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <h2 style="margin:0 0 8px;font-size:18px">🔐 Cambio de contraseña obligatorio</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px">Por seguridad, debes establecer una nueva contraseña antes de continuar.</p>
      <div class="form-group">
        <label>Nueva contraseña *</label>
        <input type="password" id="chpwd-new" class="form-control" placeholder="Mínimo 4 caracteres" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label>Confirmar contraseña *</label>
        <input type="password" id="chpwd-confirm" class="form-control" placeholder="Repite la contraseña" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box">
      </div>
      <div id="chpwd-error" style="color:#dc2626;font-size:13px;margin-top:8px;display:none"></div>
      <button id="chpwd-btn" style="margin-top:20px;width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer">
        💾 Guardar contraseña
      </button>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('chpwd-btn').addEventListener('click', async () => {
    const newPwd = document.getElementById('chpwd-new').value;
    const confirm = document.getElementById('chpwd-confirm').value;
    const errEl = document.getElementById('chpwd-error');
    errEl.style.display = 'none';
    if (!newPwd || newPwd.length < 4) { errEl.textContent = 'Mínimo 4 caracteres'; errEl.style.display = 'block'; return; }
    if (newPwd !== confirm) { errEl.textContent = 'Las contraseñas no coinciden'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('chpwd-btn');
    btn.disabled = true; btn.textContent = '⏳ Guardando...';
    try {
      await PUT('/auth/change-password', { newPassword: newPwd });
      S.user.mustChangePassword = false;
      localStorage.setItem('ebc_user', JSON.stringify(S.user));
      overlay.remove();
      showApp();
    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = '💾 Guardar contraseña';
    }
  });
}

function showCambiarPasswordModal() {
  openModal('🔑 Cambiar contraseña', `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label>Contraseña actual *</label>
        <input type="password" id="cp-actual" class="form-control" placeholder="Tu contraseña actual">
      </div>
      <div class="form-group">
        <label>Nueva contraseña *</label>
        <input type="password" id="cp-nueva" class="form-control" placeholder="Mínimo 4 caracteres">
      </div>
      <div class="form-group">
        <label>Confirmar nueva contraseña *</label>
        <input type="password" id="cp-confirmar" class="form-control" placeholder="Repite la nueva contraseña">
      </div>
      <div id="cp-error" class="msg-error hidden"></div>
      <button id="cp-guardar-btn" class="btn btn-primary">💾 Guardar contraseña</button>
    </div>
  `);
  document.getElementById('cp-guardar-btn').addEventListener('click', async () => {
    const actual    = document.getElementById('cp-actual').value;
    const nueva     = document.getElementById('cp-nueva').value;
    const confirmar = document.getElementById('cp-confirmar').value;
    const errEl     = document.getElementById('cp-error');
    errEl.classList.add('hidden');
    if (!actual)              { errEl.textContent = 'Ingresa tu contraseña actual';          errEl.classList.remove('hidden'); return; }
    if (!nueva || nueva.length < 4) { errEl.textContent = 'La nueva contraseña debe tener al menos 4 caracteres'; errEl.classList.remove('hidden'); return; }
    if (nueva !== confirmar)  { errEl.textContent = 'Las contraseñas nuevas no coinciden';   errEl.classList.remove('hidden'); return; }
    const btn = document.getElementById('cp-guardar-btn');
    btn.disabled = true; btn.textContent = '⏳ Guardando...';
    try {
      await PUT('/auth/change-password', { currentPassword: actual, newPassword: nueva });
      document.getElementById('modal').classList.add('hidden');
      toast('Contraseña actualizada correctamente', 'success');
    } catch (err) {
      errEl.textContent = err.message; errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = '💾 Guardar contraseña';
    }
  });
}

function logout() {
  S.user = null; S.token = null;
  localStorage.removeItem('ebc_token');
  localStorage.removeItem('ebc_user');
  location.reload();
}

function restoreSession() {
  const token = localStorage.getItem('ebc_token');
  const user  = localStorage.getItem('ebc_user');
  if (token && user) { S.token = token; S.user = JSON.parse(user); return true; }
  return false;
}

// Renueva el token silenciosamente (sin cerrar sesión)
async function refreshToken() {
  if (!S.token) return;
  try {
    const data = await GET('/auth/refresh');
    if (data.token) {
      S.token = data.token;
      localStorage.setItem('ebc_token', data.token);
    }
  } catch {
    // Si falla (401) el api() helper ya gestiona el logout automático
  }
}

// Renueva al arrancar y luego cada 30 minutos
async function startTokenRefresh() {
  await refreshToken();
  setInterval(refreshToken, 30 * 60 * 1000);
}

// ─── Navigation ──────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'solicitar',      label: 'Solicitar',       icon: '📝', roles: [ROLES.ADMIN, ROLES.SOL] },
  { id: 'mis-pedidos',    label: 'Mis Pedidos',     icon: '📋', roles: [ROLES.ADMIN, ROLES.SOL] },
  { id: 'kardex',         label: 'Kardex',          icon: '📊', roles: [ROLES.ADMIN], extraPerm: 'puedeVerKardex' },
  // comentarios solo en footer sidebar, no en nav principal
  { id: 'aprobar',        label: 'Aprobar',         icon: '✅', roles: [ROLES.ADMIN, ROLES.APR] },
  { id: 'atender',        label: 'Atender',         icon: '🚚', roles: [ROLES.ADMIN, ROLES.ATE, ROLES.PLT] },
  { id: 'precios',        label: 'Precios Compra',  icon: '💰', roles: [ROLES.ADMIN], extraPerm: 'sociedadesCompra' },
  { id: 'comparativo',   label: 'Comparativo OC',  icon: '📈', roles: [ROLES.ADMIN, ROLES.SOL, ROLES.APR, ROLES.ATE, ROLES.PLT], extraPerm: 'puedeVerComparativo' },
  { id: 'ventas',         label: 'Venta & TIP',     icon: '🛒', roles: [ROLES.ADMIN], extraPerm: 'puedeVerVentas' },
  { id: 'bajas',          label: 'Bajas',           icon: '🔻', roles: [ROLES.ADMIN], extraPerm: 'puedeVerBajas' },
  { id: 'items',         label: 'Creación Ítems',  icon: '📦', roles: [ROLES.ADMIN], extraPerm: 'itemsRol' },
  { id: 'pagos',         label: 'Gestión de Pagos',icon: '💸', roles: [ROLES.ADMIN], extraPerm: 'rolPago' },
  { id: 'flujo-caja',    label: 'Flujo de Caja',   icon: '💵', roles: [ROLES.ADMIN], extraPerm: 'rolPago' },
  { id: 'movimientos',   label: 'Bajas/Consumos/Transf./86', icon: '🗑️', roles: [ROLES.ADMIN], extraPermAny: ['accesoBajas', 'accesoConsumos', 'accesoTransferencias', 'acceso86'] },
  { id: 'caja',          label: 'Cierre de Caja',  icon: '🧾', roles: [ROLES.ADMIN], extraPermAny: ['rolCaja', 'accesoOficina', 'accesoDepositos'] },
  { id: 'autorizaciones', label: 'Incluir Pagos', icon: '📋', roles: [ROLES.ADMIN], extraPermAny: ['rolObligaciones', 'rolPago'] },
  { id: 'pl',             label: 'PL',              icon: '📊', roles: [ROLES.ADMIN], extraPerm: 'accesoEERR' },
  { id: 'conciliacion',   label: 'Conciliación Cobranzas', icon: '🏦', roles: [ROLES.ADMIN], extraPerm: 'accesoConciliacion' },
  { id: 'admin',          label: 'Admin',           icon: '⚙️', roles: [ROLES.ADMIN] }
];

function canSeeNav(n) {
  const role = S.user.role;
  if (n.roles.includes(role)) return true;
  if (n.extraPerm) {
    const val = S.user[n.extraPerm];
    // Soporta tanto boolean como array (ej: sociedadesCompra)
    if (Array.isArray(val) ? val.length > 0 : !!val) return true;
  }
  if (n.extraPermAny) {
    if (n.extraPermAny.some(field => !!S.user[field])) return true;
  }
  return false;
}

function renderNav() {
  const visibles = NAV_ITEMS.filter(canSeeNav);

  // Sidebar (desktop)
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = visibles.map(n => n.href
    ? `<a href="${n.href}" target="_blank" rel="noopener" class="nav-item" style="opacity:.85">
         <span class="nav-icon">${n.icon}</span>${n.label}<span style="font-size:10px;margin-left:4px;opacity:.6">↗</span>
       </a>`
    : `<a href="#" class="nav-item" data-view="${n.id}"><span class="nav-icon">${n.icon}</span>${n.label}</a>`
  ).join('');
  nav.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.view); });
  });

  // Bottom nav (mobile)
  const bn = document.getElementById('bottom-nav');
  bn.innerHTML = visibles.filter(n => !n.href)   // externos no van en bottom nav
    .map(n => `<button class="bn-item" data-view="${n.id}"><span class="bn-icon">${n.icon}</span><span class="bn-label">${n.label}</span></button>`)
    .join('');
  bn.querySelectorAll('.bn-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.bn-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
}

function navigate(view, params = {}) {
  S.view = view;
  S.viewParams = params;
  setActiveNav(view);
  // Limpiar footer de pagos si se navega fuera
  if (view !== 'pagos') document.getElementById('pg-resumenes-footer')?.remove();
  const vc = document.getElementById('view-container');
  vc.innerHTML = '';
  const views = { solicitar: viewSolicitar, 'mis-pedidos': viewMisPedidos, kardex: viewKardex, comentarios: viewComentarios, aprobar: viewAprobar, atender: viewAtender, precios: viewPrecios, comparativo: viewComparativo, ventas: viewVentasTip, bajas: viewBajas, items: viewItems, pagos: viewPagos, 'flujo-caja': viewFlujoCaja, movimientos: viewMovimientos, caja: viewCierreCaja, autorizaciones: viewAutorizacionesPago, pl: viewPL, conciliacion: viewConciliacion, admin: viewAdmin };
  if (views[view]) views[view](vc, params);
}

// ─── View: Solicitar ─────────────────────────────────────────────
async function viewSolicitar(container, params = {}) {
  // Reset or load existing pedido
  const editId = params.editId;
  let pedidoData = null;
  if (editId) {
    try {
      const all = await GET('/pedidos');
      pedidoData = all.find(p => p.id === editId);
    } catch {}
  }

  if (pedidoData) {
    const hasLocked = pedidoData.estado === 'REVISAR' &&
      pedidoData.lineas.some(l => l.estadoLinea === 'APROBADO' || l.estadoLinea === 'RECHAZADO');
    S.form = {
      id: pedidoData.id,
      operacion: pedidoData.operacion,
      fecha: fmtDate(pedidoData.fechaPedido),
      lineas: pedidoData.lineas.map(l => ({ ...l })),
      editMode: hasLocked ? 'edit-revisar' : 'edit'
    };
  } else if (!editId) {
    S.form = { id: null, operacion: S.user.operations?.[0] || '', fecha: today(), lineas: [], editMode: 'edit' };
  }

  // Load items for current operation
  try { S.items = await GET(`/datos/items?operacion=${encodeURIComponent(S.form.operacion)}`); } catch { S.items = []; }

  const ops = S.user.role === ROLES.ADMIN
    ? ALL_OPS
    : (S.user.operations?.length ? S.user.operations : []);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">${editId ? '✏️ Editar Pedido' : '📝 Nueva Solicitud'}</div>
      <div style="display:flex;gap:8px;margin-left:auto">
        <button class="btn btn-outline btn-sm" id="btn-resumen">📊 Resumen</button>
        <button class="btn btn-outline btn-sm" onclick="showHelp('solicitar')">❓ Ayuda</button>
      </div>
    </div>
    <div class="page-body">
      <div class="card mb-16">
        <div class="card-body">
          <div class="solicitar-header">
            <div class="form-group" style="margin:0;min-width:160px">
              <label>Operación</label>
              <select id="f-op" class="tbl-input">
                ${ops.map(o => `<option value="${esc(o)}" ${o===S.form.operacion?'selected':''}>${esc(o)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>Fecha del Pedido</label>
              <input type="date" id="f-fecha" class="tbl-input" value="${S.form.fecha}">
            </div>
            <div class="total-pedido ml-auto">
              <div class="total-label">Total Pedido</div>
              <div class="total-val" id="total-display">${fmtMoney(calcTotal())}</div>
            </div>
          </div>
        </div>
      </div>

      ${S.form.editMode === 'edit-revisar' ? `
      <div class="msg-aviso mb-8" style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:10px 16px;font-size:13px;color:#92400e">
        ⚠️ El aprobador revisó este pedido. Las líneas <strong>aprobadas</strong> y <strong>rechazadas</strong> están bloqueadas.
        Solo puedes modificar las líneas marcadas como <strong>REVISAR</strong>. Al guardar se reenviará para aprobación.
      </div>` : ''}
      <div class="card">
        <div class="table-wrap">
          <table id="lineas-table">
            ${renderTableHeader(S.form.editMode || 'edit')}
            <tbody id="lineas-tbody">
              ${S.form.lineas.map((l, i) => renderLineaRow(l, i, true, S.form.editMode || 'edit', S.form.operacion)).join('')}
            </tbody>
          </table>
        </div>
        <div class="add-line-row flex gap-8 items-center">
          <button class="btn btn-outline btn-sm" id="add-linea-btn">+ Agregar línea</button>
          <button class="btn btn-outline btn-sm" id="add-nuevo-item-btn" style="border-color:#f59e0b;color:#92400e" title="Item que no está en el catálogo">✨ Item no catalogado</button>
          <div class="ml-auto flex gap-8">
            <button class="btn btn-secondary" onclick="navigate('mis-pedidos')">Cancelar</button>
            <button class="btn btn-primary" id="save-pedido-btn">
              ${editId ? '💾 Actualizar' : '💾 Guardar Pedido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSolicitarEvents(container, editId);
  document.getElementById('btn-resumen')?.addEventListener('click', showResumenModal);
}

// ─── Kardex Modal ────────────────────────────────────────────────
const TRX_MAIN   = ['COMPRA','PRODUCCION','TRANSFORMACION','TRANSFERENCIA',
                    'VENTA','CONSUMOS','BAJA','MERMA',
                    'CONSUMO PRODUCCION','CONSUMO TRANSFORMACION'];
const TRX_BOTTOM = ['SOBRANTE','FALTANTE'];

async function showKardexModal(item, nombre, operacion) {
  openModal(`📊 Kardex — ${esc(nombre || item)} (${esc(operacion)})`,
    `<div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div>`,
    null, { wide: true });

  let data;
  try {
    data = await GET(`/datos/kardex-item?item=${encodeURIComponent(item)}&operacion=${encodeURIComponent(operacion)}`);
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<p class="msg-error">${err.message}</p>`;
    return;
  }

  if (!data.length) {
    document.getElementById('modal-body').innerHTML = `<p class="text-muted">Sin movimientos en el kardex para este item.</p>`;
    return;
  }

  const semanas = data.map(d => d.semana);
  // Recopilar todos los TRX que aparecen en los datos
  const allTrx = new Set();
  data.forEach(d => Object.keys(d.movimientos).forEach(t => allTrx.add(t)));

  // Ordenar: primero los de TRX_MAIN que existen, luego los desconocidos, luego TRX_BOTTOM
  const trxMain   = TRX_MAIN.filter(t => allTrx.has(t));
  const trxExtra  = [...allTrx].filter(t => !TRX_MAIN.includes(t) && !TRX_BOTTOM.includes(t));
  const trxBottom = TRX_BOTTOM.filter(t => allTrx.has(t));

  const fmtK = v => v === 0 ? '<span style="color:#9ca3af">-</span>' : fmt(v, 2);

  function headerLabel(s) {
    if (s === 'HASTA') return `<span style="font-size:10px;line-height:1.4">Hist.<br>anterior</span>`;
    const yr = Math.floor(s / 100), wk = String(s % 100).padStart(2, '0');
    return `Sem<br><small>${yr}-${wk}</small>`;
  }

  function buildRow(label, key, bold = false, color = '') {
    const cells = data.map(d => {
      const v = key === '__saldoInicial' ? d.saldoInicial
              : key === '__saldoFinal'   ? d.saldoFinal
              : (d.movimientos[key] || 0);
      return `<td class="col-num" style="white-space:nowrap${color?' color:'+color:''}">${fmtK(v)}</td>`;
    }).join('');
    const style = bold ? 'font-weight:700;background:#f0f4ff' : '';
    return `<tr style="${style}"><td style="white-space:nowrap;padding:4px 10px;${bold?'font-weight:700':''}">${label}</td>${cells}</tr>`;
  }

  const semanaCols = semanas.map(s => `<th class="col-num" style="white-space:nowrap">${headerLabel(s)}</th>`).join('');

  const html = `
    <div style="overflow-x:auto;max-height:70vh;overflow-y:auto">
      <table class="data-table" style="font-size:12px;min-width:600px">
        <thead><tr style="position:sticky;top:0;z-index:2;background:#4361ee;color:#fff">
          <th style="min-width:200px;text-align:left;padding:6px 10px">Movimiento</th>
          ${semanaCols}
        </tr></thead>
        <tbody>
          ${buildRow('SALDO INICIAL', '__saldoInicial', true)}
          ${trxMain.map(t  => buildRow(t, t)).join('')}
          ${trxExtra.map(t => buildRow(t, t)).join('')}
          <tr><td colspan="${semanas.length+1}" style="padding:0;border:none"><hr style="margin:4px 0;border-color:#e5e7eb"></td></tr>
          ${trxBottom.map(t => buildRow(t, t)).join('')}
          ${buildRow('SALDO FINAL', '__saldoFinal', true)}
        </tbody>
      </table>
    </div>`;

  document.getElementById('modal-body').innerHTML = html;
}

// Delegated click para botones de kardex (se registra una sola vez)
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-kardex');
  if (!btn) return;
  e.stopPropagation();
  const { item, nombre, op } = btn.dataset;
  if (item && op) showKardexModal(item, nombre, op);
});

function gestionIcon(gestion) {
  const g = gestion || 'COMPRAS';
  return g === 'PLANTA'
    ? `<span class="gestion-badge gestion-planta" title="Gestión: Planta">🏭</span>`
    : `<span class="gestion-badge gestion-compras" title="Gestión: Compras">🛒</span>`;
}

function renderTableHeader(mode = 'edit') {
  let lastCols;
  if (mode === 'approve') {
    lastCols = `<th rowspan="2" style="min-width:130px">Estado</th><th rowspan="2" style="min-width:200px">Comentario Aprobador</th>`;
  } else if (mode === 'approved') {
    lastCols = `<th rowspan="2" style="min-width:100px">Estado</th><th rowspan="2" style="min-width:180px">Comentario Aprobador</th>`;
  } else if (mode === 'edit-revisar') {
    lastCols = `<th rowspan="2" style="min-width:100px">Estado</th><th rowspan="2" style="min-width:180px">Comentario Aprobador</th><th rowspan="2" class="col-actions"></th>`;
  } else if (mode === 'atender' || mode === 'atendido') {
    lastCols = `<th rowspan="2" style="min-width:100px">Estado</th><th rowspan="2" style="text-align:center;min-width:90px">Atendido</th>`;
  } else {
    lastCols = `<th rowspan="2" class="col-actions"></th>`;
  }
  return `
    <thead>
      <tr>
        <th class="col-item" rowspan="2">Código / Descripción</th>
        <th rowspan="2">Grupo</th>
        <th class="group-header" colspan="5">Semana Anterior</th>
        <th class="group-header" colspan="5">Semana Actual</th>
        <th rowspan="2" class="col-auto col-num">Saldo</th>
        <th rowspan="2" class="col-auto col-num">🔒 Costo U.</th>
        <th rowspan="2" class="col-auto col-num">Cantidad</th>
        <th rowspan="2" class="col-auto" style="text-align:center;min-width:90px">DESPACHO<br>EN EXCESO</th>
        <th rowspan="2" class="col-auto" style="text-align:center;min-width:90px">COMPRA<br>OPORTUNIDAD</th>
        <th rowspan="2" class="col-auto col-num">Costo Total</th>
        <th rowspan="2" style="min-width:160px">Comentarios</th>
        ${lastCols}
      </tr>
      <tr>
        <th class="sub-header col-num">Cons. Est.</th>
        <th class="sub-header col-num">Real Venta</th>
        <th class="sub-header col-num">Real Consumo</th>
        <th class="sub-header col-num">Variación</th>
        <th class="sub-header col-num">Ajuste</th>
        <th class="sub-header col-num">Cons. Est.</th>
        <th class="sub-header col-num">Real Venta</th>
        <th class="sub-header col-num">Real Consumo</th>
        <th class="sub-header col-num">Variación</th>
        <th class="sub-header col-num">Ajuste</th>
      </tr>
    </thead>`;
}

function renderLineaRow(l, idx, editable = true, mode = 'edit', operacion = '') {
  const sa = l.semanaAnterior || {};
  const sc = l.semanaActual || {};
  const ct = (l.cantidadSolicitada || 0) * (l.costoUnitario || 0);
  const varA = sa.variacion || 0;
  const varC = sc.variacion || 0;
  const lid  = esc(l.id || '');
  const isAutoAprobado = !!l.autoAprobado;

  // En modo edit-revisar, las líneas APROBADO/RECHAZADO son de solo lectura
  const isLocked = mode === 'edit-revisar' && (l.estadoLinea === 'APROBADO' || l.estadoLinea === 'RECHAZADO');
  const rowEditable = editable && !isLocked;

  let lastCells;
  if (mode === 'approve') {
    const cur = l.estadoLinea || '';
    // Líneas auto-aprobadas (#6): el aprobador no puede cambiarlas
    if (isAutoAprobado) {
      lastCells = `
        <td><span class="auto-lock-badge">🔒 Auto-aprobado</span></td>
        <td style="font-size:12px;color:#6b7280">${esc(l.comentarioAprobador || '')}</td>`;
    } else {
      lastCells = `
        <td>
          <select class="tbl-input apr-linea-estado" data-linea-id="${lid}" style="min-width:120px">
            <option value="">— Estado —</option>
            <option value="APROBADO"  ${cur==='APROBADO' ?'selected':''}>✅ Aprobado</option>
            <option value="RECHAZADO" ${cur==='RECHAZADO'?'selected':''}>❌ Rechazado</option>
            <option value="REVISAR"   ${cur==='REVISAR'  ?'selected':''}>🔄 Revisar</option>
          </select>
        </td>
        <td><input type="text" class="tbl-input apr-linea-comentario" data-linea-id="${lid}" value="${esc(l.comentarioAprobador||'')}" placeholder="Comentario..."></td>`;
    }
  } else if (mode === 'approved') {
    const el = l.estadoLinea;
    lastCells = `
      <td>${isAutoAprobado ? `<span class="auto-lock-badge">🔒 Auto</span>` : (el ? `<span class="badge badge-${el}">${el}</span>` : '—')}</td>
      <td style="font-size:13px">${esc(l.comentarioAprobador || '')}</td>`;
  } else if (mode === 'edit-revisar') {
    const el = l.estadoLinea;
    const badge = isAutoAprobado ? `<span class="auto-lock-badge">🔒 Auto</span>` : (el ? `<span class="badge badge-${el}">${el}</span>` : '—');
    lastCells = `
      <td>${badge}</td>
      <td style="font-size:13px">${esc(l.comentarioAprobador || '')}</td>
      <td class="col-actions">${isLocked ? '' : `<button class="btn btn-xs btn-danger delete-linea" data-idx="${idx}">✕</button>`}</td>`;
  } else if (mode === 'atender' || mode === 'atendido') {
    const el = l.estadoLinea;
    const rechazado = el === 'RECHAZADO';
    const atendido  = l.estadoAtencion === 'ATENDIDO';
    const readonly  = mode === 'atendido' || atendido;  // #7: no des-atender
    lastCells = `
      <td>${isAutoAprobado ? `<span class="auto-lock-badge">🔒 Auto</span>` : (el ? `<span class="badge badge-${el}">${el}</span>` : '—')}</td>
      <td style="text-align:center">
        ${rechazado
          ? `<span style="color:#9ca3af;font-size:12px">N/A</span>`
          : readonly
            ? `<span class="badge badge-APROBADO">✔ Atendido</span>`
            : `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13px">
                 <input type="checkbox" class="atn-linea-check" data-linea-id="${lid}" ${atendido?'checked':''} style="width:16px;height:16px;accent-color:var(--success)">
               </label>`}
      </td>`;
  } else {
    lastCells = `<td class="col-actions">${editable ? `<button class="btn btn-xs btn-danger delete-linea" data-idx="${idx}">✕</button>` : ''}</td>`;
  }

  const rowClass = isAutoAprobado ? ' class="auto-aprobado-row"' : '';

  // ── Celdas que varían según si es item nuevo (no catalogado) ──
  const esNuevo = !!l.esItemNuevo;
  const itemCell = esNuevo
    ? `<div style="display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;white-space:nowrap">✨ NUEVO</span>
          ${rowEditable ? `<input type="text" class="tbl-input nuevo-nombre-input" data-idx="${idx}" value="${esc(l.itemNombre||'')}" placeholder="Descripción del item..." style="min-width:180px">` : `<strong style="font-size:13px">${esc(l.itemNombre||'—')}</strong>`}
        </div>
      </div>`
    : ((rowEditable && mode !== 'edit-revisar') ? `
        <div class="ac-wrap">
          <input type="text" class="tbl-input item-input" data-idx="${idx}" value="${esc(l.itemNombre || l.item || '')}" placeholder="Buscar item..." autocomplete="off">
          <div class="ac-dropdown hidden"></div>
        </div>
        <div class="auto-gestion-${idx}" style="margin-top:4px;display:flex;align-items:center;gap:4px">
          ${gestionIcon(l.gestion)}
          ${l.item ? `<button class="btn-kardex" data-item="${esc(l.item)}" data-nombre="${esc(l.itemNombre||l.item)}" data-op="${esc(operacion||S.form?.operacion||'')}" title="Ver Kardex">📊</button>` : ''}
        </div>` : `
        <div style="display:flex;align-items:flex-start;gap:6px">
          ${gestionIcon(l.gestion)}
          <div>
            ${l.item ? `<div style="font-size:11px;color:#6b7280;font-family:monospace;font-weight:600;line-height:1.2">${esc(l.item)}</div>` : ''}
            <strong style="font-size:13px;line-height:1.3">${esc(l.itemNombre || l.item || '')}</strong>
          </div>
          ${l.item ? `<button class="btn-kardex" data-item="${esc(l.item)}" data-nombre="${esc(l.itemNombre||l.item)}" data-op="${esc(operacion||S.form?.operacion||'')}" title="Ver Kardex">📊</button>` : ''}
        </div>`);

  const grupoCell = esNuevo && rowEditable
    ? `<input type="text" class="tbl-input nuevo-grupo-input" data-idx="${idx}" value="${esc(l.grupoCompra||'')}" placeholder="Grupo..." style="width:100px">`
    : `<span class="auto-grupo-${idx}">${esc(l.grupoCompra || '—')}</span>`;

  const costoCell = esNuevo && rowEditable
    ? `<input type="number" class="tbl-input tbl-input-num nuevo-cu-input" data-idx="${idx}" value="${l.costoUnitario != null ? l.costoUnitario : ''}" min="0" step="0.01" style="width:80px" placeholder="0.00">`
    : `<span class="auto-cu-${idx}">${l.costoUnitario != null ? fmtMoney(l.costoUnitario) : (esNuevo ? '—' : '...')}</span>`;

  const dash = `<span style="color:#9ca3af">—</span>`;

  return `<tr data-idx="${idx}" data-linea-id="${lid}"${isLocked ? ' style="opacity:.7;background:#f9fafb"' : ''}${esNuevo ? ' style="background:#fffdf0"' : ''}${rowClass}>
    <td class="col-item">${itemCell}</td>
    <td>${grupoCell}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-ceA-${idx} ${!l.semanaAnterior?'cell-loading':''}">${l.semanaAnterior ? fmt(sa.consumoEstimado) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-rvA-${idx}">${l.semanaAnterior ? fmt(sa.consumoRealVenta) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-rcA-${idx}">${l.semanaAnterior ? fmt(sa.consumoReal) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-vA-${idx} ${varA>=0?'variacion-pos':'variacion-neg'}">${l.semanaAnterior ? fmt(varA) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-ajA-${idx}">${l.semanaAnterior ? fmt(sa.ajuste) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-ceC-${idx}">${l.semanaActual ? fmt(sc.consumoEstimado) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-rvC-${idx}">${l.semanaActual ? fmt(sc.consumoRealVenta) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-rcC-${idx}">${l.semanaActual ? fmt(sc.consumoReal) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-vC-${idx} ${varC>=0?'variacion-pos':'variacion-neg'}">${l.semanaActual ? fmt(varC) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-ajC-${idx}">${l.semanaActual ? fmt(sc.ajuste) : '...'}</span>`}</td>
    <td class="col-num">${esNuevo ? dash : `<span class="auto-saldo-${idx}">${l.saldo != null ? fmt(l.saldo) : '...'}</span>`}</td>
    <td class="col-num">${costoCell}</td>
    <td class="col-num">
      ${rowEditable
        ? `<input type="number" class="tbl-input tbl-input-num cantidad-input" data-idx="${idx}" value="${l.cantidadSolicitada || ''}" min="0.01" step="0.01" style="width:90px">`
        : fmt(l.cantidadSolicitada)}
    </td>
    <td style="text-align:center">
      ${rowEditable
        ? `<input type="checkbox" class="despacho-check" data-idx="${idx}" ${l.despachoEnExceso ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer">`
        : (l.despachoEnExceso ? '<span style="color:var(--primary);font-size:16px">✔</span>' : '')}
    </td>
    <td style="text-align:center">
      ${rowEditable
        ? `<input type="checkbox" class="compra-op-check" data-idx="${idx}" ${l.compraOportunidad ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--success);cursor:pointer">`
        : (l.compraOportunidad ? '<span style="color:var(--success);font-size:16px">✔</span>' : '')}
    </td>
    <td class="col-num"><span class="auto-ct-${idx}">${fmtMoney(ct || 0)}</span></td>
    <td>
      ${rowEditable
        ? `<input type="text" class="tbl-input tbl-input-lg comentarios-input" data-idx="${idx}" value="${esc(l.comentarios || '')}" placeholder="Comentarios...">`
        : esc(l.comentarios || '')}
    </td>
    ${lastCells}
  </tr>`;
}

function calcTotal() {
  return S.form.lineas.reduce((sum, l) => sum + (l.cantidadSolicitada || 0) * (l.costoUnitario || 0), 0);
}

function updateTotal() {
  const el = document.getElementById('total-display');
  if (el) el.textContent = fmtMoney(calcTotal());
}

function addLinea() {
  const { v4: uuidv4 } = { v4: () => Date.now().toString(36) + Math.random().toString(36).slice(2) };
  S.form.lineas.push({ id: uuidv4(), item: '', itemNombre: '', grupoCompra: '', cantidadSolicitada: null, comentarios: '', semanaAnterior: null, semanaActual: null, saldo: null, costoUnitario: null });
  const idx = S.form.lineas.length - 1;
  const tbody = document.getElementById('lineas-tbody');
  tbody.insertAdjacentHTML('beforeend', renderLineaRow(S.form.lineas[idx], idx, true, S.form.editMode || 'edit'));
  setupRowEvents(tbody.lastElementChild, idx);
}

function addLineaNuevo() {
  const { v4: uuidv4 } = { v4: () => Date.now().toString(36) + Math.random().toString(36).slice(2) };
  S.form.lineas.push({ id: uuidv4(), item: '', itemNombre: '', grupoCompra: '', cantidadSolicitada: null, comentarios: '', semanaAnterior: null, semanaActual: null, saldo: null, costoUnitario: null, esItemNuevo: true });
  const idx = S.form.lineas.length - 1;
  const tbody = document.getElementById('lineas-tbody');
  tbody.insertAdjacentHTML('beforeend', renderLineaRow(S.form.lineas[idx], idx, true, S.form.editMode || 'edit'));
  setupRowEvents(tbody.lastElementChild, idx);
  // Focus el input del nombre
  setTimeout(() => {
    const inp = tbody.lastElementChild?.querySelector('.nuevo-nombre-input');
    if (inp) inp.focus();
  }, 50);
}

function setupSolicitarEvents(container) {
  // Operación / fecha change
  document.getElementById('f-op').addEventListener('change', async e => {
    S.form.operacion = e.target.value;
    try { S.items = await GET(`/datos/items?operacion=${encodeURIComponent(S.form.operacion)}`); } catch { S.items = []; }
    refetchAllLineas();
  });
  document.getElementById('f-fecha').addEventListener('change', e => {
    S.form.fecha = e.target.value;
    refetchAllLineas();
  });

  // Add line
  document.getElementById('add-linea-btn').addEventListener('click', () => {
    addLinea();
  });

  // Add non-catalogued item line
  document.getElementById('add-nuevo-item-btn').addEventListener('click', () => {
    addLineaNuevo();
  });

  // Save
  document.getElementById('save-pedido-btn').addEventListener('click', savePedido);

  // Setup events for existing rows
  const tbody = document.getElementById('lineas-tbody');
  tbody.querySelectorAll('tr').forEach((tr, idx) => setupRowEvents(tr, idx));

  // Event delegation for dynamic rows
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.delete-linea');
    if (btn) {
      const idx = +btn.dataset.idx;
      S.form.lineas.splice(idx, 1);
      // Re-render tbody
      const f = S.form;
      tbody.innerHTML = f.lineas.map((l, i) => renderLineaRow(l, i, true, S.form.editMode || 'edit', S.form.operacion)).join('');
      tbody.querySelectorAll('tr').forEach((tr, i) => setupRowEvents(tr, i));
      updateTotal();
    }
  });
}

function setupRowEvents(tr, idx) {
  const itemInput = tr.querySelector('.item-input');
  const cantInput = tr.querySelector('.cantidad-input');
  const comInput = tr.querySelector('.comentarios-input');
  if (itemInput) setupAutocomplete(itemInput, idx);
  if (cantInput) {
    cantInput.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      if (e.target.value !== '' && (isNaN(val) || val <= 0)) {
        e.target.style.borderColor = 'var(--danger)';
        e.target.title = 'La cantidad debe ser mayor a cero';
        S.form.lineas[idx].cantidadSolicitada = null;
      } else {
        e.target.style.borderColor = '';
        e.target.title = '';
        S.form.lineas[idx].cantidadSolicitada = val > 0 ? val : null;
      }
      const cu = S.form.lineas[idx].costoUnitario || 0;
      const ct = (S.form.lineas[idx].cantidadSolicitada || 0) * cu;
      const ctEl = tr.querySelector(`.auto-ct-${idx}`);
      if (ctEl) ctEl.textContent = fmtMoney(ct);
      updateTotal();
    });
  }
  if (comInput) {
    comInput.addEventListener('input', e => { S.form.lineas[idx].comentarios = e.target.value; });
  }
  const despachoCheck = tr.querySelector('.despacho-check');
  if (despachoCheck) {
    despachoCheck.addEventListener('change', e => { S.form.lineas[idx].despachoEnExceso = e.target.checked; });
  }
  const compraOpCheck = tr.querySelector('.compra-op-check');
  if (compraOpCheck) {
    compraOpCheck.addEventListener('change', e => { S.form.lineas[idx].compraOportunidad = e.target.checked; });
  }

  // Inputs exclusivos de item no catalogado
  const nuevoNombre = tr.querySelector('.nuevo-nombre-input');
  if (nuevoNombre) {
    nuevoNombre.addEventListener('input', e => { S.form.lineas[idx].itemNombre = e.target.value; });
  }
  const nuevoCu = tr.querySelector('.nuevo-cu-input');
  if (nuevoCu) {
    nuevoCu.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      S.form.lineas[idx].costoUnitario = val > 0 ? val : null;
      const cu = S.form.lineas[idx].costoUnitario || 0;
      const ct = (S.form.lineas[idx].cantidadSolicitada || 0) * cu;
      const ctEl = tr.querySelector(`.auto-ct-${idx}`);
      if (ctEl) ctEl.textContent = fmtMoney(ct);
      updateTotal();
    });
  }
  const nuevoGrupo = tr.querySelector('.nuevo-grupo-input');
  if (nuevoGrupo) {
    nuevoGrupo.addEventListener('input', e => { S.form.lineas[idx].grupoCompra = e.target.value; });
  }
}

// ─── Autocomplete (portal al body para evitar clipping por overflow) ──────────
let _acActiveInput = null;
let _acActiveIdx   = -1;
let _acFocused     = -1;

const _portal = () => document.getElementById('ac-portal');

function _portalClose() {
  _portal().style.display = 'none';
  _acActiveInput = null;
  _acActiveIdx   = -1;
  _acFocused     = -1;
}

function _portalPosition(input) {
  const r = input.getBoundingClientRect();
  const p = _portal();
  p.style.top    = (r.bottom + 2) + 'px';
  p.style.left   = r.left + 'px';
  p.style.width  = Math.max(r.width, 300) + 'px';
}

function _portalShow(input, idx, filtered) {
  const p = _portal();
  _acActiveInput = input;
  _acActiveIdx   = idx;
  _acFocused     = -1;

  if (!filtered.length) {
    p.innerHTML = `<div class="ac-empty" style="padding:10px 14px;color:#6b7280;font-style:italic">Sin resultados</div>`;
  } else {
    p.innerHTML = filtered.slice(0, 80).map((it, i) => {
      const nombre = it.nombre || it.item;
      return `<div class="ac-item" data-item="${esc(it.item)}" data-nombre="${esc(nombre)}" data-i="${i}"
        style="padding:8px 14px;cursor:pointer;border-bottom:1px solid #e2e6f0;font-size:13px">
        <div><span style="color:#6b7280;font-size:11px">#${esc(it.item)}</span> ${esc(nombre)}</div>
        <div style="font-size:11px;color:#9ca3af">${esc(it.grupoCompra || '')}</div>
      </div>`;
    }).join('');
    p.querySelectorAll('.ac-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        selectItem(el.dataset.item, el.dataset.nombre, idx);
        _portalClose();
      });
      el.addEventListener('mouseover', () => {
        p.querySelectorAll('.ac-item').forEach(x => x.style.background = '');
        el.style.background = '#eef0fd';
        _acFocused = +el.dataset.i;
      });
    });
  }

  _portalPosition(input);
  p.style.display = 'block';
}

// Cerrar al hacer click fuera
document.addEventListener('mousedown', e => {
  if (_acActiveInput && !_portal().contains(e.target) && e.target !== _acActiveInput) {
    _portalClose();
  }
});
// Reposicionar al hacer scroll
window.addEventListener('scroll', () => { if (_acActiveInput) _portalPosition(_acActiveInput); }, true);

function setupAutocomplete(input, idx) {
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { _portalClose(); return; }
    const filtered = S.items.filter(it =>
      (it.nombre || it.item).toLowerCase().includes(q) ||
      (it.grupoCompra || '').toLowerCase().includes(q) ||
      String(it.item).includes(q)
    );
    _portalShow(input, idx, filtered);
  });

  input.addEventListener('keydown', e => {
    if (!_portal().style.display || _portal().style.display === 'none') return;
    const items = _portal().querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _acFocused = Math.min(_acFocused + 1, items.length - 1);
      items.forEach((el, i) => el.style.background = i === _acFocused ? '#eef0fd' : '');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _acFocused = Math.max(_acFocused - 1, 0);
      items.forEach((el, i) => el.style.background = i === _acFocused ? '#eef0fd' : '');
    } else if (e.key === 'Enter' && _acFocused >= 0) {
      e.preventDefault();
      const el = items[_acFocused];
      if (el) { selectItem(el.dataset.item, el.dataset.nombre, idx); _portalClose(); }
    } else if (e.key === 'Escape') {
      _portalClose();
    }
  });

  input.addEventListener('blur', () => setTimeout(_portalClose, 180));
  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });

  // Si la línea ya tiene item cargado y le falta data, buscarla
  if (S.form.lineas[idx]?.item && !S.form.lineas[idx]?.semanaActual) {
    fetchItemData(S.form.lineas[idx].item, idx);
  }
}

async function selectItem(itemCode, itemNombre, idx) {
  const linea = S.form.lineas[idx];
  linea.item = itemCode;
  linea.itemNombre = itemNombre;
  const input = document.querySelector(`.item-input[data-idx="${idx}"]`);
  if (input) input.value = itemNombre;
  // Mostrar icono kardex de inmediato, sin esperar la carga de datos
  const gEl = document.querySelector(`.auto-gestion-${idx}`);
  if (gEl) gEl.innerHTML = `${gestionIcon(linea.gestion || 'COMPRAS')}<button class="btn-kardex" data-item="${esc(itemCode)}" data-nombre="${esc(itemNombre)}" data-op="${esc(S.form.operacion||'')}" title="Ver Kardex">📊</button>`;
  await fetchItemData(itemCode, idx);
}

async function fetchItemData(itemCode, idx) {
  if (!S.form.fecha || !S.form.operacion) return;
  const linea = S.form.lineas[idx];
  // Show loading
  ['ceA', 'rvA', 'rtA', 'vA', 'ceC', 'rvC', 'rtC', 'vC', 'saldo', 'cu', 'grupo'].forEach(k => {
    const el = document.querySelector(`.auto-${k}-${idx}`);
    if (el) { el.textContent = '⏳'; el.className = `auto-${k}-${idx} cell-loading`; }
  });
  try {
    const data = await GET(`/datos/item-data?item=${encodeURIComponent(itemCode)}&operacion=${encodeURIComponent(S.form.operacion)}&fecha=${S.form.fecha}`);
    linea.grupoCompra = data.grupoCompra;
    linea.gestion     = data.gestion || 'COMPRAS';
    linea.loteCompra  = data.loteCompra || 0;
    linea.costoUnitario = data.costoUnitario;
    linea.saldo = data.saldo;
    linea.semanaAnterior = data.semanaAnterior;
    linea.semanaActual = data.semanaActual;

    // Update cells
    const set = (sel, val, cls) => {
      const el = document.querySelector(sel);
      if (el) { el.textContent = val; if (cls) el.className = cls; }
    };
    const sa = data.semanaAnterior, sc = data.semanaActual;
    set(`.auto-grupo-${idx}`, data.grupoCompra || '—');
    set(`.auto-ceA-${idx}`, fmt(sa.consumoEstimado));
    set(`.auto-rvA-${idx}`, fmt(sa.consumoRealVenta));
    set(`.auto-rcA-${idx}`, fmt(sa.consumoReal));
    set(`.auto-ajA-${idx}`, fmt(sa.ajuste));
    set(`.auto-vA-${idx}`, fmt(sa.variacion), `auto-vA-${idx} ${sa.variacion >= 0 ? 'variacion-pos' : 'variacion-neg'}`);
    set(`.auto-ceC-${idx}`, fmt(sc.consumoEstimado));
    set(`.auto-rvC-${idx}`, fmt(sc.consumoRealVenta));
    set(`.auto-rcC-${idx}`, fmt(sc.consumoReal));
    set(`.auto-ajC-${idx}`, fmt(sc.ajuste));
    set(`.auto-vC-${idx}`, fmt(sc.variacion), `auto-vC-${idx} ${sc.variacion >= 0 ? 'variacion-pos' : 'variacion-neg'}`);
    set(`.auto-saldo-${idx}`, fmt(data.saldo));
    set(`.auto-cu-${idx}`, fmtMoney(data.costoUnitario));
    const gEl = document.querySelector(`.auto-gestion-${idx}`);
    if (gEl) gEl.innerHTML = `${gestionIcon(data.gestion || 'COMPRAS')}<button class="btn-kardex" data-item="${esc(itemCode)}" data-nombre="${esc(linea.itemNombre||itemCode)}" data-op="${esc(S.form.operacion||'')}" title="Ver Kardex">📊</button>`;

    // Update costo total
    const ct = (linea.cantidadSolicitada || 0) * (linea.costoUnitario || 0);
    set(`.auto-ct-${idx}`, fmtMoney(ct));
    updateTotal();
  } catch (err) {
    toast('Error cargando datos: ' + err.message, 'error');
  }
}

async function refetchAllLineas() {
  for (let i = 0; i < S.form.lineas.length; i++) {
    if (S.form.lineas[i].item) await fetchItemData(S.form.lineas[i].item, i);
  }
}

async function savePedido() {
  const btn = document.getElementById('save-pedido-btn');
  if (!S.form.operacion) return toast('Seleccione una operación', 'error');
  if (!S.form.fecha) return toast('Seleccione una fecha', 'error');
  const lineas = S.form.lineas.filter(l => l.item || l.esItemNuevo);
  if (!lineas.length) return toast('Agregue al menos una línea con item', 'error');
  // Validar items nuevos: descripción y costo requeridos
  const nuevoSinNombre = lineas.find(l => l.esItemNuevo && !l.itemNombre?.trim());
  if (nuevoSinNombre) return toast('Los items no catalogados deben tener una descripción', 'error');
  const nuevoSinCosto = lineas.find(l => l.esItemNuevo && !(l.costoUnitario > 0));
  if (nuevoSinCosto) return toast(`El item "${nuevoSinCosto.itemNombre || 'nuevo'}" debe tener costo unitario mayor a cero`, 'error');
  const lineaSinCantidad = lineas.find(l => !(l.cantidadSolicitada > 0));
  if (lineaSinCantidad) return toast(`La cantidad de "${lineaSinCantidad.itemNombre || lineaSinCantidad.item}" debe ser mayor a cero`, 'error');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';
  try {
    if (S.form.id) {
      await PUT(`/pedidos/${S.form.id}`, { lineas, accion: 'editar', resubmit: true });
      toast('Pedido actualizado', 'success');
    } else {
      await POST('/pedidos', { operacion: S.form.operacion, fechaPedido: S.form.fecha, lineas });
      toast('Pedido guardado exitosamente', 'success');
    }
    navigate('mis-pedidos');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = S.form.id ? '💾 Actualizar' : '💾 Guardar Pedido';
  }
}

// ─── View: Mis Pedidos ────────────────────────────────────────────
async function viewMisPedidos(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">📋 Mis Pedidos</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="showHelp('mis-pedidos')">❓ Ayuda</button>
        <button class="btn btn-primary" onclick="navigate('solicitar')">+ Nuevo Pedido</button>
      </div>
    </div>
    <div class="page-body">
      <div class="filter-bar mb-8" style="flex-wrap:wrap;gap:8px">
        <select id="filter-estado">
          <option value="">Todos los estados</option>
          ${ESTADOS.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
        <select id="filter-op">
          <option value="">Todas las operaciones</option>
          ${(S.user.operations || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted)">
          Desde <input type="date" id="filter-desde" class="form-control" style="width:140px;padding:6px 8px;font-size:13px">
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted)">
          Hasta <input type="date" id="filter-hasta" class="form-control" style="width:140px;padding:6px 8px;font-size:13px">
        </label>
        <button class="btn btn-sm btn-outline" id="filter-clear" title="Limpiar filtros">✕ Limpiar</button>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" id="btn-print-all">🖨️ Imprimir</button>
          <button class="btn btn-sm btn-outline" id="btn-export-all">📥 Excel</button>
        </div>
      </div>
      <div class="mp-toolbar mb-8" style="display:flex;align-items:center;gap:10px;min-height:34px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none">
          <input type="checkbox" id="sel-all" style="width:16px;height:16px;accent-color:var(--primary)">
          Seleccionar todos
        </label>
        <span id="sel-count" style="font-size:13px;color:var(--text-muted)"></span>
        <button class="btn btn-sm btn-success hidden" id="btn-export" style="margin-left:auto">
          ⬇️ Excel seleccionados (<span id="export-count">0</span>)
        </button>
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); }

  // Set de IDs seleccionados
  const selected = new Set();

  function getFiltered() {
    const est   = document.getElementById('filter-estado').value;
    const op    = document.getElementById('filter-op').value;
    const desde = document.getElementById('filter-desde').value;
    const hasta = document.getElementById('filter-hasta').value;
    return pedidos.filter(p => {
      if (est  && p.estado !== est) return false;
      if (op   && p.operacion !== op) return false;
      const f = (p.fechaPedido || '').slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      return true;
    });
  }

  function updateToolbar(filtered) {
    const selInView = filtered.filter(p => selected.has(p.id));
    const count = selected.size;
    document.getElementById('sel-count').textContent = count ? `${count} seleccionado${count !== 1 ? 's' : ''}` : '';
    const exportBtn = document.getElementById('btn-export');
    if (count > 0) {
      exportBtn.classList.remove('hidden');
      document.getElementById('export-count').textContent = count;
    } else {
      exportBtn.classList.add('hidden');
    }
    // Sync select-all checkbox
    const selAll = document.getElementById('sel-all');
    if (selAll) {
      selAll.indeterminate = selInView.length > 0 && selInView.length < filtered.length;
      selAll.checked = filtered.length > 0 && selInView.length === filtered.length;
    }
  }

  function render() {
    const filtered = getFiltered();
    renderPedidosListConCheck(document.getElementById('pedidos-list'), filtered, selected, onToggle);
    updateToolbar(filtered);
  }

  function onToggle(id, checked) {
    if (checked) selected.add(id); else selected.delete(id);
    updateToolbar(getFiltered());
  }

  // Filtros
  ['filter-estado', 'filter-op', 'filter-desde', 'filter-hasta'].forEach(id => {
    document.getElementById(id).addEventListener('change', render);
  });

  document.getElementById('filter-clear').addEventListener('click', () => {
    document.getElementById('filter-estado').value = '';
    document.getElementById('filter-op').value = '';
    document.getElementById('filter-desde').value = '';
    document.getElementById('filter-hasta').value = '';
    render();
  });

  // Seleccionar todos
  document.getElementById('sel-all').addEventListener('change', e => {
    const filtered = getFiltered();
    if (e.target.checked) filtered.forEach(p => selected.add(p.id));
    else filtered.forEach(p => selected.delete(p.id));
    render();
  });

  // Imprimir / Excel sobre lo filtrado
  document.getElementById('btn-print-all').addEventListener('click', () => {
    imprimirPedidos(getFiltered(), 'Mis Pedidos');
  });
  document.getElementById('btn-export-all').addEventListener('click', () => {
    exportarExcel(getFiltered());
  });

  // Exportar seleccionados
  document.getElementById('btn-export').addEventListener('click', async () => {
    if (!selected.size) return;
    await exportarExcel(pedidos.filter(p => selected.has(p.id)));
    // Restaurar label con count
    const b = document.getElementById('btn-export');
    if (b) b.innerHTML = `⬇️ Excel seleccionados (<span id="export-count">${selected.size}</span>)`;
  });

  render();
}

// Variante de renderPedidosList con checkboxes de selección
function renderPedidosListConCheck(container, pedidos, selected, onToggle) {
  if (!pedidos.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No hay pedidos</p></div>`;
    return;
  }
  container.innerHTML = pedidos.map(p => pedidoCardConCheck(p, selected.has(p.id))).join('');

  // Expand/collapse
  container.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', e => {
      if (e.target.closest('.mp-check-wrap')) return; // no colapsar al hacer click en checkbox
      h.nextElementSibling.classList.toggle('open');
    });
  });

  // Editar
  container.querySelectorAll('.btn-edit-pedido').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); navigate('solicitar', { editId: btn.dataset.id }); });
  });

  // Checkboxes
  container.querySelectorAll('.mp-pedido-check').forEach(chk => {
    chk.addEventListener('change', e => { e.stopPropagation(); onToggle(chk.dataset.id, chk.checked); });
  });
}

function pedidoCardConCheck(p, isChecked) {
  const canEdit = ['SOLICITADO', 'REVISAR'].includes(p.estado);
  return `
    <div class="pedido-card ${isChecked ? 'pedido-card-selected' : ''}" data-id="${p.id}">
      <div class="pedido-card-header">
        <div class="mp-check-wrap" onclick="event.stopPropagation()" style="display:flex;align-items:center;padding-right:10px">
          <input type="checkbox" class="mp-pedido-check" data-id="${p.id}" ${isChecked ? 'checked' : ''}
            style="width:17px;height:17px;accent-color:var(--primary);cursor:pointer">
        </div>
        <div class="pedido-meta" style="flex:1">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-${p.estado}">${p.estado}</span></div>
          <div class="pedido-info">
            📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
            ${p.aprobadoPorNombre ? ` &nbsp;·&nbsp; ✅ ${esc(p.aprobadoPorNombre)}` : ''}
            ${p.atendidoPorNombre ? ` &nbsp;·&nbsp; 🚚 ${esc(p.atendidoPorNombre)}` : ''}
          </div>
        </div>
        <div class="pedido-actions" onclick="event.stopPropagation()">
          ${canEdit ? `<button class="btn btn-sm btn-outline btn-edit-pedido" data-id="${p.id}">✏️ Editar</button>` : ''}
          <span style="color:var(--text-muted);font-size:12px">▼</span>
        </div>
      </div>
      <div class="pedido-card-body">
        ${renderLineasReadOnly(p.lineas, p.operacion)}
        <div class="mt-8 text-right font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
      </div>
    </div>`;
}

// ─── View: Kardex ────────────────────────────────────────────────
async function viewKardex(container) {
  const userOps = S.user.operations || [];
  const ops = S.user.role === ROLES.ADMIN ? ALL_OPS : userOps;
  let activeOp = ops[0];
  let allItems = [];

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">📊 Kardex</div>
      <button class="btn btn-outline btn-sm" onclick="showHelp('kardex')">❓ Ayuda</button>
    </div>
    <div class="page-body">
      <div class="tab-bar">
        ${ops.map(o => `<button class="tab-btn${o===activeOp?' active':''}" data-op="${o}">${o}</button>`).join('')}
      </div>
      <div class="card mt-16" style="max-width:500px">
        <div class="card-body">
          <label class="form-label">Buscar item</label>
          <div style="position:relative">
            <input id="kx-item-input" type="text" class="form-control" placeholder="Escriba código o nombre del item..." autocomplete="off">
            <div id="kx-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid #4361ee;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);max-height:260px;overflow-y:auto;z-index:100"></div>
          </div>
        </div>
      </div>
      <div id="kx-result" class="mt-16"></div>
    </div>`;

  async function loadItems() {
    try { allItems = await GET(`/datos/items?operacion=${activeOp}`); } catch { allItems = []; }
  }

  function renderKardexTable(data, item, nombre) {
    const resultDiv = document.getElementById('kx-result');
    if (!data.length) { resultDiv.innerHTML = `<p class="text-muted">Sin movimientos en el kardex para este item.</p>`; return; }
    const semanas = data.map(d => d.semana);
    const allTrx = new Set();
    data.forEach(d => Object.keys(d.movimientos).forEach(t => allTrx.add(t)));
    const trxMain2   = TRX_MAIN.filter(t => allTrx.has(t));
    const trxExtra2  = [...allTrx].filter(t => !TRX_MAIN.includes(t) && !TRX_BOTTOM.includes(t));
    const trxBottom2 = TRX_BOTTOM.filter(t => allTrx.has(t));
    const fmtK2 = v => v === 0 ? '<span style="color:#9ca3af">-</span>' : fmt(v, 2);
    const hdr = s => {
      if (s === 'HASTA') return `<span style="font-size:10px;line-height:1.4">Hist.<br>anterior</span>`;
      const yr = Math.floor(s / 100), wk = String(s % 100).padStart(2, '0');
      return `Sem<br><small>${yr}-${wk}</small>`;
    };
    const semanaCols = semanas.map(s => `<th class="col-num" style="white-space:nowrap">${hdr(s)}</th>`).join('');
    const buildRow = (label, key, bold=false) => {
      const cells = data.map(d => {
        const v = key==='__saldoInicial' ? d.saldoInicial : key==='__saldoFinal' ? d.saldoFinal : (d.movimientos[key]||0);
        return `<td class="col-num" style="white-space:nowrap">${fmtK2(v)}</td>`;
      }).join('');
      return `<tr style="${bold?'font-weight:700;background:#f0f4ff':''}"><td style="white-space:nowrap;padding:4px 10px">${label}</td>${cells}</tr>`;
    };
    resultDiv.innerHTML = `
      <div class="card">
        <div class="card-body" style="padding:12px">
          <div class="section-title mb-8">📦 ${esc(nombre)} &nbsp;<span style="color:#6b7280;font-weight:400;font-size:13px">${esc(item)} — ${esc(activeOp)}</span></div>
          <div style="overflow-x:auto">
            <table class="data-table" style="font-size:12px">
              <thead><tr style="background:#4361ee;color:#fff">
                <th style="min-width:220px;text-align:left;padding:6px 10px">Movimiento</th>${semanaCols}
              </tr></thead>
              <tbody>
                ${buildRow('SALDO INICIAL','__saldoInicial',true)}
                ${trxMain2.map(t=>buildRow(t,t)).join('')}
                ${trxExtra2.map(t=>buildRow(t,t)).join('')}
                <tr><td colspan="${semanas.length+1}" style="padding:0;border:none"><hr style="margin:4px 0;border-color:#e5e7eb"></td></tr>
                ${trxBottom2.map(t=>buildRow(t,t)).join('')}
                ${buildRow('SALDO FINAL','__saldoFinal',true)}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  async function selectKardexItem(itemCode, itemNombre) {
    document.getElementById('kx-item-input').value = `${itemCode} — ${itemNombre}`;
    document.getElementById('kx-dropdown').style.display = 'none';
    document.getElementById('kx-result').innerHTML = `<div style="padding:40px;text-align:center"><span class="spinner spinner-dark"></span></div>`;
    try {
      const data = await GET(`/datos/kardex-item?item=${encodeURIComponent(itemCode)}&operacion=${encodeURIComponent(activeOp)}&semanas=8`);
      renderKardexTable(data, itemCode, itemNombre);
    } catch(err) { document.getElementById('kx-result').innerHTML = `<p class="msg-error">${err.message}</p>`; }
  }

  container.querySelectorAll('.tab-btn[data-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.tab-btn[data-op]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeOp = btn.dataset.op;
      document.getElementById('kx-item-input').value = '';
      document.getElementById('kx-result').innerHTML = '';
      await loadItems();
    });
  });

  const input = document.getElementById('kx-item-input');
  const dropdown = document.getElementById('kx-dropdown');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = allItems.filter(i => i.item.toLowerCase().includes(q) || i.nombre.toLowerCase().includes(q)).slice(0, 15);
    if (!matches.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = matches.map(i => `<div class="ac-item" data-item="${esc(i.item)}" data-nombre="${esc(i.nombre)}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6"><strong>${esc(i.item)}</strong> — ${esc(i.nombre)}</div>`).join('');
    dropdown.style.display = 'block';
    dropdown.querySelectorAll('.ac-item').forEach(el => {
      el.addEventListener('mousedown', () => selectKardexItem(el.dataset.item, el.dataset.nombre));
    });
  });
  input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 200));

  await loadItems();
}

// ─── View: Comentarios ───────────────────────────────────────────
async function viewComentarios(container) {
  const ops = S.user.role === ROLES.ADMIN ? ALL_OPS : (S.user.operations || []);
  let activeOp = ops[0];

  function renderShell() {
    container.innerHTML = `
      <div class="page-header"><div class="page-title">💬 Comentarios</div></div>
      <div class="page-body">
        <div class="tabs" id="com-tabs">
          ${ops.map(o => `<button class="tab-btn${o===activeOp?' active':''}" data-op="${o}">${o}</button>`).join('')}
        </div>
        <div class="card" style="max-width:700px">
          <div class="card-body" style="padding:0;display:flex;flex-direction:column;height:62vh">
            <div id="com-list" style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px">
              <div class="loading-overlay"><span class="spinner spinner-dark"></span></div>
            </div>
            <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px">
              <textarea id="com-texto" placeholder="Escribe un comentario para ${activeOp}..." rows="2"
                style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:13px;resize:none"></textarea>
              <button class="btn btn-primary" id="com-send" style="align-self:flex-end">Enviar</button>
            </div>
          </div>
        </div>
      </div>`;

    container.querySelectorAll('#com-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeOp = btn.dataset.op;
        renderShell();
        loadComments();
      });
    });

    document.getElementById('com-send')?.addEventListener('click', async () => {
      const texto = document.getElementById('com-texto')?.value?.trim();
      if (!texto) return;
      const btn = document.getElementById('com-send');
      btn.disabled = true;
      try {
        await POST('/comentarios', { texto, operacion: activeOp });
        document.getElementById('com-texto').value = '';
        await loadComments();
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
    });

    document.getElementById('com-texto')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) document.getElementById('com-send')?.click();
    });
  }

  async function loadComments() {
    const list = document.getElementById('com-list');
    if (!list) return;
    list.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
    try {
      const comentarios = await GET(`/comentarios?operacion=${encodeURIComponent(activeOp)}`);
      if (!list) return;
      if (!comentarios.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>Sin comentarios para ${activeOp} aún.</p></div>`;
      } else {
        list.innerHTML = comentarios.map(c => {
          const isOwn = c.userId === S.user.id;
          const rol   = ROLE_LABELS[c.role] || c.role;
          const dt    = new Date(c.createdAt).toLocaleString('es-CL');
          return `
            <div style="display:flex;flex-direction:column;align-items:${isOwn?'flex-end':'flex-start'}">
              <div style="max-width:80%;background:${isOwn?'var(--accent-light)':'#f3f4f6'};border-radius:12px;padding:10px 14px;
                          border-bottom-${isOwn?'right':'left'}-radius:3px">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
                  <strong>${esc(c.username)}</strong>
                  &nbsp;<span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:10px">${esc(rol)}</span>
                  &nbsp;· ${dt}
                </div>
                <div style="font-size:13px">${esc(c.texto)}</div>
              </div>
            </div>`;
        }).join('');
        list.scrollTop = list.scrollHeight;
      }
    } catch (err) {
      if (list) list.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
    }
  }

  renderShell();
  await loadComments();
}

// ─── View: Aprobar ────────────────────────────────────────────────
async function viewAprobar(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">✅ Aprobar Pedidos</div>
      <button class="btn btn-outline btn-sm" onclick="showHelp('aprobar')">❓ Ayuda</button>
    </div>
    <div class="page-body">
      <div class="filter-bar mb-16">
        <select id="filter-op"><option value="">Todas las operaciones</option>
          ${(S.user.operations || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <select id="filter-estado">
          <option value="">Todos los estados</option>
          ${ESTADOS.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" id="btn-print-apr">🖨️ Imprimir</button>
          <button class="btn btn-sm btn-outline" id="btn-export-apr">📥 Excel</button>
        </div>
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); }

  let filteredApr = [];

  function render() {
    const op  = document.getElementById('filter-op').value;
    const est = document.getElementById('filter-estado').value;
    filteredApr = pedidos.filter(p =>
      (!op  || p.operacion === op) &&
      (!est || p.estado === est)
    );
    const pendientes  = filteredApr.filter(p => ['SOLICITADO','REVISAR'].includes(p.estado));
    const procesados  = filteredApr.filter(p => !['SOLICITADO','REVISAR'].includes(p.estado));
    const list = document.getElementById('pedidos-list');
    list.innerHTML = '';
    renderPedidosAprobar(list, pendientes);
    if (procesados.length) {
      const sep = document.createElement('div');
      sep.innerHTML = `<div class="section-title mt-8 mb-16" style="margin-top:32px;color:var(--text-muted)">📋 Procesados</div>`;
      list.appendChild(sep);
      renderPedidosProcesados(list, procesados);
    }
  }
  document.getElementById('filter-op').addEventListener('change', render);
  document.getElementById('filter-estado').addEventListener('change', render);
  document.getElementById('btn-print-apr').addEventListener('click', () => {
    imprimirPedidos(filteredApr, 'Aprobar Pedidos');
  });
  document.getElementById('btn-export-apr').addEventListener('click', () => {
    exportarExcel(filteredApr);
  });
  render();
}

// ─── View: Atender ────────────────────────────────────────────────
async function viewAtender(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🚚 Atender Pedidos</div>
      <button class="btn btn-outline btn-sm" onclick="showHelp('atender')">❓ Ayuda</button>
    </div>
    <div class="page-body">
      <div class="filter-bar mb-16">
        <select id="filter-op"><option value="">Todas las operaciones</option>
          ${(S.user.operations || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <select id="filter-gestion">
          <option value="">Compras y Planta</option>
          <option value="COMPRAS">Solo Compras</option>
          <option value="PLANTA">Solo Planta</option>
        </select>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-sm btn-outline" id="btn-print-ate">🖨️ Imprimir</button>
          <button class="btn btn-sm btn-outline" id="btn-export-ate">📥 Excel</button>
        </div>
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos?vista=atender'); } catch (err) { toast(err.message, 'error'); }

  let filteredAte = [];
  let currentGestion = '';

  function render() {
    const op      = document.getElementById('filter-op').value;
    currentGestion = document.getElementById('filter-gestion').value;
    filteredAte = pedidos.filter(p => !op || p.operacion === op);
    const activos   = filteredAte.filter(p => p.estado === 'APROBADO');
    const atendidos = filteredAte.filter(p => p.estado === 'ATENDIDO');
    const list = document.getElementById('pedidos-list');
    list.innerHTML = '';
    renderPedidosAtender(list, activos, currentGestion);
    if (atendidos.length) {
      const sep = document.createElement('div');
      sep.innerHTML = `<div class="section-title mt-8 mb-16" style="margin-top:32px;color:var(--text-muted)">✔ Atendidos</div>`;
      list.appendChild(sep);
      renderPedidosAtendidos(list, atendidos, currentGestion);
    }
  }
  document.getElementById('filter-op').addEventListener('change', render);
  document.getElementById('filter-gestion').addEventListener('change', render);
  document.getElementById('btn-print-ate').addEventListener('click', () => {
    imprimirPedidos(filteredAte, 'Atender Pedidos', currentGestion);
  });
  document.getElementById('btn-export-ate').addEventListener('click', () => {
    exportarExcel(filteredAte, currentGestion);
  });
  render();
}

// ─── Pedido list renderers ────────────────────────────────────────
function renderPedidosList(container, pedidos, opts = {}) {
  if (!pedidos.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No hay pedidos</p></div>`;
    return;
  }
  container.innerHTML = pedidos.map(p => pedidoCard(p, opts)).join('');
  container.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', () => {
      const body = h.nextElementSibling;
      body.classList.toggle('open');
    });
  });
  if (opts.canEdit) {
    container.querySelectorAll('.btn-edit-pedido').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); navigate('solicitar', { editId: btn.dataset.id }); });
    });
  }
}

function pedidoCard(p, opts = {}) {
  const canEdit = opts.canEdit && ['SOLICITADO', 'REVISAR'].includes(p.estado);
  return `
    <div class="pedido-card">
      <div class="pedido-card-header">
        <div class="pedido-meta">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-${p.estado}">${p.estado}</span></div>
          <div class="pedido-info">
            📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
            ${p.aprobadoPorNombre ? ` &nbsp;·&nbsp; ✅ ${esc(p.aprobadoPorNombre)}` : ''}
            ${p.atendidoPorNombre ? ` &nbsp;·&nbsp; 🚚 ${esc(p.atendidoPorNombre)}` : ''}
          </div>
        </div>
        <div class="pedido-actions" onclick="event.stopPropagation()">
          ${canEdit ? `<button class="btn btn-sm btn-outline btn-edit-pedido" data-id="${p.id}">✏️ Editar</button>` : ''}
          <span style="color:var(--text-muted);font-size:12px">▼</span>
        </div>
      </div>
      <div class="pedido-card-body">
        ${renderLineasReadOnly(p.lineas, p.operacion)}
        <div class="mt-8 text-right font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
      </div>
    </div>`;
}

function renderLineasReadOnly(lineas, operacion = '') {
  if (!lineas?.length) return '<p class="text-muted">Sin líneas</p>';
  const hasAtencion = lineas.some(l => l.estadoAtencion === 'ATENDIDO');
  const hasApproval = lineas.some(l => l.estadoLinea && l.estadoLinea !== 'PENDIENTE');
  const mode = hasAtencion ? 'atendido' : hasApproval ? 'approved' : 'read';
  return `<div class="table-wrap"><table>
    ${renderTableHeader(mode)}
    <tbody>
      ${lineas.map((l, i) => renderLineaRow(l, i, false, mode, operacion)).join('')}
    </tbody>
    </table></div>`;
}

function renderPedidosAprobar(container, pedidos) {
  if (!pedidos.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No hay pedidos pendientes de aprobación</p></div>`;
    return;
  }

  container.innerHTML = pedidos.map(p => `
    <div class="pedido-card" id="pc-${p.id}">
      <div class="pedido-card-header">
        <div class="pedido-meta">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-${p.estado}">${p.estado}</span></div>
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}</div>
        </div>
        <span style="color:var(--text-muted);font-size:12px">▼</span>
      </div>
      <div class="pedido-card-body open">
        <div class="table-wrap">
          <table>
            ${renderTableHeader('approve')}
            <tbody>
              ${p.lineas.map((l, i) => renderLineaRow(l, i, false, 'approve', p.operacion)).join('')}
            </tbody>
          </table>
        </div>
        <div class="aprobacion-row" style="justify-content:space-between">
          ${S.user.role === 'ADMIN' ? `<button class="btn btn-sm btn-danger apr-del-btn" data-id="${p.id}">🗑️ Eliminar pedido</button>` : '<span></span>'}
          <button class="btn btn-primary apr-save-btn" data-id="${p.id}">💾 Guardar aprobación</button>
        </div>
      </div>
    </div>`).join('');

  container.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('open'));
  });

  container.querySelectorAll('.apr-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = document.getElementById(`pc-${id}`);
      if (!confirm('¿Eliminar este pedido? Esta acción no se puede deshacer.')) return;
      try {
        await DEL(`/pedidos/${id}`);
        toast('Pedido eliminado', 'success');
        card.style.opacity = '0.4';
        setTimeout(() => card.remove(), 600);
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  container.querySelectorAll('.apr-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = document.getElementById(`pc-${id}`);
      const lineaData = [];
      card.querySelectorAll('.apr-linea-estado').forEach(sel => {
        const lid = sel.dataset.lineaId;
        const comentInput = card.querySelector(`.apr-linea-comentario[data-linea-id="${lid}"]`);
        lineaData.push({ id: lid, estadoLinea: sel.value, comentarioAprobador: comentInput?.value || '' });
      });
      if (lineaData.some(l => !l.estadoLinea)) return toast('Asigne un estado a todas las líneas', 'error');
      btn.disabled = true; btn.textContent = '⏳';
      try {
        await PUT(`/pedidos/${id}`, { lineas: lineaData });
        toast('Aprobación guardada', 'success');
        card.style.opacity = '0.4';
        setTimeout(() => card.remove(), 800);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = '💾 Guardar aprobación';
      }
    });
  });
}

function renderPedidosProcesados(container, pedidos) {
  const wrap = document.createElement('div');
  wrap.innerHTML = pedidos.map(p => {
    const estadoMode = p.estado === 'ATENDIDO' ? 'atendido' : 'approved';
    return `
    <div class="pedido-card" id="pcp-${p.id}">
      <div class="pedido-card-header">
        <div class="pedido-meta">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-${p.estado}">${p.estado}</span></div>
          <div class="pedido-info">
            📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
            ${p.aprobadoPorNombre ? ` &nbsp;·&nbsp; ✅ ${esc(p.aprobadoPorNombre)}` : ''}
            ${p.atendidoPorNombre ? ` &nbsp;·&nbsp; 🚚 ${esc(p.atendidoPorNombre)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
          ${S.user.role === 'ADMIN' ? `<button class="btn btn-sm btn-danger pcp-del-btn" data-id="${p.id}">🗑️</button>` : ''}
          <span style="color:var(--text-muted);font-size:12px">▼</span>
        </div>
      </div>
      <div class="pedido-card-body">
        <div class="table-wrap"><table>
          ${renderTableHeader(estadoMode)}
          <tbody>${p.lineas.map((l,i) => renderLineaRow(l, i, false, estadoMode, p.operacion)).join('')}</tbody>
        </table></div>
        <div class="mt-8 text-right font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.pedido-card-header').forEach(h =>
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('open'))
  );
  wrap.querySelectorAll('.pcp-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('¿Eliminar este pedido? Esta acción no se puede deshacer.')) return;
      try {
        await DEL(`/pedidos/${id}`);
        toast('Pedido eliminado', 'success');
        const card = document.getElementById(`pcp-${id}`);
        if (card) { card.style.opacity = '0.4'; setTimeout(() => card.remove(), 600); }
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  container.appendChild(wrap);
}

// ─── Tabla simplificada para Atender ─────────────────────────────
// Columnas: Código | Descripción | Grupo | Cantidad | Comentarios | Coment. Aprobador | [Atendido]
function renderLineasAtenderSimple(lineas, gestionFilter, gestionRol, readonly) {
  const visible = gestionFilter
    ? lineas.filter(l => (l.gestion || 'COMPRAS') === gestionFilter)
    : lineas;

  if (!visible.length) {
    return `<p class="text-muted" style="padding:8px 0">Sin líneas para esta gestión</p>`;
  }

  const rows = visible.map(l => {
    const esPropia  = S.user.role === 'ADMIN' || (l.gestion || 'COMPRAS') === gestionRol;
    const atendido  = l.estadoAtencion === 'ATENDIDO';
    const rechazado = l.estadoLinea    === 'RECHAZADO';
    const rowRO     = readonly || !esPropia || atendido;
    const lid       = esc(l.id || '');

    let atencionCell;
    if (rechazado) {
      atencionCell = `<span style="color:#9ca3af;font-size:12px">N/A</span>`;
    } else if (rowRO) {
      atencionCell = atendido ? `<span class="badge badge-APROBADO">✔ Atendido</span>` : '';
    } else {
      atencionCell = `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13px">
        <input type="checkbox" class="atn-linea-check" data-linea-id="${lid}" ${atendido?'checked':''} style="width:16px;height:16px;accent-color:var(--success)">
      </label>`;
    }

    return `<tr>
      <td style="font-family:monospace;font-size:12px;white-space:nowrap;color:#374151">${esc(l.item || '—')}</td>
      <td><strong style="font-size:13px">${esc(l.itemNombre || l.item || '—')}</strong><br><button onclick="generarSolicitudDesdeDesglose()" style="margin-top:4px;font-size:11px;padding:2px 8px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer">🏭 Genera Adicional</button></td>
      <td style="font-size:13px">${esc(l.grupoCompra || '—')}</td>
      <td class="col-num" style="font-weight:600">${fmt(l.cantidadSolicitada)}</td>
      <td style="font-size:12px">${esc(l.comentarios || '')}</td>
      <td style="font-size:12px;color:#374151">${esc(l.comentarioAprobador || '')}</td>
      ${!readonly ? `<td style="text-align:center">${atencionCell}</td>` : `<td style="text-align:center">${atencionCell}</td>`}
    </tr>`;
  }).join('');

  return `<div class="table-wrap"><table>
    <thead><tr>
      <th style="min-width:90px">Código</th>
      <th style="min-width:180px">Descripción</th>
      <th style="min-width:80px">Grupo</th>
      <th class="col-num" style="min-width:80px">Cantidad</th>
      <th style="min-width:160px">Comentarios</th>
      <th style="min-width:160px">Coment. Aprobador</th>
      <th style="min-width:90px;text-align:center">Atendido</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderPedidosAtender(container, pedidos, gestionFilter = '') {
  if (!pedidos.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🚚</div><p>No hay pedidos aprobados pendientes</p></div>`;
    return;
  }
  const gestionRol = S.user.role === 'OPERADOR_PLANTA' ? 'PLANTA' : 'COMPRAS';

  container.innerHTML = pedidos.map(p => `
    <div class="pedido-card" id="pac-${p.id}">
      <div class="pedido-card-header">
        <div class="pedido-meta">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-${p.estado}">${p.estado}</span></div>
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)} &nbsp;·&nbsp; ✅ ${esc(p.aprobadoPorNombre||'')}</div>
        </div>
        <span style="color:var(--text-muted);font-size:12px">▼</span>
      </div>
      <div class="pedido-card-body open">
        ${renderLineasAtenderSimple(p.lineas, gestionFilter, gestionRol, false)}
        <div class="flex gap-8 mt-8 justify-between items-center">
          <div class="font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
          <button class="btn btn-success ate-save-btn" data-id="${p.id}">💾 Guardar atención</button>
        </div>
      </div>
    </div>`).join('');

  container.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('open'));
  });

  container.querySelectorAll('.ate-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = document.getElementById(`pac-${id}`);
      const lineaData = [];
      card.querySelectorAll('.atn-linea-check').forEach(cb => {
        lineaData.push({ id: cb.dataset.lineaId, estadoAtencion: cb.checked ? 'ATENDIDO' : 'PENDIENTE' });
      });
      btn.disabled = true; btn.textContent = '⏳';
      try {
        await PUT(`/pedidos/${id}`, { lineas: lineaData });
        toast('Estado de atención guardado', 'success');
        // Actualizar etiquetas de checkboxes sin recargar
        card.querySelectorAll('.atn-linea-check').forEach(cb => {
          const label = cb.closest('label');
          const span = label?.querySelector('span');
          if (cb.checked) {
            if (!span) label?.insertAdjacentHTML('beforeend', '<span style="color:var(--success);font-weight:600">Atendido</span>');
          } else {
            if (span) span.remove();
          }
        });
      } catch (err) {
        toast(err.message, 'error');
      }
      btn.disabled = false; btn.textContent = '💾 Guardar atención';
    });
  });
}

function renderPedidosAtendidos(container, pedidos, gestionFilter = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = pedidos.map(p => `
    <div class="pedido-card">
      <div class="pedido-card-header">
        <div class="pedido-meta">
          <div class="pedido-op">${esc(p.operacion)} &nbsp;<span class="badge badge-ATENDIDO">ATENDIDO</span></div>
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} ${fmtTime(p.createdAt)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
            ${p.atendidoPorNombre ? ` &nbsp;·&nbsp; 🚚 ${esc(p.atendidoPorNombre)}` : ''}
          </div>
        </div>
        <span style="color:var(--text-muted);font-size:12px">▼</span>
      </div>
      <div class="pedido-card-body">
        ${renderLineasAtenderSimple(p.lineas, gestionFilter, '', true)}
        <div class="mt-8 text-right font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('open'));
  });
  container.appendChild(wrap);
}

// ─── Resumen de adicionales ───────────────────────────────────────
async function showResumenModal() {
  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); return; }

  // Agrupar por semana y mes
  function semanaISO(fecha) {
    const d = new Date(fecha + 'T12:00:00');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
    return `${d.getUTCFullYear()}-S${String(w).padStart(2,'0')}`;
  }
  function mesLabel(fecha) {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-CL', { year: 'numeric', month: 'long' });
  }

  const bySem = {}, byMes = {};
  for (const p of pedidos) {
    const f   = p.fechaPedido || p.createdAt?.split('T')[0] || '';
    const sem = f ? semanaISO(f) : '—';
    const mes = f ? mesLabel(f) : '—';
    const totalLineas = (p.lineas || []).filter(l => l.estadoLinea === 'APROBADO');
    const totalVal = totalLineas.reduce((s, l) => s + (l.cantidadSolicitada || 0) * (l.costoUnitario || 0), 0);

    if (!bySem[sem]) bySem[sem] = { pedidos: 0, lineas: 0, total: 0 };
    bySem[sem].pedidos++;
    bySem[sem].lineas += totalLineas.length;
    bySem[sem].total  += totalVal;

    if (!byMes[mes]) byMes[mes] = { pedidos: 0, lineas: 0, total: 0 };
    byMes[mes].pedidos++;
    byMes[mes].lineas += totalLineas.length;
    byMes[mes].total  += totalVal;
  }

  const rowsSem = Object.entries(bySem).sort((a,b) => a[0].localeCompare(b[0])).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v.pedidos}</td><td>${v.lineas}</td><td class="col-num">${fmtMoney(v.total)}</td></tr>`
  ).join('');
  const rowsMes = Object.entries(byMes).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v.pedidos}</td><td>${v.lineas}</td><td class="col-num">${fmtMoney(v.total)}</td></tr>`
  ).join('');

  const totalGlobal = pedidos.reduce((s, p) =>
    s + (p.lineas || []).filter(l => l.estadoLinea === 'APROBADO').reduce((ss, l) => ss + (l.cantidadSolicitada || 0) * (l.costoUnitario || 0), 0), 0
  );

  openModal('📊 Resumen de Adicionales', `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Total global aprobado: <strong>${fmtMoney(totalGlobal)}</strong> — ${pedidos.length} pedidos</p>
    <h4 style="font-size:13px;font-weight:700;margin-bottom:8px">Por Semana</h4>
    <div class="table-wrap">
      <table class="resumen-table">
        <thead><tr><th>Semana</th><th># Pedidos</th><th># Items Apr.</th><th>Total S/</th></tr></thead>
        <tbody>${rowsSem || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sin datos</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="font-size:13px;font-weight:700;margin:16px 0 8px">Por Mes</h4>
    <div class="table-wrap">
      <table class="resumen-table">
        <thead><tr><th>Mes</th><th># Pedidos</th><th># Items Apr.</th><th>Total S/</th></tr></thead>
        <tbody>${rowsMes || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sin datos</td></tr>'}</tbody>
      </table>
    </div>`);
}

// ─── View: Comparativo OC ─────────────────────────────────────────

async function viewComparativo(container) {
  // Cargar operaciones con datos reales desde API
  let opsConDatos = [];
  try { opsConDatos = await GET('/comparativo/operaciones'); } catch {}

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">📈 Comparativo OC vs Ingresos</div>
    </div>
    <div class="page-body">
      <!-- Filtros -->
      <div class="card mb-16" style="padding:16px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
            <select id="cmp-op" class="form-control" style="width:160px">
              ${opsConDatos.length
                ? opsConDatos.map(o => `<option value="${o}">${o}</option>`).join('')
                : '<option value="">Sin datos</option>'}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Grupo Compra</label>
            <select id="cmp-grupo" class="form-control" style="width:180px">
              <option value="">Todos los grupos</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Semanas</label>
            <select id="cmp-sems" class="form-control" style="width:130px">
              <option value="4">4 sem (1 mes)</option>
              <option value="8" selected>8 sem (2 meses)</option>
              <option value="13">13 sem (3 meses)</option>
              <option value="26">26 sem (6 meses)</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Vista</label>
            <select id="cmp-vista" class="form-control" style="width:160px">
              <option value="resumen">Resumen por ítem</option>
              <option value="evolucion" selected>Evolución semanal</option>
            </select>
          </div>
          <button class="btn btn-primary" id="cmp-buscar" style="align-self:flex-end">🔍 Buscar</button>
        </div>
      </div>
      <!-- Leyenda eficiencia -->
      <div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;margin-right:4px"></span>90–110% (en rango)</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:4px"></span>70–90% o 110–130% (desviación leve)</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:4px"></span>&lt;70% o &gt;130% (crítico)</span>
      </div>
      <div id="cmp-result"></div>
    </div>`;

  // Cargar grupos al cambiar operación
  async function cargarGrupos() {
    const op = document.getElementById('cmp-op').value;
    try {
      const grupos = await GET(`/comparativo/grupos?operacion=${op}`);
      const sel = document.getElementById('cmp-grupo');
      sel.innerHTML = '<option value="">Todos los grupos</option>';
      grupos.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        sel.appendChild(opt);
      });
    } catch {}
  }

  document.getElementById('cmp-op').addEventListener('change', cargarGrupos);
  await cargarGrupos();

  document.getElementById('cmp-buscar').addEventListener('click', buscarComparativo);
  document.getElementById('cmp-sems').addEventListener('change', buscarComparativo);
  document.getElementById('cmp-vista').addEventListener('change', buscarComparativo);

  async function buscarComparativo() {
    const op     = document.getElementById('cmp-op').value;
    const grupo  = document.getElementById('cmp-grupo').value;
    const sems   = document.getElementById('cmp-sems').value;
    const vista  = document.getElementById('cmp-vista').value;
    const res    = document.getElementById('cmp-result');
    res.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
    try {
      if (vista === 'resumen') {
        const data = await GET(`/comparativo/resumen?operacion=${op}&grupoCompra=${encodeURIComponent(grupo)}&semanas=${sems}`);
        renderResumen(res, data, op, sems);
      } else {
        const data = await GET(`/comparativo/evolucion?operacion=${op}&grupoCompra=${encodeURIComponent(grupo)}&semanas=${sems}`);
        renderEvolucion(res, data, op);
      }
    } catch (err) {
      res.innerHTML = `<div class="msg-error">${err.message}</div>`;
    }
  }

  // ── Render resumen por ítem ──────────────────────────────────────
  function pctColor(pct) {
    if (pct == null) return '#9ca3af';
    if (pct >= 90 && pct <= 110) return '#10b981';
    if (pct >= 70 && pct <= 130) return '#f59e0b';
    return '#ef4444';
  }
  function pctBadge(pct) {
    if (pct == null) return '<span style="color:#9ca3af">—</span>';
    const color = pctColor(pct);
    return `<span style="background:${color}22;color:${color};padding:2px 8px;border-radius:10px;font-weight:600;font-size:11px">${pct.toFixed(1)}%</span>`;
  }

  // sems puede ser número (últimas N semanas) o string (label de semana en drill-down)
  function renderResumen(container, data, op, sems, semLabel) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos para ${op}${semLabel ? ` — ${semLabel}` : ` en las últimas ${sems} semanas`}.</p></div>`;
      return;
    }

    // ── Estado de ordenamiento ──────────────────────────────────────
    let sortKey = 'impOCTotal', sortDir = -1; // por defecto: Importe OC desc

    // ── KPIs ────────────────────────────────────────────────────────
    const totReal   = data.reduce((s,r) => s + r.importeReal, 0);
    const totOC     = data.reduce((s,r) => s + r.impOCTotal, 0);
    const pctGlobal = totOC > 0 ? (totReal / totOC * 100) : null;
    const enRango   = data.filter(r => r.pctCumplimiento != null && r.pctCumplimiento >= 90 && r.pctCumplimiento <= 110).length;
    const leve      = data.filter(r => r.pctCumplimiento != null && ((r.pctCumplimiento >= 70 && r.pctCumplimiento < 90) || (r.pctCumplimiento > 110 && r.pctCumplimiento <= 130))).length;
    const critico   = data.filter(r => r.pctCumplimiento != null && (r.pctCumplimiento < 70 || r.pctCumplimiento > 130)).length;

    container.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">
        <div class="card" style="padding:12px;text-align:center">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Cumplimiento global</div>
          <div style="font-size:22px;font-weight:700;color:${pctColor(pctGlobal)}">${pctGlobal != null ? pctGlobal.toFixed(1)+'%' : '—'}</div>
        </div>
        <div class="card" style="padding:12px;text-align:center">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Importe OC</div>
          <div style="font-size:18px;font-weight:700">${fmtMoney(totOC)}</div>
        </div>
        <div class="card" style="padding:12px;text-align:center">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Importe Real</div>
          <div style="font-size:18px;font-weight:700">${fmtMoney(totReal)}</div>
        </div>
        <div class="card" style="padding:12px;text-align:center">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Diferencia</div>
          <div style="font-size:18px;font-weight:700;color:${totReal-totOC >= 0 ? '#10b981' : '#ef4444'}">${fmtMoney(totReal - totOC)}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Items por eficiencia</div>
          <div style="font-size:12px;display:flex;flex-direction:column;gap:3px">
            <span style="color:#10b981">● En rango: <strong>${enRango}</strong></span>
            <span style="color:#f59e0b">● Desviación leve: <strong>${leve}</strong></span>
            <span style="color:#ef4444">● Crítico: <strong>${critico}</strong></span>
          </div>
        </div>
      </div>
      <!-- Tabla -->
      <div class="card">
        <div style="padding:12px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <span>${data.length} ítems${semLabel ? ` — ${semLabel}` : ` — últimas ${sems} semanas`}</span>
          ${semLabel ? `<button class="btn btn-outline btn-sm" onclick="document.getElementById('cmp-buscar').click()">← Volver a evolución</button>` : ''}
        </div>
        <div style="overflow-x:auto">
          <table class="data-table" id="cmp-resumen-table">
            <thead id="cmp-resumen-head"></thead>
            <tbody id="cmp-resumen-body"></tbody>
          </table>
        </div>
      </div>`;

    // ── Columnas con sus claves de ordenamiento ─────────────────────
    const cols = [
      { label: 'Ítem',        key: 'item',            align: 'left'  },
      { label: 'Descripción', key: 'nombre',          align: 'left'  },
      { label: 'Grupo',       key: 'grupoCompra',     align: 'left'  },
      { label: 'Cant. OC',    key: 'ocTotal',         align: 'right' },
      { label: 'Cant. Real',  key: 'cantidadReal',    align: 'right' },
      { label: '% Cumpl.',    key: 'pctCumplimiento', align: 'right' },
      { label: 'Imp. OC',     key: 'impOCTotal',      align: 'right' },
      { label: 'Imp. Real',   key: 'importeReal',     align: 'right' },
      { label: 'Diferencia',  key: 'diferencia',      align: 'right' },
    ];

    function sortData(rows) {
      return [...rows].sort((a, b) => {
        let va = a[sortKey], vb = b[sortKey];
        if (va == null) va = sortDir === 1 ? Infinity : -Infinity;
        if (vb == null) vb = sortDir === 1 ? Infinity : -Infinity;
        if (typeof va === 'string') return sortDir * va.localeCompare(vb);
        return sortDir * (va - vb);
      });
    }

    function renderHead() {
      document.getElementById('cmp-resumen-head').innerHTML = `<tr>${cols.map(c => {
        const isActive = c.key === sortKey;
        const indicator = isActive ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
        const thAlign = c.align === 'right' ? 'text-align:right' : '';
        return `<th style="cursor:pointer;user-select:none;white-space:nowrap;${thAlign}"
                    onclick="cmpSortResumen('${c.key}')">${c.label}<span style="color:${isActive?'var(--primary)':'#9ca3af'};font-size:10px">${indicator || ' ⇅'}</span></th>`;
      }).join('')}</tr>`;
    }

    function renderBody() {
      document.getElementById('cmp-resumen-body').innerHTML = sortData(data).map(r => `
        <tr style="cursor:pointer" onclick="cmpVerEvolucion('${r.item}','${esc(r.nombre)}')">
          <td><code style="font-size:11px">${esc(r.item)}</code></td>
          <td style="font-size:12px">${esc(r.nombre)}</td>
          <td><span style="font-size:11px;background:var(--bg-secondary);padding:1px 6px;border-radius:4px">${esc(r.grupoCompra)}</span></td>
          <td class="text-right">${fmt(r.ocTotal, 1)}</td>
          <td class="text-right">${fmt(r.cantidadReal, 1)}</td>
          <td class="text-right">${pctBadge(r.pctCumplimiento)}</td>
          <td class="text-right text-muted">${fmtMoney(r.impOCTotal)}</td>
          <td class="text-right">${fmtMoney(r.importeReal)}</td>
          <td class="text-right" style="color:${r.diferencia >= 0 ? '#10b981' : '#ef4444'};font-weight:600">${fmtMoney(r.diferencia)}</td>
        </tr>`).join('');
    }

    renderHead();
    renderBody();

    // Función global para ordenar al hacer clic en columna
    window.cmpSortResumen = (key) => {
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = typeof data[0]?.[key] === 'string' ? 1 : -1; }
      renderHead();
      renderBody();
    };

    // Función global para drill-down ítem → evolución
    window.cmpVerEvolucion = async (item, nombre) => {
      const op   = document.getElementById('cmp-op').value;
      const sems = document.getElementById('cmp-sems').value;
      try {
        const d = await GET(`/comparativo/evolucion?operacion=${op}&item=${item}&semanas=${sems}`);
        renderEvolucion(container, d, op, nombre);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ── Render evolución semanal ─────────────────────────────────────
  function renderEvolucion(container, data, op, titulo) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos de evolución.</p></div>`;
      return;
    }
    const esItemDrill = !!titulo; // viene de drill-down de ítem
    container.innerHTML = `
      <div class="card">
        <div style="padding:12px 16px;font-weight:600;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <span>${esItemDrill ? `📈 Evolución: ${esc(titulo)}` : `📈 Evolución semanal — ${op}`}</span>
          ${esItemDrill ? `<button class="btn btn-outline btn-sm" onclick="document.getElementById('cmp-buscar').click()">← Volver</button>` : ''}
        </div>
        <div style="padding:8px 16px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          💡 Haz clic en una semana para ver el detalle de ítems
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Semana</th>
                <th class="text-right">Cant. OC</th>
                <th class="text-right">Cant. Real</th>
                <th class="text-right">% Cumpl.</th>
                <th class="text-right">Importe OC</th>
                <th class="text-right">Importe Real</th>
                <th class="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(r => `<tr style="cursor:pointer" onclick="cmpVerDetalleSemana(${r.añosem},'${esc(r.label)}')">
                <td><strong style="color:var(--primary)">${esc(r.label)}</strong></td>
                <td class="text-right">${fmt(r.cantidadOC, 1)}</td>
                <td class="text-right">${fmt(r.cantidadReal, 1)}</td>
                <td class="text-right">${pctBadge(r.pctCumplimiento)}</td>
                <td class="text-right text-muted">${fmtMoney(r.importeOC)}</td>
                <td class="text-right">${fmtMoney(r.importeReal)}</td>
                <td class="text-right" style="color:${(r.importeReal-r.importeOC)>=0?'#10b981':'#ef4444'};font-weight:600">${fmtMoney(r.importeReal - r.importeOC)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // Drill-down: detalle de ítems de una semana específica
    window.cmpVerDetalleSemana = async (añosem, label) => {
      const op    = document.getElementById('cmp-op').value;
      const grupo = document.getElementById('cmp-grupo').value;
      const res   = document.getElementById('cmp-result');
      res.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando detalle ${label}...</div>`;
      try {
        const items = await GET(`/comparativo/resumen?operacion=${op}&grupoCompra=${encodeURIComponent(grupo)}&añosem=${añosem}`);
        renderResumen(res, items, op, 1, label);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // Cargar al inicio
  await buscarComparativo();
}

// ─── View: Venta & TIP por Operación ─────────────────────────────
async function viewVentasTip(container) {
  let opsConDatos = [];
  try { opsConDatos = await GET('/ventas/operaciones'); } catch {}

  // ── Definición de métricas compartida ────────────────────────────
  const METRICAS = [
    { key: 'ventaNeta',   label: 'Venta Neta',        color: '#3b82f6', isPct: false },
    { key: 'ventaBruta',  label: 'Venta Bruta',        color: '#6366f1', isPct: false },
    { key: 'tipTotal',    label: 'TIP Total (Efe+TC)',  color: '#ef4444', isPct: false },
    { key: 'tipEfectivo', label: 'TIP Efectivo',        color: '#10b981', isPct: false },
    { key: 'tipTC',       label: 'TIP TC',              color: '#f59e0b', isPct: false },
    { key: 'pctTip',      label: '% TIP (TIP/V.Bruta)', color: '#8b5cf6', isPct: true  },
    { key: 'todos',       label: 'Ver todo',            color: '',        isPct: false }
  ];
  // Importes sin decimales para la vista de ventas; % con 1 decimal
  const fmtV = v => v == null ? '—' : 'S/ ' + Math.round(v).toLocaleString('es-CL');
  const fmtMetrica = (key, val) => {
    const m = METRICAS.find(m => m.key === key);
    if (!m || val == null) return '—';
    return m.isPct ? val.toFixed(1) + '%' : fmtV(val);
  };
  const addPct = row => ({
    ...row,
    pctTip: row.ventaBruta > 0 ? (row.tipTotal / row.ventaBruta * 100) : 0
  });

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🛒 Venta & TIP por Operación</div>
    </div>
    <div class="page-body">
      <div class="card mb-16" style="padding:16px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <!-- Tabs de vista -->
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Vista</label>
            <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
              <button id="vt-tab-evol" onclick="vtCambiarVista('evolucion')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--primary);color:#fff;font-weight:600">
                📈 Evolución
              </button>
              <button id="vt-tab-sede" onclick="vtCambiarVista('sede')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--bg-secondary);color:var(--text)">
                🏪 Por Sede
              </button>
            </div>
          </div>
          <!-- Granularidad: Semanal / Mensual -->
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Granularidad</label>
            <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
              <button id="vt-gran-sem" onclick="vtCambiarGran('semanal')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--primary);color:#fff;font-weight:600">
                Semanal
              </button>
              <button id="vt-gran-mes" onclick="vtCambiarGran('mensual')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--bg-secondary);color:var(--text)">
                Mensual
              </button>
            </div>
          </div>
          <!-- Operación: solo en evolución -->
          <div id="vt-op-wrap">
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
            <select id="vt-op" class="form-control" style="width:150px">
              <option value="">Todas</option>
              ${opsConDatos.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px" id="vt-periodo-label">Semanas</label>
            <select id="vt-sems" class="form-control" style="width:145px">
              <option value="8">8 sem (2 meses)</option>
              <option value="13" selected>13 sem (3 meses)</option>
              <option value="26">26 sem (6 meses)</option>
              <option value="52">52 sem (1 año)</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Métrica</label>
            <select id="vt-metrica" class="form-control" style="width:190px">
              ${METRICAS.map(m => `<option value="${m.key}"${m.key==='todos'?' selected':''}>${m.label}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="vt-buscar" style="align-self:flex-end">🔍 Buscar</button>
        </div>
      </div>
      <div id="vt-result"></div>
    </div>`;

  let vistaActual = 'evolucion';
  let granActual  = 'semanal';

  window.vtCambiarVista = (v) => {
    vistaActual = v;
    const isEvol = v === 'evolucion';
    document.getElementById('vt-tab-evol').style.background = isEvol ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('vt-tab-evol').style.color      = isEvol ? '#fff' : 'var(--text)';
    document.getElementById('vt-tab-sede').style.background = !isEvol ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('vt-tab-sede').style.color      = !isEvol ? '#fff' : 'var(--text)';
    document.getElementById('vt-op-wrap').style.display     = isEvol ? '' : 'none';
    buscarVentas();
  };

  window.vtCambiarGran = (g) => {
    granActual = g;
    const isSem = g === 'semanal';
    document.getElementById('vt-gran-sem').style.background = isSem ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('vt-gran-sem').style.color      = isSem ? '#fff' : 'var(--text)';
    document.getElementById('vt-gran-mes').style.background = !isSem ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('vt-gran-mes').style.color      = !isSem ? '#fff' : 'var(--text)';
    // Actualizar opciones del selector de período
    const sel = document.getElementById('vt-sems');
    const lbl = document.getElementById('vt-periodo-label');
    if (isSem) {
      lbl.textContent = 'Semanas';
      sel.innerHTML = `
        <option value="8">8 sem (2 meses)</option>
        <option value="13" selected>13 sem (3 meses)</option>
        <option value="26">26 sem (6 meses)</option>
        <option value="52">52 sem (1 año)</option>`;
    } else {
      lbl.textContent = 'Meses';
      sel.innerHTML = `
        <option value="3">3 meses</option>
        <option value="6">6 meses</option>
        <option value="12" selected>12 meses (1 año)</option>
        <option value="24">24 meses (2 años)</option>`;
    }
    buscarVentas();
  };

  document.getElementById('vt-buscar').addEventListener('click', buscarVentas);
  document.getElementById('vt-sems').addEventListener('change', buscarVentas);
  document.getElementById('vt-op').addEventListener('change', buscarVentas);
  document.getElementById('vt-metrica').addEventListener('change', buscarVentas);

  async function buscarVentas() {
    const op      = document.getElementById('vt-op').value;
    const n       = document.getElementById('vt-sems').value;
    const metrica = document.getElementById('vt-metrica').value;
    const res     = document.getElementById('vt-result');
    res.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
    try {
      if (granActual === 'semanal') {
        if (vistaActual === 'evolucion') {
          const data = (await GET(`/ventas/evolucion?operacion=${op}&semanas=${n}`)).map(addPct);
          renderEvolucion(res, data, metrica, op, 'semanal');
        } else {
          const data = await GET(`/ventas/por-sede?semanas=${n}`);
          renderPorSede(res, data, metrica, 'semanal');
        }
      } else {
        if (vistaActual === 'evolucion') {
          const data = (await GET(`/ventas/evolucion-mes?operacion=${op}&meses=${n}`)).map(addPct);
          renderEvolucion(res, data, metrica, op, 'mensual');
        } else {
          const data = await GET(`/ventas/por-sede-mes?meses=${n}`);
          renderPorSede(res, data, metrica, 'mensual');
        }
      }
    } catch (err) { res.innerHTML = `<div class="msg-error">${err.message}</div>`; }
  }

  // ── Render: Evolución (semanal o mensual) ────────────────────────
  function renderEvolucion(container, data, metrica, op, granularidad) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos disponibles.</p></div>`;
      return;
    }
    const esMensual  = granularidad === 'mensual';
    const nRef       = esMensual ? 3 : 4;                    // últ. 3 meses ó 4 semanas
    const periodKey  = esMensual ? 'añomes' : 'añosem';
    const periodoLbl = esMensual ? 'meses' : 'sem';

    const ult4  = data.slice(-nRef), ant4 = data.slice(-nRef * 2, -nRef);
    const sumV  = arr => arr.reduce((s,r) => s + r.ventaNeta,  0);
    const sumT  = arr => arr.reduce((s,r) => s + r.tipTotal,   0);
    const sumB  = arr => arr.reduce((s,r) => s + r.ventaBruta, 0);
    const vNeta = sumV(ult4), vAnt = sumV(ant4);
    const tTot  = sumT(ult4), tAnt = sumT(ant4);
    const bTot  = sumB(ult4);
    const pctV  = vAnt > 0 ? ((vNeta - vAnt) / vAnt * 100) : null;
    const pctT  = tAnt > 0 ? ((tTot  - tAnt) / tAnt * 100) : null;
    const arrow = v => v == null ? '' : (v >= 0
      ? `<span style="color:#10b981">▲ ${v.toFixed(1)}%</span>`
      : `<span style="color:#ef4444">▼ ${Math.abs(v).toFixed(1)}%</span>`);

    const COLS_TODAS = METRICAS.filter(m => m.key !== 'todos');
    const cols = metrica === 'todos' ? COLS_TODAS : COLS_TODAS.filter(m => m.key === metrica);

    let sortKey = periodKey, sortDir = -1;
    const maxVenta = Math.max(...data.map(r => r.ventaNeta), 1);
    const maxTip   = Math.max(...data.map(r => r.tipTotal),  1);
    const maxPct   = Math.max(...data.map(r => r.pctTip),    1);

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Venta Neta (últ. ${nRef} ${periodoLbl})</div>
          <div style="font-size:20px;font-weight:700">${fmtV(vNeta)}</div>
          <div style="font-size:12px;margin-top:4px">${arrow(pctV)} vs ${nRef} ${periodoLbl}. anteriores</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">TIP Total (últ. ${nRef} ${periodoLbl})</div>
          <div style="font-size:20px;font-weight:700">${fmtV(tTot)}</div>
          <div style="font-size:12px;margin-top:4px">${arrow(pctT)} vs ${nRef} ${periodoLbl}. anteriores</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">% TIP / V. Bruta (últ. ${nRef} ${periodoLbl})</div>
          <div style="font-size:20px;font-weight:700;color:#8b5cf6">
            ${bTot > 0 ? (tTot / bTot * 100).toFixed(1) + '%' : '—'}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Efe: ${fmtV(ult4.reduce((s,r)=>s+r.tipEfectivo,0))} / TC: ${fmtV(ult4.reduce((s,r)=>s+r.tipTC,0))}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${esMensual ? 'Meses' : 'Semanas'} con datos</div>
          <div style="font-size:20px;font-weight:700">${data.length}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${data[0]?.label} → ${data[data.length-1]?.label}</div>
        </div>
      </div>
      <div class="card">
        <div style="padding:10px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          ${op || 'Todas las operaciones'} — evolución ${esMensual ? 'mensual' : 'semanal'}
        </div>
        <div style="overflow-x:auto">
          <table class="data-table"><thead id="vt-head"></thead><tbody id="vt-body"></tbody></table>
        </div>
      </div>`;

    function sortData(rows) {
      return [...rows].sort((a,b) => {
        const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
        return typeof va === 'string' ? sortDir * va.localeCompare(vb) : sortDir * (va - vb);
      });
    }
    function renderHead() {
      const allCols = [{ key: periodKey, label: esMensual ? 'Mes' : 'Semana', align: 'left' }, ...cols.map(c => ({ ...c, align: 'right' }))];
      document.getElementById('vt-head').innerHTML = `<tr>${allCols.map(c => {
        const act = c.key === sortKey;
        return `<th style="cursor:pointer;user-select:none;${c.align==='right'?'text-align:right':''}" onclick="vtSort('${c.key}')">${c.label}<span style="color:${act?'var(--primary)':'#9ca3af'};font-size:10px">${act?(sortDir===1?' ▲':' ▼'):' ⇅'}</span></th>`;
      }).join('')}</tr>`;
    }
    function celdaBar(col, r) {
      const val = r[col.key] ?? 0;
      if (col.isPct) {
        const w = Math.max(2, Math.round(val / maxPct * 80));
        return `<td class="text-right" style="min-width:80px">
          <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
            <div style="flex:1;height:6px;background:#f3f4f6;border-radius:3px;max-width:60px">
              <div style="width:${w}%;height:100%;background:${col.color};border-radius:3px"></div>
            </div>
            <span style="font-size:12px;min-width:44px;text-align:right;color:${col.color};font-weight:600">${val.toFixed(1)}%</span>
          </div></td>`;
      }
      const maxRef = col.key.startsWith('tip') ? maxTip : maxVenta;
      const w = Math.max(2, Math.round(val / (maxRef || 1) * 80));
      return `<td class="text-right" style="min-width:90px">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
          <div style="flex:1;height:6px;background:#f3f4f6;border-radius:3px;max-width:60px">
            <div style="width:${w}%;height:100%;background:${col.color};border-radius:3px"></div>
          </div>
          <span style="font-size:12px;min-width:56px;text-align:right">${fmtV(val)}</span>
        </div></td>`;
    }
    function renderBody() {
      document.getElementById('vt-body').innerHTML = sortData(data).map(r =>
        `<tr><td><strong>${esc(r.label)}</strong></td>${cols.map(c => celdaBar(c, r)).join('')}</tr>`
      ).join('');
    }
    renderHead(); renderBody();
    window.vtSort = key => {
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
      renderHead(); renderBody();
    };
  }

  // ── Render: Por Sede (pivote expandible, semanal o mensual) ──────
  function renderPorSede(container, { semanas, sedes }, metrica, granularidad) {
    if (!sedes.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos disponibles.</p></div>`;
      return;
    }

    const DETALLE_KEYS = [
      { key: 'ventaBruta',  label: 'V. Bruta' },
      { key: 'ventaNeta',   label: 'V. Neta'  },
      { key: 'tipEfectivo', label: 'TIP Efe.' },
      { key: 'tipTC',       label: 'TIP TC'   },
      { key: 'tipTotal',    label: 'TIP Total' },
      { key: 'pctTip',      label: '% TIP'    }
    ];
    const expandidas = new Set();
    const mostrarPct = metrica === 'pctTip';

    const esMensual = granularidad === 'mensual';

    // Total por sede
    function totalSede(sede) {
      return semanas.reduce((acc, s) => {
        const d = sede.datos[s.id] || {};
        acc.ventaBruta  += d.ventaBruta  || 0;
        acc.ventaNeta   += d.ventaNeta   || 0;
        acc.tipEfectivo += d.tipEfectivo || 0;
        acc.tipTC       += d.tipTC       || 0;
        acc.tipTotal    += d.tipTotal    || 0;
        return acc;
      }, { ventaBruta:0, ventaNeta:0, tipEfectivo:0, tipTC:0, tipTotal:0, pctTip:0 });
    }

    function buildTable() {
      // Grand total por período y global
      const grandSem = semanas.map(s => {
        const vb  = sedes.reduce((a,sede) => a + (sede.datos[s.id]?.ventaBruta  || 0), 0);
        const tip = sedes.reduce((a,sede) => a + (sede.datos[s.id]?.tipTotal    || 0), 0);
        return { ...semanas, ventaBruta: vb, tipTotal: tip,
          pctTip: vb > 0 ? (tip/vb*100) : 0,
          ventaNeta:   sedes.reduce((a,sede) => a + (sede.datos[s.id]?.ventaNeta   || 0), 0),
          tipEfectivo: sedes.reduce((a,sede) => a + (sede.datos[s.id]?.tipEfectivo || 0), 0),
          tipTC:       sedes.reduce((a,sede) => a + (sede.datos[s.id]?.tipTC       || 0), 0)
        };
      });
      const grandTot = grandSem.reduce((acc,g) => {
        Object.keys(acc).forEach(k => { if(k !== 'pctTip') acc[k] += g[k] || 0; });
        return acc;
      }, { ventaBruta:0, ventaNeta:0, tipEfectivo:0, tipTC:0, tipTotal:0, pctTip:0 });
      grandTot.pctTip = grandTot.ventaBruta > 0 ? (grandTot.tipTotal / grandTot.ventaBruta * 100) : 0;

      const fmtCell = (key, val) => fmtMetrica(key === 'pctTip' ? 'pctTip' : (mostrarPct ? key : key), val);
      const mainKey = metrica === 'todos' ? 'ventaNeta' : metrica;
      const fmtMain = val => fmtMetrica(mainKey, val);

      const pctColor = v => v >= 5 ? '#10b981' : v >= 2 ? '#f59e0b' : '#ef4444';

      let rows = '';
      for (const sede of sedes) {
        const isExp = expandidas.has(sede.operacion);
        const tot = totalSede(sede);
        tot.pctTip = tot.ventaBruta > 0 ? (tot.tipTotal / tot.ventaBruta * 100) : 0;

        // Fila principal
        const celdas = semanas.map(s => {
          const d = sede.datos[s.id] || {};
          const v = d[mainKey] ?? 0;
          const color = mainKey === 'pctTip' ? pctColor(v) : 'inherit';
          return `<td class="text-right" style="font-size:12px;color:${color}">${fmtMain(v)}</td>`;
        }).join('');

        rows += `<tr style="cursor:pointer;background:var(--bg-secondary);font-weight:600" onclick="vtExpandSede('${sede.operacion}')">
          <td style="white-space:nowrap;padding:8px 12px">
            <span style="font-size:11px;margin-right:6px">${isExp ? '▼' : '▶'}</span>${esc(sede.operacion)}
          </td>
          ${celdas}
          <td class="text-right" style="font-weight:700">${fmtMain(tot[mainKey] ?? 0)}</td>
        </tr>`;

        // Filas de detalle expandido
        if (isExp) {
          for (const dk of DETALLE_KEYS) {
            const detCeldas = semanas.map(s => {
              const d = sede.datos[s.id] || {};
              const v = d[dk.key] ?? 0;
              const color = dk.key === 'pctTip' ? pctColor(v) : 'var(--text-muted)';
              return `<td class="text-right" style="font-size:11px;color:${color};background:#f9fafb">${fmtMetrica(dk.key === 'pctTip' ? 'pctTip' : dk.key, v)}</td>`;
            }).join('');
            const detTot = dk.key === 'pctTip'
              ? fmtMetrica('pctTip', tot.pctTip)
              : fmtMetrica(dk.key, tot[dk.key] ?? 0);
            rows += `<tr>
              <td style="font-size:11px;color:var(--text-muted);padding-left:28px;background:#f9fafb">${dk.label}</td>
              ${detCeldas}
              <td class="text-right" style="font-size:11px;color:var(--text-muted);background:#f9fafb">${detTot}</td>
            </tr>`;
          }
        }
      }

      // Fila de totales globales
      const grandCeldas = grandSem.map(g => {
        const v = g[mainKey] ?? 0;
        return `<td class="text-right" style="font-weight:700;font-size:12px">${fmtMain(v)}</td>`;
      }).join('');
      rows += `<tr style="border-top:2px solid var(--border);background:var(--bg-secondary)">
        <td style="font-weight:700;padding:8px 12px">TOTAL</td>
        ${grandCeldas}
        <td class="text-right" style="font-weight:700">${fmtMain(grandTot[mainKey] ?? 0)}</td>
      </tr>`;

      const metricaLabel = METRICAS.find(m => m.key === metrica)?.label || metrica;
      return `
        <div class="card">
          <div style="padding:10px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
            <span>Por Sede — ${metricaLabel} · ${semanas.length} ${esMensual ? 'meses' : 'semanas'} · <em style="font-size:11px">Clic en sede para expandir</em></span>
          </div>
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr>
                <th style="min-width:120px">Sede</th>
                ${semanas.map(s => `<th class="text-right" style="font-size:11px;white-space:nowrap">${s.label}</th>`).join('')}
                <th class="text-right">Total</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    container.innerHTML = buildTable();

    window.vtExpandSede = op => {
      if (expandidas.has(op)) expandidas.delete(op); else expandidas.add(op);
      container.innerHTML = buildTable();
    };
  }

  // Carga inicial
  await buscarVentas();
}

// ─── View: Bajas ──────────────────────────────────────────────────
async function viewBajas(container) {
  let opsConDatos = [];
  try { opsConDatos = await GET('/bajas/operaciones'); } catch {}

  const fmtImp  = v => v == null ? '—' : 'S/ ' + Math.round(v).toLocaleString('es-CL');
  const fmtCant = v => v == null ? '—' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const fmtPct  = v => v == null ? '—' : v.toFixed(1) + '%';
  const pctColor = v => v == null ? '' : v >= 10 ? '#ef4444' : v >= 5 ? '#f59e0b' : '#10b981';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🔻 Seguimiento de Bajas</div>
    </div>
    <div class="page-body">
      <div class="card mb-16" style="padding:16px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Vista</label>
            <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
              <button id="bj-tab-evol" onclick="bjCambiarVista('evolucion')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--primary);color:#fff;font-weight:600">
                📈 Evolución
              </button>
              <button id="bj-tab-item" onclick="bjCambiarVista('item')"
                style="padding:6px 14px;font-size:13px;border:none;cursor:pointer;background:var(--bg-secondary);color:var(--text)">
                📦 Por Ítem
              </button>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
            <select id="bj-op" class="form-control" style="width:150px">
              <option value="">Todas</option>
              ${opsConDatos.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Semanas</label>
            <select id="bj-sems" class="form-control" style="width:140px">
              <option value="8">8 sem (2 meses)</option>
              <option value="13" selected>13 sem (3 meses)</option>
              <option value="26">26 sem (6 meses)</option>
              <option value="52">52 sem (1 año)</option>
            </select>
          </div>
          <button class="btn btn-primary" id="bj-buscar" style="align-self:flex-end">🔍 Buscar</button>
        </div>
      </div>
      <div id="bj-result"></div>
    </div>`;

  let vistaActual = 'evolucion';

  window.bjCambiarVista = (v) => {
    vistaActual = v;
    const isEvol = v === 'evolucion';
    document.getElementById('bj-tab-evol').style.background = isEvol ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('bj-tab-evol').style.color      = isEvol ? '#fff' : 'var(--text)';
    document.getElementById('bj-tab-item').style.background = !isEvol ? 'var(--primary)' : 'var(--bg-secondary)';
    document.getElementById('bj-tab-item').style.color      = !isEvol ? '#fff' : 'var(--text)';
    buscarBajas();
  };

  document.getElementById('bj-buscar').addEventListener('click', buscarBajas);
  document.getElementById('bj-sems').addEventListener('change', buscarBajas);
  document.getElementById('bj-op').addEventListener('change', buscarBajas);

  async function buscarBajas() {
    const op   = document.getElementById('bj-op').value;
    const sems = document.getElementById('bj-sems').value;
    const res  = document.getElementById('bj-result');
    res.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
    try {
      if (vistaActual === 'evolucion') {
        const data = await GET(`/bajas/evolucion?operacion=${op}&semanas=${sems}`);
        renderBajasEvol(res, data, op);
      } else {
        const data = await GET(`/bajas/por-item?operacion=${op}&semanas=${sems}`);
        renderBajasItem(res, data, op, sems);
      }
    } catch (err) { res.innerHTML = `<div class="msg-error">${err.message}</div>`; }
  }

  // ── Render: Evolución semanal ─────────────────────────────────────
  function renderBajasEvol(container, data, op) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos disponibles.</p></div>`;
      return;
    }

    // KPIs sobre últimas 4 semanas
    const ult4   = data.slice(-4);
    const sumB   = arr => arr.reduce((s,r) => s + r.bajaImp,  0);
    const sumV   = arr => arr.reduce((s,r) => s + r.ventaImp, 0);
    const totB   = sumB(ult4), totV = sumV(ult4);
    const totAll = { b: sumB(data), v: sumV(data) };

    let sortKey = 'añosem', sortDir = -1;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Importe Bajas (últ. 4 sem)</div>
          <div style="font-size:20px;font-weight:700;color:#ef4444">${fmtImp(totB)}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Importe Ventas (últ. 4 sem)</div>
          <div style="font-size:20px;font-weight:700">${fmtImp(totV)}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">% Baja / Venta (últ. 4 sem)</div>
          <div style="font-size:20px;font-weight:700;color:${pctColor(totV>0?totB/totV*100:null)}">
            ${totV > 0 ? (totB/totV*100).toFixed(1)+'%' : '—'}
          </div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">% Baja / Venta (total período)</div>
          <div style="font-size:20px;font-weight:700;color:${pctColor(totAll.v>0?totAll.b/totAll.v*100:null)}">
            ${totAll.v > 0 ? (totAll.b/totAll.v*100).toFixed(1)+'%' : '—'}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${data.length} semanas con datos</div>
        </div>
      </div>
      <div class="card">
        <div style="padding:10px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          ${op || 'Todas las operaciones'} — evolución semanal de bajas vs ventas
        </div>
        <div style="overflow-x:auto">
          <table class="data-table"><thead id="bj-head"></thead><tbody id="bj-body"></tbody></table>
        </div>
      </div>`;

    const COLS = [
      { key: 'añosem',    label: 'Semana',       align: 'left'  },
      { key: 'bajaImp',   label: 'Imp. Baja',    align: 'right', fmt: fmtImp, color: '#ef4444' },
      { key: 'bajaCant',  label: 'Cant. Baja',   align: 'right', fmt: fmtCant },
      { key: 'ventaImp',  label: 'Imp. Venta',   align: 'right', fmt: fmtImp },
      { key: 'ventaCant', label: 'Cant. Venta',  align: 'right', fmt: fmtCant },
      { key: 'pctKpi',    label: '% Baja/Venta', align: 'right', fmt: fmtPct, isKpi: true },
    ];

    function sortData(rows) {
      return [...rows].sort((a,b) => {
        const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
        return sortDir * (va - vb);
      });
    }
    function renderHead() {
      document.getElementById('bj-head').innerHTML = `<tr>${COLS.map(c => {
        const act = c.key === sortKey;
        return `<th style="cursor:pointer;${c.align==='right'?'text-align:right':''}" onclick="bjSortEvol('${c.key}')">
          ${c.label}<span style="color:${act?'var(--primary)':'#9ca3af'};font-size:10px">${act?(sortDir===1?' ▲':' ▼'):' ⇅'}</span></th>`;
      }).join('')}</tr>`;
    }
    function renderBody() {
      document.getElementById('bj-body').innerHTML = sortData(data).map(r => {
        return `<tr>${COLS.map(c => {
          if (c.key === 'añosem') return `<td><strong>${esc(r.label)}</strong></td>`;
          const val = r[c.key];
          const color = c.isKpi ? pctColor(val) : (c.color || '');
          const txt   = c.fmt ? c.fmt(val) : (val ?? '—');
          return `<td class="text-right" style="color:${color}">${txt}</td>`;
        }).join('')}</tr>`;
      }).join('');
    }
    renderHead(); renderBody();
    window.bjSortEvol = key => {
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
      renderHead(); renderBody();
    };
  }

  // ── Render: Por Ítem ──────────────────────────────────────────────
  function renderBajasItem(container, data, op, sems) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos disponibles.</p></div>`;
      return;
    }

    const totB = data.reduce((s,r) => s + r.bajaImp,  0);
    const totV = data.reduce((s,r) => s + r.ventaImp, 0);
    const nConBaja = data.filter(r => r.bajaImp > 0).length;

    let sortKey = 'bajaImp', sortDir = -1;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Total Bajas (imp.)</div>
          <div style="font-size:20px;font-weight:700;color:#ef4444">${fmtImp(totB)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${nConBaja} ítems con baja</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Total Ventas (imp.)</div>
          <div style="font-size:20px;font-weight:700">${fmtImp(totV)}</div>
        </div>
        <div class="card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">% Baja / Venta global</div>
          <div style="font-size:20px;font-weight:700;color:${pctColor(totV>0?totB/totV*100:null)}">
            ${totV > 0 ? (totB/totV*100).toFixed(1)+'%' : '—'}
          </div>
        </div>
      </div>
      <div class="card">
        <div style="padding:10px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          ${op || 'Todas las operaciones'} — por ítem (últimas ${sems} semanas con datos)
        </div>
        <div style="overflow-x:auto">
          <table class="data-table"><thead id="bj-ihead"></thead><tbody id="bj-ibody"></tbody></table>
        </div>
      </div>`;

    const COLS = [
      { key: 'item',      label: 'Ítem',         align: 'left'  },
      { key: 'nombre',    label: 'Descripción',  align: 'left'  },
      { key: 'grupoCompra',label:'Grupo',        align: 'left'  },
      { key: 'bajaImp',   label: 'Imp. Baja',   align: 'right', fmt: fmtImp,  color: '#ef4444' },
      { key: 'bajaCant',  label: 'Cant. Baja',  align: 'right', fmt: fmtCant },
      { key: 'ventaImp',  label: 'Imp. Venta',  align: 'right', fmt: fmtImp  },
      { key: 'ventaCant', label: 'Cant. Venta', align: 'right', fmt: fmtCant },
      { key: 'pctKpi',    label: '% Baja/Venta',align: 'right', fmt: fmtPct, isKpi: true },
    ];

    function sortData(rows) {
      return [...rows].sort((a,b) => {
        const va = a[sortKey], vb = b[sortKey];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return typeof va === 'string'
          ? sortDir * va.localeCompare(vb)
          : sortDir * (va - vb);
      });
    }
    function renderHead() {
      document.getElementById('bj-ihead').innerHTML = `<tr>${COLS.map(c => {
        const act = c.key === sortKey;
        return `<th style="cursor:pointer;${c.align==='right'?'text-align:right':''}" onclick="bjSortItem('${c.key}')">
          ${c.label}<span style="color:${act?'var(--primary)':'#9ca3af'};font-size:10px">${act?(sortDir===1?' ▲':' ▼'):' ⇅'}</span></th>`;
      }).join('')}</tr>`;
    }
    function renderBody() {
      document.getElementById('bj-ibody').innerHTML = sortData(data).map(r => {
        return `<tr>${COLS.map(c => {
          if (c.key === 'item')       return `<td style="font-size:12px">${r.item}</td>`;
          if (c.key === 'nombre')     return `<td style="font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.nombre || '')}</td>`;
          if (c.key === 'grupoCompra')return `<td style="font-size:12px">${esc(r.grupoCompra || '')}</td>`;
          const val   = r[c.key];
          const color = c.isKpi ? pctColor(val) : (c.color && val > 0 ? c.color : '');
          const txt   = c.fmt ? c.fmt(val) : (val ?? '—');
          return `<td class="text-right" style="font-size:12px;${color?'color:'+color+';font-weight:600':''}">
            ${c.isKpi && val != null
              ? `<span style="background:${pctColor(val)}22;color:${pctColor(val)};padding:2px 6px;border-radius:4px;font-weight:700">${txt}</span>`
              : txt}
          </td>`;
        }).join('')}</tr>`;
      }).join('');
    }
    renderHead(); renderBody();
    window.bjSortItem = key => {
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
      renderHead(); renderBody();
    };
  }

  await buscarBajas();
}

// ─── View: Creación de Ítems ──────────────────────────────────────
async function viewItems(container) {
  const rol = S.user.itemsRol || (S.user.role === 'ADMIN' ? 'admin' : '');
  const canSol = ['solicitante','admin'].includes(rol) || S.user.role === 'ADMIN';
  const canVal = ['validador','admin'].includes(rol)    || S.user.role === 'ADMIN';
  const canReg = ['registrador','admin'].includes(rol)  || S.user.role === 'ADMIN';

  // Tabs visibles según itemsRol
  const TABS = [
    { id: 'catalogo',    label: '📋 Catálogo',       always: true },
    { id: 'solicitudes', label: '📝 Mis Solicitudes', roles: ['solicitante','admin'] },
    { id: 'validacion',  label: '✅ Validación',      roles: ['validador','admin'] },
    { id: 'registro',    label: '🏷️ Registro ERP',   roles: ['registrador','admin'] },
    { id: 'estado',      label: '📊 Estado',          always: true },
  ].filter(t => t.always || (t.roles && t.roles.includes(rol)));

  // Tab por defecto según rol
  const defaultTab = rol === 'validador' ? 'validacion'
                   : rol === 'registrador' ? 'registro'
                   : rol === 'solicitante' ? 'solicitudes' : 'catalogo';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">📦 Creación de Ítems</div>
    </div>
    <div class="page-body">
      <div class="tabs mb-0">
        ${TABS.map(t => `<button class="tab-btn${t.id===defaultTab?' active':''}" data-itab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="items-tab-content" class="mt-16"></div>
    </div>`;

  let refsCache = null;
  async function getRefs() {
    if (!refsCache) refsCache = await GET('/items-sol/refs');
    return refsCache;
  }

  // Helpers de referencia
  const refNombre = (refs, tipo, codigo) => {
    const arr = refs[tipo] || [];
    return (arr.find(r => r.codigo === String(codigo)))?.nombre || codigo || '—';
  };

  const fmtEstado = e => ({
    borrador:   '<span class="badge" style="background:#94a3b8">Borrador</span>',
    pendiente:  '<span class="badge" style="background:#f59e0b">Pendiente</span>',
    aprobado:   '<span class="badge" style="background:#22c55e">Aprobado</span>',
    rechazado:  '<span class="badge" style="background:#ef4444">Rechazado</span>',
    completado: '<span class="badge" style="background:#3b82f6">Completado</span>',
  }[e] || e);

  // ── Helpers de lookup por clave compuesta ────────────────────────
  const famNombre = (refs, linea, familia) =>
    refs.familia?.find(r => r.codigo === `${linea}_${familia}`)?.nombre || '—';
  const sfNombre = (refs, linea, familia, sf) =>
    refs.sub_familia?.find(r => r.codigo === `${linea}_${familia}_${sf}`)?.nombre || '—';

  // ── Tab: Catálogo ──────────────────────────────────────────────────
  async function renderCatalogo(el) {
    const refs  = await getRefs();
    const lineas = refs.linea       || [];
    const tipos  = refs.tipo_item   || [];

    el.innerHTML = `
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div style="flex:2;min-width:200px">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Buscar nombre</label>
            <input id="itc-q" class="form-control" placeholder="Escribe para buscar..."
                   oninput="clearTimeout(window._itcT);window._itcT=setTimeout(()=>itcBuscar(1),380)"
                   style="font-size:13px">
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Tipo</label>
            <select id="itc-tipo" class="form-control" onchange="itcBuscar(1)" style="width:150px;font-size:13px">
              <option value="">Todos</option>
              ${tipos.map(t=>`<option value="${t.codigo}">${t.nombre}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Línea</label>
            <select id="itc-linea" class="form-control" onchange="itcLinFiltro(this.value)" style="width:160px;font-size:13px">
              <option value="">Todas</option>
              ${lineas.map(l=>`<option value="${l.codigo}">${l.nombre}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Familia</label>
            <select id="itc-fam" class="form-control" onchange="itcFamFiltro(this.value)" style="width:160px;font-size:13px">
              <option value="">Todas</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sub-familia</label>
            <select id="itc-sf" class="form-control" onchange="itcBuscar(1)" style="width:160px;font-size:13px">
              <option value="">Todas</option>
            </select>
          </div>
          <button class="btn btn-outline btn-sm" onclick="itcLimpiar()">✕ Limpiar</button>
        </div>
      </div>
      ${canSol?`<div class="mb-16">
        <button class="btn btn-primary btn-sm" onclick="itcNuevaSolicitud()">➕ Nueva solicitud de ítem</button>
      </div>`:''}
      <div id="itc-result"></div>`;

    window.itcLinFiltro = async (linea) => {
      const fams = linea ? await GET(`/items-sol/refs/familias?linea=${linea}`) : [];
      const sel = document.getElementById('itc-fam');
      sel.innerHTML = '<option value="">Todas</option>' + fams.map(f=>`<option value="${f.codigo}">${f.nombre}</option>`).join('');
      document.getElementById('itc-sf').innerHTML = '<option value="">Todas</option>';
      itcBuscar(1);
    };
    window.itcFamFiltro = async (famCodigo) => {
      const linea = document.getElementById('itc-linea')?.value || '';
      const parts = famCodigo.split('_');
      const familia = parts[1] || '';
      const sfs = (linea && familia) ? await GET(`/items-sol/refs/sub-familias?linea=${linea}&familia=${familia}`) : [];
      const sel = document.getElementById('itc-sf');
      sel.innerHTML = '<option value="">Todas</option>' + sfs.map(s=>`<option value="${s.codigo}">${s.nombre}</option>`).join('');
      itcBuscar(1);
    };
    window.itcLimpiar = () => {
      ['itc-q','itc-tipo','itc-linea','itc-fam','itc-sf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      itcBuscar(1);
    };

    window.itcBuscar = async (page=1) => {
      const q       = document.getElementById('itc-q')?.value || '';
      const tipo    = document.getElementById('itc-tipo')?.value || '';
      const linea   = document.getElementById('itc-linea')?.value || '';
      const famCod  = document.getElementById('itc-fam')?.value || '';
      const sfCod   = document.getElementById('itc-sf')?.value || '';
      const res     = document.getElementById('itc-result');
      res.innerHTML = '<div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div>';
      try {
        const params = new URLSearchParams({ page });
        if (q)       params.set('q', q);
        if (tipo)    params.set('tipoItem', tipo);
        if (linea)   params.set('linea', linea);
        if (famCod)  params.set('familia', famCod.split('_')[1] || '');
        if (sfCod)   params.set('subFamilia', sfCod.split('_')[2] || '');
        const data  = await GET(`/items-sol/catalogo?${params}`);
        const rows  = data.items.map(it => `
          <tr>
            <td style="font-size:11px;color:var(--text-muted)">${it.item}</td>
            <td style="font-size:13px;font-weight:600;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(it.nombre||'')}">${esc(it.nombre||'')}</td>
            <td style="font-size:11px">${esc(refNombre(refs,'tipo_item',it.tipoItem))}</td>
            <td style="font-size:11px;color:var(--text-muted)">${esc(refNombre(refs,'linea',it.linea))}</td>
            <td style="font-size:11px;color:var(--text-muted)">${esc(famNombre(refs,it.linea,it.familia))}</td>
            <td style="font-size:11px;color:var(--text-muted)">${esc(sfNombre(refs,it.linea,it.familia,it.subFamilia))}</td>
            <td><span class="badge badge-outline" style="font-size:10px">${esc(it.unidad||'')}</span></td>
            ${canSol?`<td><button class="btn btn-sm btn-outline" style="font-size:11px" onclick="itcCopiar(${it.item})">📋 Copiar</button></td>`:'<td></td>'}
          </tr>`).join('');
        const pages = data.pages;
        const pag   = pages > 1 ? `<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          ${page>1?`<button class="btn btn-sm btn-outline" onclick="itcBuscar(${page-1})">‹</button>`:''}
          <span style="padding:6px 10px;font-size:12px;color:var(--text-muted)">${page}/${pages} · ${data.total.toLocaleString()} ítems</span>
          ${page<pages?`<button class="btn btn-sm btn-outline" onclick="itcBuscar(${page+1})">›</button>`:''}
        </div>` : '';
        res.innerHTML = `
          <div class="card" style="overflow:hidden">
            <div style="overflow-x:auto">
              <table class="data-table">
                <thead><tr><th style="font-size:11px">#</th><th>Nombre</th><th style="font-size:11px">Tipo</th>
                  <th style="font-size:11px">Línea</th><th style="font-size:11px">Familia</th>
                  <th style="font-size:11px">Sub-familia</th><th style="font-size:11px">Unidad</th><th></th></tr></thead>
                <tbody>${rows||'<tr><td colspan="8" class="text-center text-muted py-16">Sin resultados</td></tr>'}</tbody>
              </table>
            </div>
          </div>${pag}`;
      } catch(e){ res.innerHTML = `<div class="msg-error">${e.message}</div>`; }
    };
    itcBuscar(1);
  }

  // ── Tab: Mis Solicitudes ───────────────────────────────────────────
  async function renderSolicitudes(el) {
    const refs = await getRefs();
    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-16">
        <div class="section-title mb-0">Mis solicitudes de creación</div>
        <button class="btn btn-primary btn-sm" onclick="itcNuevaSolicitud()">➕ Nueva solicitud</button>
      </div>
      <div id="its-list"><div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div></div>`;
    await cargarListaSols('its-list', refs, 'solicitudes');
  }

  // ── Tab: Validación ────────────────────────────────────────────────
  async function renderValidacion(el) {
    const refs = await getRefs();
    el.innerHTML = `
      <div class="section-title mb-16">Solicitudes pendientes de validación</div>
      <div id="itv-list"><div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div></div>`;
    await cargarListaSols('itv-list', refs, 'validacion');
  }

  // ── Tab: Registro ERP ──────────────────────────────────────────────
  async function renderRegistro(el) {
    const refs = await getRefs();
    el.innerHTML = `
      <div class="section-title mb-16">Ítems aprobados para registrar en ERP</div>
      <div id="itr-list"><div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div></div>`;
    await cargarListaSols('itr-list', refs, 'registro');
  }

  // ── Tab: Estado general ────────────────────────────────────────────
  async function renderEstado(el) {
    const refs = await getRefs();
    el.innerHTML = `
      <div class="section-title mb-16">Estado de todas las solicitudes</div>
      <div id="ite-list"><div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div></div>`;
    await cargarListaSols('ite-list', refs, 'estado');
  }

  // ── Cargar lista de solicitudes ────────────────────────────────────
  async function cargarListaSols(containerId, refs, vista) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const sols = await GET('/items-sol');
      const filtrados = sols.filter(s => {
        if (vista === 'solicitudes') return s.creadoPor === S.user.username || rol === 'admin';
        if (vista === 'validacion') return s.estado === 'pendiente';
        if (vista === 'registro')   return s.estado === 'aprobado';
        return true; // estado: todos
      });

      if (!filtrados.length) {
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Sin solicitudes</p></div>';
        return;
      }
      el.innerHTML = `
        <div class="card" style="overflow:hidden">
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr>
                <th>#</th><th>Operación</th><th>Creado por</th><th>Fecha</th><th>Estado</th>
                <th class="text-center">Ítems</th><th class="text-center">ERP</th>
                <th class="text-center">Acción</th>
              </tr></thead>
              <tbody>
                ${filtrados.map(s => {
                  const nERP = s.items.filter(i => i.codigoErp).length;
                  return `<tr>
                    <td><code>#${s._id.slice(-6)}</code></td>
                    <td><span class="badge badge-outline" style="font-size:11px">${esc(s.operacion||'')}</span></td>
                    <td class="fw-semibold">${esc(s.creadoPor)}</td>
                    <td style="font-size:12px;color:var(--text-muted)">${s.creadoEn?.slice(0,10)||''}</td>
                    <td>${fmtEstado(s.estado)}</td>
                    <td class="text-center"><span class="badge badge-outline">${s.items.length}</span></td>
                    <td class="text-center">
                      ${s.items.length?`<span class="badge" style="background:${nERP===s.items.length?'#22c55e':'#94a3b8'}">${nERP}/${s.items.length}</span>`:'—'}
                    </td>
                    <td class="text-center">
                      <div style="display:flex;gap:4px;justify-content:center">
                        ${['borrador','pendiente','rechazado'].includes(s.estado)&&(s.creadoPor===S.user.username||rol==='admin')
                          ? `<button class="btn btn-sm btn-primary" onclick="itcEditarSolicitud('${s._id}')">✏️ Editar</button>
                             <button class="btn btn-sm btn-outline" style="color:#ef4444;border-color:#ef4444" onclick="itcEliminarSol('${s._id}')" title="Eliminar">🗑️</button>`
                          : `<button class="btn btn-sm ${s.estado==='pendiente'&&vista==='validacion'?'btn-primary':s.estado==='aprobado'&&vista==='registro'?'btn-primary':'btn-outline'}" onclick="itcAbrirSolicitud('${s._id}')">👁️ Ver</button>`
                        }
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch(e) { el.innerHTML = `<div class="msg-error">${e.message}</div>`; }
  }

  // ── Navegación entre tabs ──────────────────────────────────────────
  const tabContent = container.querySelector('#items-tab-content');
  const tabFns = { catalogo: renderCatalogo, solicitudes: renderSolicitudes,
                   validacion: renderValidacion, registro: renderRegistro, estado: renderEstado };

  async function switchTab(id) {
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.itab === id));
    tabContent.innerHTML = '<div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div>';
    await (tabFns[id]?.(tabContent) ?? Promise.resolve());
  }
  container.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.itab)));

  // ── Abrir solicitud (detalle) ──────────────────────────────────────
  window.itcAbrirSolicitud = async (id) => {
    const refs = await getRefs();
    const sol  = await GET(`/items-sol/${id}`);
    const editable = ['borrador','pendiente','rechazado'].includes(sol.estado) && (sol.creadoPor === S.user.username || rol === 'admin');
    const esVal    = canValidar({ role: S.user.role, itemsRol: rol }) && sol.estado === 'pendiente';
    const esReg    = canRegistrar({ role: S.user.role, itemsRol: rol }) && sol.estado === 'aprobado';

    const grpOpts = (refs.grupo_compra||[]).map(g =>
      `<option value="${g.codigo}">${g.codigo} — ${esc(g.nombre)}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:100%;max-width:900px;max-height:90vh;overflow-y:auto;padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <span style="font-weight:700;font-size:16px">Solicitud #${sol._id.slice(-6)}</span>
            <span style="margin-left:12px">${fmtEstado(sol.estado)}</span>
            <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${sol.creadoPor}</span>
          </div>
          <button style="background:none;border:none;font-size:22px;cursor:pointer" id="its-close">✕</button>
        </div>
        ${sol.observacion?`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px">${esc(sol.observacion)}</div>`:''}
        ${sol.comentarioValidador?`<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px">
          <strong>${sol.validadoPor}</strong>: ${esc(sol.comentarioValidador)}</div>`:''}

        <div id="its-items-list">
          ${sol.items.map((it, idx) => `
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:10px">Ítem ${idx+1}: ${esc(it.nombre)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px">
              <div>
                <p style="color:var(--text-muted);font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:6px">Datos del solicitante</p>
                <table style="width:100%;border-collapse:collapse">
                  <tr><td style="color:var(--text-muted);padding:3px 8px 3px 0;width:40%">Tipo</td><td>${esc(refNombre(refs,'tipo_item',it.tipoItem))}</td></tr>
                  <tr><td style="color:var(--text-muted);padding:3px 8px 3px 0">Línea</td><td>${esc(refNombre(refs,'linea',it.linea))}</td></tr>
                  <tr><td style="color:var(--text-muted);padding:3px 8px 3px 0">Familia</td><td>${esc(refNombre(refs,'familia',it.familia))}</td></tr>
                  <tr><td style="color:var(--text-muted);padding:3px 8px 3px 0">Unidad</td><td>${esc(it.unidad||'—')}</td></tr>
                  ${it.itemOrigen?`<tr><td style="color:var(--text-muted);padding:3px 8px 3px 0">Copiado de</td><td>#${it.itemOrigen}</td></tr>`:''}
                </table>
              </div>
              <div>
                <p style="color:var(--text-muted);font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:6px">
                  ${esVal?'Validación':'Datos validados'}
                </p>
                ${esVal?`
                <input data-iid="${it._id}" data-f="nombreVal" placeholder="Nombre aprobado" value="${esc(it.nombreVal||it.nombre)}"
                       class="form-control mb-8" style="font-size:12px">
                <select data-iid="${it._id}" data-f="grupoCompra" class="form-control mb-8" style="font-size:12px">
                  <option value="">— Grupo Compra —</option>${grpOpts}
                </select>
                <select data-iid="${it._id}" data-f="unidadVal" class="form-control mb-8" style="font-size:12px">
                  <option value="">Unidad de medida</option>
                  ${(refsCache?.unidad||[]).map(u=>`<option value="${u.codigo}" ${(it.unidadVal||it.unidad)===u.codigo?'selected':''}>${u.codigo}</option>`).join('')}
                </select>
                <input data-iid="${it._id}" data-f="comentarioItem" placeholder="Comentario" value="${esc(it.comentarioItem||'')}"
                       class="form-control" style="font-size:12px">
                `:
                `<table style="width:100%;border-collapse:collapse">
                  <tr><td style="color:var(--text-muted);padding:3px 8px 3px 0;width:40%">Nombre</td><td>${esc(it.nombreVal||it.nombre)}</td></tr>
                  <tr><td style="color:var(--text-muted)">Grupo</td><td style="font-weight:600;color:#3b82f6">${esc(refNombre(refs,'grupo_compra',it.grupoCompra))}</td></tr>
                  <tr><td style="color:var(--text-muted)">Unidad</td><td>${esc(it.unidadVal||it.unidad||'—')}</td></tr>
                </table>`}
                ${esReg?`
                <div style="margin-top:10px">
                  <label style="font-size:12px;font-weight:600;margin-bottom:4px;display:block">Código ERP</label>
                  ${it.codigoErp
                    ?`<span class="badge" style="background:#22c55e;font-size:13px">✓ ${esc(it.codigoErp)}</span>`
                    :`<div style="display:flex;gap:6px">
                        <input id="erp-${it._id}" class="form-control" style="font-size:12px" placeholder="Código en ERP">
                        <button class="btn btn-primary btn-sm" onclick="itcRegistrar('${sol._id}','${it._id}')">Registrar</button>
                      </div>`}
                </div>`:''}
              </div>
            </div>
          </div>`).join('')}
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          ${editable?`
          <button class="btn btn-primary btn-sm" onclick="itcEnviar('${sol._id}')">📤 Enviar para validación</button>
          <button class="btn btn-outline btn-sm" onclick="overlay.remove()">Cancelar</button>`:''}
          ${esVal?`
          <div style="flex:1">
            <input id="val-comment" class="form-control mb-8" placeholder="Comentario del validador (opcional)" style="font-size:13px">
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="itcValidar('${sol._id}','aprobar')">✅ Aprobar</button>
              <button class="btn btn-sm" style="background:#ef4444;color:#fff" onclick="itcValidar('${sol._id}','rechazar')">❌ Rechazar</button>
            </div>
          </div>`:''}
          ${!editable&&!esVal&&!esReg?`<button class="btn btn-outline btn-sm" onclick="overlay.remove()">Cerrar</button>`:''}
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#its-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Pre-seleccionar grupoCompra en selects de validación
    if (esVal) {
      sol.items.forEach(it => {
        const sel = overlay.querySelector(`select[data-iid="${it._id}"][data-f="grupoCompra"]`);
        if (sel && it.grupoCompra) sel.value = String(it.grupoCompra);
      });
    }
  };

  // ── Acciones ───────────────────────────────────────────────────────
  window.itcEnviar = async (id) => {
    try {
      await POST(`/items-sol/${id}/enviar`, {});
      toast('Solicitud enviada para validación', 'success');
      document.querySelector('[style*="position:fixed"]')?.remove();
      await switchTab('solicitudes');
    } catch(e){ toast(e.message, 'error'); }
  };

  window.itcValidar = async (id, accion) => {
    const overlay = document.querySelector('[style*="position:fixed"]');
    const comentario = document.getElementById('val-comment')?.value || '';
    // Recoger datos editados de cada ítem
    const items = [...overlay.querySelectorAll('[data-iid]')].reduce((acc, el) => {
      const iid = el.dataset.iid; const f = el.dataset.f;
      if (!iid || !f) return acc;
      const obj = acc.find(o => o._id === iid) || { _id: iid };
      if (!acc.includes(obj)) acc.push(obj);
      obj[f] = el.tagName === 'SELECT' ? (el.value ? Number(el.value)||el.value : null) : el.value;
      return acc;
    }, []);
    try {
      await PUT(`/items-sol/${id}/validar`, { accion, comentarioValidador: comentario, items });
      toast(`Solicitud ${accion==='aprobar'?'aprobada':'rechazada'}`, accion==='aprobar'?'success':'error');
      overlay?.remove();
      await switchTab('validacion');
    } catch(e){ toast(e.message, 'error'); }
  };

  window.itcRegistrar = async (sid, iid) => {
    const codigo = document.getElementById(`erp-${iid}`)?.value?.trim();
    if (!codigo) { toast('Ingresa el código ERP', 'error'); return; }
    try {
      await PUT(`/items-sol/${sid}/items/${iid}/registrar`, { codigoErp: codigo });
      toast('Ítem registrado en ERP', 'success');
      document.querySelector('[style*="position:fixed"]')?.remove();
      await switchTab('registro');
    } catch(e){ toast(e.message, 'error'); }
  };

  // ── Editar solicitud existente ─────────────────────────────────────
  window.itcEditarSolicitud = async (id) => {
    const sol = await GET(`/items-sol/${id}`);
    await itcNuevaSolicitud(sol.items || [], { solicitudId: id, observacion: sol.observacion, operacion: sol.operacion });
  };

  // ── Nueva / Editar solicitud (modal multi-ítem) ────────────────────
  window.itcNuevaSolicitud = async (initialItems = [], opciones = {}) => {
    const { solicitudId = null, observacion: obsInicial = '', operacion: opInicial = '' } = opciones;
    const modoEdicion = !!solicitudId;
    const refs  = await getRefs();
    const lineas = refs.linea     || [];
    const tipos  = refs.tipo_item || [];
    // Operaciones disponibles para el usuario
    const misOps = S.user.role === 'ADMIN' || S.user.itemsRol === 'admin'
      ? ALL_OPS
      : (S.user.operations || []);
    // Siempre mostrar al menos un ítem vacío
    let itemsLocales = initialItems.length ? [...initialItems] : [{}];
    let operacionSel = opInicial || (misOps.length === 1 ? misOps[0] : '');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

    const buildModal = () => {
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:100%;max-width:720px;max-height:90vh;overflow-y:auto;padding:24px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <span style="font-weight:700;font-size:16px">📦 ${modoEdicion ? 'Editar solicitud' : 'Nueva solicitud de ítem'}</span>
            <button id="ns-close" style="background:none;border:none;font-size:22px;cursor:pointer">✕</button>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:16px">
            <div style="flex:1">
              <label style="font-size:12px;font-weight:600;margin-bottom:4px;display:block">Operación <span style="color:red">*</span></label>
              <select id="ns-op" class="form-control" style="font-size:13px" onchange="operacionSel=this.value" ${modoEdicion?'disabled':''}>
                ${misOps.length > 1 && !modoEdicion ? '<option value="">— Seleccionar operación —</option>' : ''}
                ${modoEdicion
                  ? `<option value="${operacionSel}" selected>${operacionSel}</option>`
                  : misOps.map(op=>`<option value="${op}" ${operacionSel===op?'selected':''}>${op}</option>`).join('')}
              </select>
            </div>
            <div style="flex:2">
              <label style="font-size:12px;font-weight:600;margin-bottom:4px;display:block">Observación general</label>
              <input id="ns-obs" class="form-control" placeholder="Opcional" value="${esc(obsInicial)}" style="font-size:13px">
            </div>
          </div>

          ${itemsLocales.map((it,i)=>`
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:12px;font-weight:600;color:var(--text-muted)">ÍTEM ${i+1}${it.itemOrigen?` · Copia de #${it.itemOrigen}`:''}</span>
              <button onclick="itcQuitarItem(${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:18px">×</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
              <div style="grid-column:1/-1"><input class="form-control ns-nombre" data-idx="${i}" style="font-size:12px" placeholder="Nombre *" value="${esc(it.nombre||'')}"
                oninput="itemsLocales[${i}].nombre=this.value"></div>
              <select class="form-control" style="font-size:12px" onchange="itemsLocales[${i}].tipoItem=this.value">
                <option value="">Tipo ítem</option>
                ${tipos.map(t=>`<option value="${t.codigo}" ${it.tipoItem===t.codigo?'selected':''}>${t.nombre}</option>`).join('')}
              </select>
              <select class="form-control" style="font-size:12px" onchange="itemsLocales[${i}].unidad=this.value">
                <option value="">Unidad de medida</option>
                ${(refs.unidad||[]).map(u=>`<option value="${u.codigo}" ${it.unidad===u.codigo?'selected':''}>${u.codigo}</option>`).join('')}
              </select>
              <select class="form-control" style="font-size:12px" onchange="itcLineaChange(this,${i})">
                <option value="">Línea</option>
                ${lineas.map(l=>`<option value="${l.codigo}" ${String(it.linea)===l.codigo?'selected':''}>${l.nombre}</option>`).join('')}
              </select>
              <select id="ns-fam-${i}" class="form-control" style="font-size:12px" onchange="itcFamChange(this,${i})">
                <option value="">Familia</option>
                ${it.familia?`<option value="${it.familia}" selected>${famNombre(refs,it.linea,it.familia)}</option>`:''}
              </select>
              <select id="ns-sf-${i}" class="form-control" style="font-size:12px" onchange="itemsLocales[${i}].subFamilia=this.value?parseInt(this.value):null">
                <option value="">Sub-familia</option>
                ${it.subFamilia?`<option value="${it.subFamilia}" selected>${sfNombre(refs,it.linea,it.familia,it.subFamilia)}</option>`:''}
              </select>
              <div style="grid-column:1/-1"><input class="form-control" style="font-size:12px" placeholder="Observación del ítem" value="${esc(it.observacion||'')}"
                onchange="itemsLocales[${i}].observacion=this.value"></div>
            </div>
          </div>`).join('')}

          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" onclick="itcAgregarItem()">➕ Agregar otro ítem</button>
          </div>

          <div style="display:flex;gap:10px;margin-top:20px">
            <button class="btn btn-primary btn-sm" onclick="itcGuardarSolicitud()">
              ${modoEdicion ? '💾 Guardar cambios' : '✅ Crear solicitud'}
            </button>
            <button class="btn btn-outline btn-sm" id="ns-close2">Cancelar</button>
          </div>
        </div>`;

      overlay.querySelectorAll('#ns-close,#ns-close2').forEach(b => b.addEventListener('click', () => overlay.remove()));
    };

    window.itcQuitarItem = (i) => { itemsLocales.splice(i,1); buildModal(); };
    window.itcAgregarItem = () => { itemsLocales.push({}); buildModal(); };
    window.itcLineaChange = async (sel, idx) => {
      itemsLocales[idx].linea = sel.value ? parseInt(sel.value) : null;
      itemsLocales[idx].familia = null; itemsLocales[idx].subFamilia = null;
      const fams = sel.value ? await GET(`/items-sol/refs/familias?linea=${sel.value}`) : [];
      const famSel = document.getElementById(`ns-fam-${idx}`);
      const sfSel  = document.getElementById(`ns-sf-${idx}`);
      if (famSel) famSel.innerHTML = '<option value="">Familia</option>' + fams.map(f=>`<option value="${f.codigo.split('_')[1]}">${f.nombre}</option>`).join('');
      if (sfSel)  sfSel.innerHTML  = '<option value="">Sub-familia</option>';
    };
    window.itcFamChange = async (sel, idx) => {
      itemsLocales[idx].familia = sel.value ? parseInt(sel.value) : null;
      itemsLocales[idx].subFamilia = null;
      const linea = itemsLocales[idx].linea;
      const sfs = (linea && sel.value) ? await GET(`/items-sol/refs/sub-familias?linea=${linea}&familia=${sel.value}`) : [];
      const sfSel = document.getElementById(`ns-sf-${idx}`);
      if (sfSel) sfSel.innerHTML = '<option value="">Sub-familia</option>' + sfs.map(s=>`<option value="${s.codigo.split('_')[2]}">${s.nombre}</option>`).join('');
    };
    window.itcAbrirBuscadorCopia = () => {
      overlay.remove();
      switchTab('catalogo');
    };

    window.itcGuardarSolicitud = async () => {
      const operacion = operacionSel || document.getElementById('ns-op')?.value;
      const obs       = document.getElementById('ns-obs')?.value || '';
      if (!operacion) { toast('Selecciona la operación', 'error'); return; }
      // Sincronizar nombres desde el DOM por si el campo no perdió el foco
      overlay.querySelectorAll('.ns-nombre').forEach(inp => {
        const idx = parseInt(inp.dataset.idx);
        if (!isNaN(idx) && itemsLocales[idx] !== undefined) itemsLocales[idx].nombre = inp.value.trim();
      });
      const validos = itemsLocales.filter(it => it.nombre?.trim());
      if (!validos.length) { toast('Agrega al menos un ítem con nombre', 'error'); return; }
      try {
        if (modoEdicion) {
          await PUT(`/items-sol/${solicitudId}`, { observacion: obs, items: validos });
          toast('Solicitud actualizada', 'success');
        } else {
          await POST('/items-sol', { operacion, observacion: obs, items: validos });
          toast('Solicitud creada', 'success');
        }
        overlay.remove();
        await switchTab('solicitudes');
      } catch(e){ toast(e.message, 'error'); }
    };

    buildModal();
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  };

  // Copiar desde catálogo → abre modal con ítem pre-cargado
  window.itcCopiar = async (itemId) => {
    const it = await GET(`/items-sol/catalogo/${itemId}`);
    await itcNuevaSolicitud([{
      nombre:     it.nombre,
      tipoItem:   it.tipoItem,
      linea:      it.linea,
      familia:    it.familia,
      subFamilia: it.subFamilia,
      unidad:     it.unidad,
      itemOrigen: it.item,
    }]);
  };

  window.itcEliminarSol = async (id) => {
    if (!confirm('¿Eliminar esta solicitud? Esta acción no se puede deshacer.')) return;
    try {
      await DEL(`/items-sol/${id}`);
      toast('Solicitud eliminada', 'success');
      await switchTab(vistaActual);
    } catch(e) { toast(e.message, 'error'); }
  };

  // Carga inicial
  await switchTab(defaultTab);
}

// ─── Gestión de Pagos: Adelantos pendientes de rendición ──────────
let _pgAdelantosCache  = {};   // compania -> resumen por proveedor
let _pgAdelantosActual = {};   // resumen de la última compañía consultada (para el modal de detalle)

async function pgAdelantosResumen(compania) {
  if (!compania) return {};
  if (!_pgAdelantosCache[compania]) {
    _pgAdelantosCache[compania] = await GET(`/pagos/adelantos/resumen?compania=${encodeURIComponent(compania)}`);
  }
  _pgAdelantosActual = _pgAdelantosCache[compania];
  return _pgAdelantosCache[compania];
}

function pgFmtMonto(v) {
  return Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Badge con el total de adelantos sin rendir del proveedor (S/ y n° de documentos)
function pgAdelantoBadgeHtml(pagarA) {
  const info = (_pgAdelantosActual || {})[(pagarA || '').trim().toUpperCase()];
  if (!info || !info.numDocs) return '';
  const usd = info.totalUsd ? ` <span style="color:#2563eb">+US$ ${pgFmtMonto(info.totalUsd)}</span>` : '';
  return ` <span class="badge" data-pa="${esc(pagarA)}" style="background:#fef3c7;color:#92400e;cursor:pointer;font-size:10px;white-space:nowrap"
            onclick="event.stopPropagation();pgVerAdelantos(this.dataset.pa)"
            title="Click para ver detalle de adelantos sin rendir">⚠ S/ ${pgFmtMonto(info.totalSol)} · ${info.numDocs} doc${info.numDocs > 1 ? 's' : ''}${usd}</span>`;
}

// Resalte de fila para proveedores con adelantos sin rendir
function pgAdelantoRowStyle(pagarA) {
  const info = (_pgAdelantosActual || {})[(pagarA || '').trim().toUpperCase()];
  return info && info.numDocs ? 'box-shadow:inset 3px 0 0 #f59e0b;' : '';
}

// Modal de detalle de adelantos sin rendir de un proveedor
window.pgVerAdelantos = (pagarA) => {
  const info = (_pgAdelantosActual || {})[(pagarA || '').trim().toUpperCase()];
  if (!info) return;
  const fmtF = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const rows = info.items.map(it => `
    <tr>
      <td>${esc(it.numeroAdelanto)}</td>
      <td>${fmtF(it.fechaDocumento)}</td>
      <td class="text-right">${pgFmtMonto(it.montoTotal)}</td>
      <td class="text-right">${pgFmtMonto(it.saldoAdelanto)}</td>
      <td>${esc(it.moneda)}</td>
      <td>${esc(it.estado)}</td>
    </tr>`).join('');
  openModal(`Adelantos sin rendir — ${esc(pagarA)}`, `
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>N° Adelanto</th><th>Fecha</th><th class="text-right">Monto Total</th><th class="text-right">Saldo</th><th>Mon.</th><th>Estado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
};

// Modal con la relación completa de adelantos de la sociedad
window.pgVerRelacionAdelantos = async (compania, progId) => {
  if (!compania) { toast('Selecciona una sociedad', 'error'); return; }
  try {
    const rows = await GET(`/pagos/adelantos?compania=${encodeURIComponent(compania)}${progId ? `&progId=${progId}` : ''}`);
    if (!rows.length) { toast('Sin adelantos cargados para ' + compania, 'error'); return; }
    const trs = rows.map(r => `
      <tr style="${!r.tieneObligacion ? 'background:#fee2e2' : ''}">
        <td>${esc(r.proveedor)}</td>
        <td class="text-right">${pgFmtMonto(r.totalSol)}</td>
        <td class="text-right">${pgFmtMonto(r.totalUsd)}</td>
        <td class="text-center">${r.numDocs}</td>
        <td>${!r.tieneObligacion ? '<span class="badge" style="background:#fee2e2;color:#dc2626">Sin obligación por pagar</span>' : ''}</td>
      </tr>`).join('');
    openModal(`Relación de Adelantos — ${esc(compania)}`, `
      <div style="overflow-x:auto;max-height:60vh;overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Proveedor</th><th class="text-right">Total S/</th><th class="text-right">Total US$</th><th class="text-center">N° Docs</th><th>Obligación</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`);
  } catch (e) { toast(e.message, 'error'); }
};

// ─── Desglose de Recetas de Planta ───────────────────────────────
window.verDesgloseReceta = async function(item, cantidad) {
  const fmtN = v => v == null ? '—' : Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  openModal('🏭 Genera Adicional',
    `<div style="text-align:center;padding:32px"><span class="spinner spinner-dark"></span></div>`,
    null, { wide: true });

  try {
    const data = await GET(`/recetas/desglose?item=${encodeURIComponent(item)}&cantidad=${encodeURIComponent(cantidad)}`);

    if (data.sinReceta) {
      document.getElementById('modal-body').innerHTML =
        `<p class="text-muted" style="padding:16px">Sin receta registrada para el ítem <strong>${esc(String(item))}</strong>.</p>`;
      return;
    }

    function renderArbol(nodo, nivel) {
      nivel = nivel || 0;
      const isFinal = nodo.insumoFinal;
      const icon = isFinal ? '🔹' : '⚙️';
      let html = `<div style="margin-left:${nivel * 20}px;margin-bottom:5px${nivel > 0 ? ';border-left:2px solid #e5e7eb;padding-left:10px' : ''}">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
          <span>${icon}</span>
          <span style="font-weight:${nivel === 0 ? 700 : 500};font-size:${nivel === 0 ? '14px' : '13px'}">${esc(nodo.descripcion || String(nodo.item))}</span>
          <span style="font-family:monospace;font-size:11px;color:#6b7280">${nodo.item}</span>
          <span style="font-size:12px;color:#374151">× <strong>${fmtN(nodo.cantPedida)}</strong>${nodo.unidad ? ' ' + esc(nodo.unidad) : ''}</span>
          ${!isFinal ? `<span style="font-size:11px;color:#9ca3af">(batch ${nodo.batch} → ${nodo.batchesNecesarios} corrida${nodo.batchesNecesarios !== 1 ? 's' : ''} → produce ${fmtN(nodo.cantidadProducida)})</span>` : ''}
        </div>`;
      for (const sub of (nodo.subProductos || [])) html += renderArbol(sub, nivel + 1);
      for (const ins of (nodo.insumosDirectos || [])) {
        html += renderArbol({ item: ins.item, descripcion: ins.descripcion, unidad: ins.unidad, cantPedida: ins.cantidad, insumoFinal: true }, nivel + 1);
      }
      html += '</div>';
      return html;
    }

    const resumenRows = data.resumen.map(r => `<tr>
      <td style="font-family:monospace;font-size:12px">${esc(String(r.item))}</td>
      <td style="font-size:13px">${esc(r.descripcion)}</td>
      <td style="font-size:12px">${esc(r.unidad || '')}</td>
      <td style="font-size:12px;color:#6b7280">${esc(r.areaDescarga || '')}</td>
      <td style="text-align:right;font-weight:600">${fmtN(r.cantidad)}</td>
    </tr>`).join('');

    const arbol = data.arbol;
    _dglsResumen = data.resumen; // para generarSolicitudDesdeDesglose
    document.getElementById('modal-body').innerHTML = `
      <div style="margin-bottom:10px;font-size:13px">
        <strong>${esc(arbol.descripcion || String(item))}</strong>
        &nbsp;—&nbsp;cantidad solicitada: <strong>${fmtN(cantidad)}</strong>
      </div>
      <div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:12px">
        <button id="dgls-tab-arbol" onclick="document.getElementById('dgls-arbol').style.display='block';document.getElementById('dgls-resumen').style.display='none';document.getElementById('dgls-tab-arbol').style.borderBottom='2px solid #7c3aed';document.getElementById('dgls-tab-arbol').style.color='#7c3aed';document.getElementById('dgls-tab-res').style.borderBottom='none';document.getElementById('dgls-tab-res').style.color='#374151'"
          style="border:none;background:none;cursor:pointer;font-size:13px;padding:6px 14px;border-bottom:2px solid #7c3aed;color:#7c3aed;margin-bottom:-2px">🌳 Árbol</button>
        <button id="dgls-tab-res" onclick="document.getElementById('dgls-arbol').style.display='none';document.getElementById('dgls-resumen').style.display='block';document.getElementById('dgls-tab-res').style.borderBottom='2px solid #7c3aed';document.getElementById('dgls-tab-res').style.color='#7c3aed';document.getElementById('dgls-tab-arbol').style.borderBottom='none';document.getElementById('dgls-tab-arbol').style.color='#374151'"
          style="border:none;background:none;cursor:pointer;font-size:13px;padding:6px 14px;border-bottom:none;color:#374151;margin-bottom:-2px">📋 Resumen de insumos</button>
      </div>
      <div id="dgls-arbol" style="overflow:auto;max-height:420px;padding:10px;background:#f9fafb;border-radius:6px">
        ${renderArbol(arbol)}
      </div>
      <div id="dgls-resumen" style="display:none;overflow:auto;max-height:360px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f3f4f6;position:sticky;top:0">
            <th style="text-align:left;padding:6px 8px">Código</th>
            <th style="text-align:left;padding:6px 8px">Descripción</th>
            <th style="text-align:left;padding:6px 8px">Unidad</th>
            <th style="text-align:left;padding:6px 8px">Área Descarga</th>
            <th style="text-align:right;padding:6px 8px">Cantidad</th>
          </tr></thead>
          <tbody>${resumenRows}</tbody>
        </table>
      </div>
      <div style="margin-top:14px;text-align:right">
        <button onclick="generarSolicitudDesdeDesglose()" style="background:#059669;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;cursor:pointer;font-weight:600">📋 Generar Solicitud de Adicionales</button>
      </div>`;
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<p style="color:#dc2626;padding:16px">Error al cargar receta: ${esc(err.message)}</p>`;
  }
};

// ─── Solicitud de Adicionales desde Desglose ─────────────────────
let _dglsResumen   = [];  // insumos finales del desglose activo
let _dglsLineas    = [];  // filas del formulario de solicitud (consolidadas por ítem)
let _dglsCatalog   = {};  // item -> {saldo, costoUnitario, grupoCompra, nombre}
let _dglsPedidoMap = {};  // id -> pedido (para toggle de pendientes)
let _dglsContribs  = {};  // pedidoId -> [{item, cantidad}] para poder restar al desmarcar

const _dglsFmtN = v => v == null ? '' : Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function _dglsRenderTable() {
  const tbody = document.getElementById('dgls-sol-tbody');
  if (!tbody) return;
  const grandTotal = _dglsLineas.reduce((s, l) => s + (l.cantidadSolicitada||0)*(l.costoUnitario||0), 0);
  const totalEl = document.getElementById('dgls-pedido-total');
  if (totalEl) totalEl.textContent = 'S/ ' + _dglsFmtN(grandTotal);
  tbody.innerHTML = _dglsLineas.map((l, i) => {
    const costoTotal = (l.cantidadSolicitada || 0) * (l.costoUnitario || 0);
    const esNuevo = l.fuente === 'nuevo';
    const itemCell = esNuevo
      ? `<div style="position:relative">
           <input type="text" id="dgls-search-${i}" class="form-control" style="font-size:12px;padding:2px 6px"
                  value="${esc(l._searchText || '')}" placeholder="Buscar ítem..." autocomplete="off"
                  oninput="_dglsItemSearch(${i},this)">
           <div id="dgls-drop-${i}" style="display:none;position:fixed;z-index:2000;background:#fff;border:1px solid #d1d5db;border-radius:6px;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.15);min-width:280px"></div>
         </div>`
      : `<div style="font-size:11px;color:#6b7280;font-family:monospace;font-weight:600;line-height:1.2">${esc(String(l.item))}</div>
         <div style="font-weight:600;font-size:12px;line-height:1.3">${esc(l.descripcion)}</div>`;
    const C = 'padding:4px 5px;font-size:12px;text-align:center';
    return `<tr>
      <td style="padding:4px 5px;min-width:220px">${itemCell}</td>
      <td style="${C};color:#6b7280">${_dglsFmtN(l.saldo)}</td>
      <td style="${C};color:#6b7280">${_dglsFmtN(l.cantDesglose)}</td>
      <td style="padding:4px 5px;text-align:center">
        <input type="number" class="form-control" style="width:80px;text-align:center;font-size:12px;padding:2px 4px" value="${l.cantidadSolicitada ?? l.cantDesglose ?? 0}" step="any" oninput="_dglsSetField(${i},'cantidadSolicitada',+this.value||0)">
      </td>
      <td style="${C};color:#374151">${_dglsFmtN(l.costoUnitario || 0)}</td>
      <td id="dsl-ct-${i}" style="${C};font-weight:600">${_dglsFmtN(costoTotal)}</td>
      <td style="padding:4px 5px">
        <input type="text" class="form-control" style="width:120px;font-size:12px;padding:2px 4px" value="${esc(l.comentarios || '')}" oninput="_dglsSetField(${i},'comentarios',this.value)">
      </td>
      <td style="padding:4px 5px;text-align:center">
        <button onclick="_dglsRemoveLinea(${i})" style="border:none;background:none;color:#dc2626;cursor:pointer;font-size:15px;line-height:1">✕</button>
      </td>
    </tr>`;
  }).join('');
}

window._dglsSetField = function(i, field, val) {
  _dglsLineas[i][field] = val;
  if (['cantidadSolicitada', 'cantDesglose', 'costoUnitario'].includes(field)) {
    const l = _dglsLineas[i];
    const cEl = document.getElementById(`dsl-ct-${i}`);
    if (cEl) cEl.textContent = _dglsFmtN((l.cantidadSolicitada || 0) * (l.costoUnitario || 0));
    const grandTotal = _dglsLineas.reduce((s, l) => s + (l.cantidadSolicitada||0)*(l.costoUnitario||0), 0);
    const totalEl = document.getElementById('dgls-pedido-total');
    if (totalEl) totalEl.textContent = 'S/ ' + _dglsFmtN(grandTotal);
  }
};

window._dglsRemoveLinea = function(i) {
  _dglsLineas.splice(i, 1);
  _dglsRenderTable();
};

window._dglsSetZero = function(i) {
  _dglsLineas[i].ajuste = -(_dglsLineas[i].cantDesglose || 0);
  _dglsRenderTable();
};

window._dglsItemSearch = function(i, inp) {
  const q = (inp.value || '').trim().toLowerCase();
  const drop = document.getElementById(`dgls-drop-${i}`);
  if (!drop) return;
  if (!q) { drop.style.display = 'none'; return; }
  const enTabla = new Set(_dglsLineas.filter((l, idx) => idx !== i).map(l => String(l.item)));
  const matches = Object.values(_dglsCatalog)
    .filter(it => !enTabla.has(String(it.item)) && (String(it.item || '').includes(q) || (it.nombre || '').toLowerCase().includes(q)))
    .slice(0, 20);
  if (!matches.length) { drop.style.display = 'none'; return; }
  const rect = inp.getBoundingClientRect();
  drop.style.left  = `${rect.left}px`;
  drop.style.top   = `${rect.bottom + 2}px`;
  drop.style.width = `${Math.max(rect.width, 280)}px`;
  drop.style.display = 'block';
  drop.innerHTML = matches.map(it =>
    `<div onmousedown="_dglsSelectItem(${i},${it.item})"
          style="padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid #f3f4f6"
          onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
       <span style="font-family:monospace;color:#6b7280;font-size:11px">${esc(String(it.item))}</span>&nbsp;${esc(it.nombre || '')}
     </div>`
  ).join('');
};

window._dglsSelectItem = function(i, itemCode) {
  const it = _dglsCatalog[itemCode];
  if (!it) return;
  const yaExiste = _dglsLineas.some((l, idx) => idx !== i && l.item === it.item);
  if (yaExiste) {
    toast(`El ítem ${it.item} ya está en la tabla`, 'error');
    const drop = document.getElementById(`dgls-drop-${i}`);
    if (drop) drop.style.display = 'none';
    return;
  }
  _dglsLineas[i].item          = it.item;
  _dglsLineas[i].descripcion   = it.nombre || '';
  _dglsLineas[i].saldo         = it.saldo || 0;
  _dglsLineas[i].costoUnitario = it.costoUnitario || 0;
  _dglsLineas[i].grupoCompra   = it.grupoCompra || '';
  _dglsLineas[i]._searchText   = `${it.item} — ${it.nombre || ''}`;
  _dglsRenderTable();
};

window._dglsAddLinea = function() {
  _dglsLineas.push({ item: 0, descripcion: '', saldo: 0, cantDesglose: 0, cantidadSolicitada: 0, costoUnitario: 0, comentarios: '', gestion: 'PLANTA', grupoCompra: '', fuente: 'nuevo' });
  _dglsRenderTable();
  // scroll to bottom of table
  const tbody = document.getElementById('dgls-sol-tbody');
  if (tbody) tbody.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window._dglsTogglePedido = async function(pedidoId, checked) {
  const pedido = _dglsPedidoMap[pedidoId];
  if (!pedido) return;

  if (!checked) {
    // Restar contribuciones de este pedido y eliminar filas que queden en 0
    (_dglsContribs[pedidoId] || []).forEach(({ item, cantidad }) => {
      const idx = _dglsLineas.findIndex(x => x.item === item && x.fuente !== 'nuevo');
      if (idx < 0) return;
      _dglsLineas[idx].cantDesglose -= cantidad;
      if (_dglsLineas[idx].cantDesglose <= 0) {
        _dglsLineas.splice(idx, 1);
      } else {
        _dglsLineas[idx].cantidadSolicitada = _dglsLineas[idx].cantDesglose;
      }
    });
    delete _dglsContribs[pedidoId];
    _dglsRenderTable();
    return;
  }

  const chk = document.querySelector(`input[onchange*="${pedidoId}"]`);
  if (chk) chk.disabled = true;

  const contribs = [];
  const plLines = (pedido.lineas || []).filter(l => (l.gestion || 'COMPRAS') === 'PLANTA');

  for (const l of plLines) {
    try {
      const data = await GET(`/recetas/desglose?item=${encodeURIComponent(l.item)}&cantidad=${encodeURIComponent(l.cantidadSolicitada || 1)}`);
      const insumos = data.sinReceta
        ? [{ item: l.item, descripcion: l.itemNombre || String(l.item), cantidad: l.cantidadSolicitada || 0, areaDescarga: '' }]
        : data.resumen;

      for (const r of insumos) {
        contribs.push({ item: r.item, cantidad: r.cantidad });
        const idx = _dglsLineas.findIndex(x => x.item === r.item && x.fuente !== 'nuevo');
        if (idx >= 0) {
          _dglsLineas[idx].cantDesglose += r.cantidad;
          _dglsLineas[idx].cantidadSolicitada = _dglsLineas[idx].cantDesglose;
        } else {
          _dglsLineas.push({
            item:               r.item,
            descripcion:        r.descripcion || (_dglsCatalog[r.item]?.nombre || ''),
            saldo:              _dglsCatalog[r.item]?.saldo || 0,
            cantDesglose:       r.cantidad,
            cantidadSolicitada: r.cantidad,
            costoUnitario:      _dglsCatalog[r.item]?.costoUnitario || 0,
            comentarios:        '',
            gestion:            'PLANTA',
            grupoCompra:        r.areaDescarga || _dglsCatalog[r.item]?.grupoCompra || '',
            fuente:             'pedido',
          });
        }
      }
    } catch (err) {
      toast(`Error al expandir ítem ${l.item}: ${err.message}`, 'error');
    }
  }

  _dglsContribs[pedidoId] = contribs;
  if (chk) chk.disabled = false;
  _dglsRenderTable();
};

window.generarSolicitudDesdeDesglose = async function() {
  const userOps = S.user.role === 'ADMIN' ? ALL_OPS : (S.user.operations || []);
  const targetOp = userOps.find(op => op.includes('PLANTA'));
  if (!targetOp) { toast('No tienes asignada ninguna operación con PLANTA', 'error'); return; }

  openModal(`📋 Solicitud de Adicionales — ${targetOp}`,
    `<div style="text-align:center;padding:32px"><span class="spinner spinner-dark"></span></div>`,
    null, { fullwide: true });

  try {
    const [allPedidos, catalogItems] = await Promise.all([
      GET('/pedidos').catch(() => []),
      GET(`/datos/items?operacion=${encodeURIComponent(targetOp)}`).catch(() => []),
    ]);

    _dglsCatalog = {};
    catalogItems.forEach(it => { _dglsCatalog[it.item] = it; });

    // Pedidos con líneas PLANTA pendientes de atención (no de la propia operación destino)
    const pendingPedidos = allPedidos.filter(p =>
      ['SOLICITADO', 'APROBADO'].includes(p.estado) &&
      p.operacion !== targetOp &&
      (p.lineas || []).some(l => (l.gestion || 'COMPRAS') === 'PLANTA')
    );
    _dglsPedidoMap = {};
    pendingPedidos.forEach(p => { _dglsPedidoMap[p.id] = p; });

    // La tabla empieza vacía; se llena con los pedidos seleccionados o líneas manuales
    _dglsLineas = [];

    // Render modal
    const leftCol = pendingPedidos.length ? `
      <div style="width:270px;flex-shrink:0;display:flex;flex-direction:column">
        <div style="font-weight:600;font-size:11px;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Solicitudes pendientes</div>
        <div style="border:1px solid #e5e7eb;border-radius:6px;overflow-y:auto;flex:1">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#f3f4f6;position:sticky;top:0">
              <th style="padding:5px 6px;width:28px"></th>
              <th style="padding:5px 6px;text-align:center">Op.</th>
              <th style="padding:5px 6px;text-align:center">Fecha</th>
              <th style="padding:5px 6px;text-align:center">Estado</th>
              <th style="padding:5px 6px;text-align:center">Lín.</th>
            </tr></thead>
            <tbody>
              ${pendingPedidos.map(p => {
                const plCount = (p.lineas || []).filter(l => (l.gestion || 'COMPRAS') === 'PLANTA').length;
                return `<tr>
                  <td style="padding:5px 6px;text-align:center">
                    <input type="checkbox" onchange="_dglsTogglePedido('${p.id}',this.checked)" style="cursor:pointer">
                  </td>
                  <td style="padding:5px 6px;font-weight:600;text-align:center">${esc(p.operacion)}</td>
                  <td style="padding:5px 6px;text-align:center">${fmtDate(p.fechaPedido)}</td>
                  <td style="padding:5px 6px;text-align:center"><span class="badge badge-${(p.estado||'').toLowerCase()}">${p.estado}</span></td>
                  <td style="padding:5px 6px;text-align:center;font-weight:600">${plCount}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    document.getElementById('modal-body').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:13px;color:#374151">
        <div>Op: <strong style="color:#059669">${esc(targetOp)}</strong> &nbsp;·&nbsp; Fecha: <strong>${new Date().toISOString().split('T')[0]}</strong></div>
        <div style="font-size:13px">Total pedido:&nbsp;<strong id="dgls-pedido-total" style="color:#059669;font-size:15px">S/ 0.00</strong></div>
      </div>
      <div style="display:flex;gap:12px;align-items:stretch;min-height:360px">
        ${leftCol}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column">
          <div style="font-weight:600;font-size:11px;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Líneas del adicional</div>
          <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:auto;flex:1">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead><tr style="background:#f3f4f6;position:sticky;top:0">
                <th style="padding:5px 4px;text-align:left;min-width:220px">Ítem</th>
                <th style="padding:5px 4px;text-align:center;min-width:70px">Saldo</th>
                <th style="padding:5px 4px;text-align:center;min-width:80px">Cant. Calc.</th>
                <th style="padding:5px 4px;text-align:center;min-width:90px">Cant. Solicitada</th>
                <th style="padding:5px 4px;text-align:center;min-width:76px">Costo U.</th>
                <th style="padding:5px 4px;text-align:center;min-width:86px">Costo Total</th>
                <th style="padding:5px 4px;text-align:left;min-width:130px">Comentarios</th>
                <th style="width:28px"></th>
              </tr></thead>
              <tbody id="dgls-sol-tbody"></tbody>
            </table>
          </div>
          <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
            <button onclick="_dglsAddLinea()" style="border:1px dashed #9ca3af;background:none;color:#6b7280;cursor:pointer;padding:5px 14px;border-radius:4px;font-size:12px">+ Agregar ítem</button>
            <div style="display:flex;gap:10px">
              <button onclick="closeModal()" class="btn btn-outline btn-sm">Cancelar</button>
              <button id="dgls-enviar-btn" onclick="_dglsEnviarSolicitud('${esc(targetOp)}')" class="btn btn-primary btn-sm">📤 Enviar solicitud</button>
            </div>
          </div>
        </div>
      </div>`;
    _dglsRenderTable();
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<p style="color:#dc2626;padding:16px">Error: ${esc(err.message)}</p>`;
  }
};

window._dglsEnviarSolicitud = async function(targetOp) {
  const lineas = _dglsLineas.filter(l => (l.cantidadSolicitada || 0) > 0 && l.item);
  if (!lineas.length) { toast('No hay líneas con cantidad > 0', 'error'); return; }
  const btn = document.getElementById('dgls-enviar-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await POST('/pedidos', {
      operacion:   targetOp,
      fechaPedido: new Date().toISOString().split('T')[0],
      lineas: lineas.map(l => ({
        item:               l.item,
        itemNombre:         l.descripcion,
        grupoCompra:        l.grupoCompra || '',
        gestion:            'PLANTA',
        cantidadSolicitada: l.cantidadSolicitada || 0,
        costoUnitario:      l.costoUnitario || 0,
        comentarios:        l.comentarios || '',
        saldo:              l.saldo || 0,
      })),
    });
    closeModal();
    toast('Solicitud enviada correctamente', 'success');
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Enviar solicitud'; }
  }
};

// ─── View: Gestión de Pagos ───────────────────────────────────────
async function viewPagos(container) {
  const rolP = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');

  // Acceso por paso según rol
  const puedeP1 = ['programador','admin'].includes(rolP);
  const puedeP2 = ['aprobador','admin'].includes(rolP);
  const puedeP3 = ['pagador','admin'].includes(rolP);
  const puedeP4 = ['autorizador','admin'].includes(rolP);
  const puedeP5 = ['pagador','admin'].includes(rolP);

  // Tab inicial: primer paso al que tiene acceso
  const pasoInicial = puedeP1 ? 'p1' : puedeP2 ? 'p2' : puedeP3 ? 'p3' : puedeP4 ? 'p4' : 'p5';

  const tabAttr = (puede) => puede ? '' : 'disabled style="opacity:.4;cursor:not-allowed"';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">💸 Gestión de Pagos</div>
    </div>
    <div class="page-body">
      <div class="tabs mb-0">
        <button class="tab-btn" data-ptab="p1" ${tabAttr(puedeP1)}>📋 Paso 1 — Programación</button>
        <button class="tab-btn" data-ptab="p2" ${tabAttr(puedeP2)}>✅ Paso 2 — Aprobación</button>
        <button class="tab-btn" data-ptab="p3" ${tabAttr(puedeP3)}>🏦 Paso 3 — Preparación de Pagos</button>
        <button class="tab-btn" data-ptab="p4" ${tabAttr(puedeP4)}>🔑 Paso 4 — Autorización en Bancos</button>
        <button class="tab-btn" data-ptab="p5" ${tabAttr(puedeP5)}>📝 Paso 5 — Registro del Movimiento Bancario</button>
      </div>
      <div id="pagos-content" class="mt-16"></div>
    </div>`;

  container.querySelectorAll('.tab-btn[data-ptab]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      container.querySelectorAll('.tab-btn[data-ptab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderPasoContent(b.dataset.ptab, document.getElementById('pagos-content'));
    });
  });

  // Activar el tab inicial
  const btnInicial = container.querySelector(`[data-ptab="${pasoInicial}"]`);
  if (btnInicial) btnInicial.classList.add('active');

  await renderPasoContent(pasoInicial, document.getElementById('pagos-content'));
}

async function renderPasoContent(paso, el) {
  // Ocultar footers de otros pasos al cambiar
  const p1f = document.getElementById('pg-resumenes-footer');
  const p2f = document.getElementById('ap2-footer');
  const p3f = document.getElementById('ap3-footer');
  const p4f = document.getElementById('ap4-footer');
  const p5f = document.getElementById('ap5-footer');
  if (p1f) p1f.style.display = paso === 'p1' ? 'grid' : 'none';
  if (p2f) p2f.style.display = paso === 'p2' ? 'flex' : 'none';
  if (p3f) p3f.style.display = paso === 'p3' ? 'flex' : 'none';
  if (p4f) p4f.style.display = paso === 'p4' ? 'flex' : 'none';
  if (p5f) p5f.style.display = paso === 'p5' ? 'flex' : 'none';
  if (paso === 'p1') await renderPaso1(el);
  if (paso === 'p2') await renderPaso2(el);
  if (paso === 'p3') await renderPaso3(el);
  if (paso === 'p4') await renderPaso4(el);
  if (paso === 'p5') await renderPaso5(el);
}

async function renderPaso1(container) {
  // ── Estado compartido de esta vista ──
  let progActual   = null;   // programación cargada
  let benefMap     = {};     // nombre.upper → grupo
  let filtroDoc    = '';
  let filtroNum    = '';
  let filtroBenef  = '';
  let filtroGrupo  = '';

  const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
  const fmtMonto = v => v == null ? '—' : Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Obtener fecha de pago
  const fp = await GET('/pagos/fecha-pago');
  const fechaPagoStr = fmtFecha(fp.fechaPago);

  container.innerHTML = `
    <div class="card mb-16" style="padding:16px">
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">

        <!-- Columna izquierda: sociedad, TC y fecha de pago -->
        <div style="display:flex;flex-direction:column;gap:10px;min-width:200px">
          <div style="display:flex;gap:12px;align-items:flex-end">
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
              <select id="pg-compania" class="form-control" style="width:140px">
                <option value="">— Seleccionar —</option>
                ${(S.user.role === 'ADMIN' || S.user.rolPago === 'admin'
                  ? ALL_SOCS_COMPRA
                  : (S.user.sociedadesPago || [])
                ).map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">T/C</label>
              <input id="pg-tc" type="number" step="0.001" min="0" class="form-control"
                     style="width:80px;font-size:13px" value="3.700"
                     oninput="clearTimeout(window._pgTC);window._pgTC=setTimeout(()=>renderTabla(),400)">
            </div>
          </div>
          <div style="padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;font-size:12px;white-space:nowrap">
            <div style="color:var(--text-muted);margin-bottom:2px">Fecha de pago</div>
            <strong id="pg-fecha-pago" style="font-size:13px">${fechaPagoStr}</strong>
            <span style="color:var(--text-muted);margin-left:8px">Sem. ${fp.semana}/${fp.año}</span>
          </div>
        </div>

        <!-- Divisor vertical -->
        <div style="width:1px;background:#e2e8f0;align-self:stretch;flex-shrink:0"></div>

        <!-- Columna derecha: tres grupos de carga -->
        <div style="display:flex;gap:16px;flex-wrap:wrap;flex:1">

          <!-- Programación -->
          <div style="display:flex;flex-direction:column;gap:6px;min-width:160px">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Programación</label>
            <input type="file" id="pg-file" accept=".csv" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('pg-file').click()" style="width:100%;justify-content:center">
              📎 Seleccionar
            </button>
            <span id="pg-filename" style="font-size:11px;color:var(--text-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:160px">Sin archivo</span>
            <button class="btn btn-primary btn-sm" id="pg-cargar" style="width:100%;justify-content:center">📂 Cargar</button>
            <button class="btn btn-outline btn-sm" id="pg-agregar" style="width:100%;justify-content:center">➕ Agregar oblig.</button>
          </div>

          <!-- Pagos -->
          <div style="display:flex;flex-direction:column;gap:6px;min-width:160px">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Pagos</label>
            <input type="file" id="pg-file-pagos" accept=".csv" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('pg-file-pagos').click()" style="width:100%;justify-content:center">
              📊 Seleccionar
            </button>
            <span id="pg-filename-pagos" style="font-size:11px;color:var(--text-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:160px">Sin archivo</span>
            <button class="btn btn-primary btn-sm" id="pg-cargar-pagos" style="width:100%;justify-content:center">📂 Cargar</button>
          </div>

          <!-- Adelantos -->
          <div style="display:flex;flex-direction:column;gap:6px;min-width:160px">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Adelantos por Rendir</label>
            <input type="file" id="pg-file-adelantos" accept=".csv" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('pg-file-adelantos').click()" style="width:100%;justify-content:center">
              💵 Seleccionar
            </button>
            <span id="pg-filename-adelantos" style="font-size:11px;color:var(--text-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:160px">Sin archivo</span>
            <button class="btn btn-primary btn-sm" id="pg-cargar-adelantos" style="width:100%;justify-content:center">📂 Cargar</button>
          </div>

          <!-- EBC Obligaciones (solo programador/admin) -->
          ${(S.user.rolPago === 'programador' || S.user.rolPago === 'admin' || S.user.role === 'ADMIN') ? `
          <div style="display:flex;flex-direction:column;gap:6px;min-width:160px">
            <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Obligaciones EBC</label>
            <input type="file" id="pg-file-ebc" accept=".csv" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('pg-file-ebc').click()" style="width:100%;justify-content:center">
              📋 Seleccionar
            </button>
            <span id="pg-filename-ebc" style="font-size:11px;color:var(--text-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:160px">Sin archivo</span>
            <button class="btn btn-primary btn-sm" id="pg-cargar-ebc" style="width:100%;justify-content:center">📂 Cargar</button>
          </div>` : ''}

        </div>
      </div>
    </div>

    <!-- Lista de programaciones existentes -->
    <div id="pg-progs-lista" style="margin-bottom:12px"></div>

    <!-- Filtros -->
    <div class="card mb-16" style="padding:12px;display:none" id="pg-filtros">
      <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Tipo Documento</label>
          <select id="f-tipodoc" class="form-control" style="width:120px;font-size:12px" onchange="pgFiltrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">N° Documento</label>
          <input id="f-numdoc" class="form-control" style="width:160px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._pgT);window._pgT=setTimeout(pgFiltrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Beneficiario</label>
          <input id="f-benef" class="form-control" style="width:180px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._pgT);window._pgT=setTimeout(pgFiltrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Grupo</label>
          <select id="f-grupo" class="form-control" style="width:140px;font-size:12px" onchange="pgFiltrarGrupo()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Detalle Grupo</label>
          <select id="f-detalle" class="form-control" style="width:140px;font-size:12px" onchange="pgFiltrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div style="align-self:flex-end;padding-bottom:2px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" id="f-solo-sel" onchange="pgFiltrar()"
                   style="width:14px;height:14px;accent-color:var(--primary)">
            Solo seleccionadas
          </label>
        </div>
        <button class="btn btn-outline btn-sm" onclick="pgLimpiarFiltros()">✕ Limpiar</button>
        <div id="pg-footer-btns" style="display:none;align-items:center;gap:8px;margin-left:auto">
          <button class="btn btn-outline btn-sm" id="pg-aplicar-ebc-btn" style="display:none">📋 Aplicar EBC</button>
          <button class="btn btn-outline btn-sm" id="pg-guardar-btn">💾 Guardar</button>
          <button class="btn btn-primary btn-sm" id="pg-enviar-btn">📤 Enviar a Aprobación</button>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
      <button class="btn btn-outline btn-sm" id="pg-ver-adelantos">📋 Ver Adelantos</button>
      <button class="btn btn-outline btn-sm" onclick="imprimirVista('pg-tabla-wrap','Paso 1 — Programación de Pagos')">🖨️ Imprimir</button>
      <button class="btn btn-outline btn-sm" onclick="exportarVistaExcel('pg-tabla-wrap','paso1-programacion')">📥 Bajar a Excel</button>
    </div>

    <!-- Tabla de obligaciones (scrollable) — con espacio para el footer fijo -->
    <div id="pg-tabla-wrap" style="padding-bottom:320px"></div>

    <!-- Resúmenes fijos al pie (se inyectan vía JS fuera del flujo) -->
    <div id="pg-resumenes-placeholder"></div>`;

  // Crear el footer fijo de resúmenes como elemento global
  let pgFooter = document.getElementById('pg-resumenes-footer');
  if (!pgFooter) {
    pgFooter = document.createElement('div');
    pgFooter.id = 'pg-resumenes-footer';
    pgFooter.style.cssText = `
      position:fixed; bottom:0; left:220px; right:0; z-index:100;
      background:#fff; border-top:2px solid #e2e8f0;
      box-shadow:0 -4px 12px rgba(0,0,0,.08);
      display:grid; grid-template-columns:1fr 1fr; gap:0;
    `;
    pgFooter.innerHTML = `
      <div style="border-right:1px solid #e2e8f0">
        <div style="padding:6px 14px;font-weight:600;font-size:12px;background:var(--bg-secondary);border-bottom:1px solid #e2e8f0">
          Resumen por Beneficiario
        </div>
        <div id="pg-res-benef" style="overflow-y:auto;max-height:228px"></div>
      </div>
      <div>
        <div style="padding:6px 14px;font-weight:600;font-size:12px;background:var(--bg-secondary);border-bottom:1px solid #e2e8f0">
          Resumen por Grupo
        </div>
        <div id="pg-res-grupo" style="overflow-y:auto;max-height:228px"></div>
      </div>`;
    document.body.appendChild(pgFooter);
  }

  // Mostrar nombre del archivo seleccionado
  document.getElementById('pg-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    document.getElementById('pg-filename').textContent = f ? f.name : 'Sin archivo';
  });

  // Q PAGOS: selección y carga
  document.getElementById('pg-file-pagos').addEventListener('change', e => {
    const f = e.target.files[0];
    document.getElementById('pg-filename-pagos').textContent = f ? f.name : 'Sin archivo';
  });
  document.getElementById('pg-cargar-pagos').addEventListener('click', async () => {
    const file = document.getElementById('pg-file-pagos').files[0];
    if (!file) { toast('Selecciona el archivo de Pagos', 'error'); return; }
    const fd = new FormData();
    fd.append('archivo', file);
    if (progActual?._id) fd.append('progId', progActual._id);
    document.getElementById('pg-prog-wrap-pagos')?.remove();
    pgSetProgress('pagos', 0, 'Iniciando...');
    try {
      const data = await pgUploadXHR('/api/pagos/cargar-pagos', fd, 'pagos');
      pgSetProgress('pagos', 95, 'Actualizando resúmenes...');
      pagosPromedios = data;
      renderResumenes();
      pgSetProgress('pagos', 100, `✓ ${Object.keys(data).length} proveedores cargados`);
      toast(`Pagos cargados — ${Object.keys(data).length} proveedores`, 'success');
    } catch(e) {
      document.getElementById('pg-prog-wrap-pagos')?.remove();
      toast(e.message, 'error');
    }
  });

  // Adelantos: selección y carga
  document.getElementById('pg-file-adelantos').addEventListener('change', e => {
    const f = e.target.files[0];
    document.getElementById('pg-filename-adelantos').textContent = f ? f.name : 'Sin archivo';
  });
  document.getElementById('pg-cargar-adelantos').addEventListener('click', async () => {
    const compania = document.getElementById('pg-compania').value;
    if (!compania) { toast('Selecciona una sociedad', 'error'); return; }
    const file = document.getElementById('pg-file-adelantos').files[0];
    if (!file) { toast('Selecciona el archivo de Adelantos', 'error'); return; }
    const fd = new FormData();
    fd.append('archivo', file);
    fd.append('compania', compania);
    document.getElementById('pg-prog-wrap-adelantos')?.remove();
    pgSetProgress('adelantos', 0, 'Iniciando...');
    try {
      const data = await pgUploadXHR('/api/pagos/adelantos/cargar', fd, 'adelantos');
      pgSetProgress('adelantos', 90, 'Actualizando tabla...');
      delete _pgAdelantosCache[compania];
      if (progActual?.compania === compania) {
        await pgAdelantosResumen(compania);
        renderTabla();
      }
      pgSetProgress('adelantos', 100, `✓ ${data.total} docs, ${data.proveedores} proveedores`);
      toast(`Adelantos cargados — ${data.total} documentos, ${data.proveedores} proveedores`, 'success');
    } catch(e) {
      document.getElementById('pg-prog-wrap-adelantos')?.remove();
      toast(e.message, 'error');
    }
  });

  // EBC Obligaciones: selección y carga (solo si el botón existe — programador/admin)
  document.getElementById('pg-file-ebc')?.addEventListener('change', e => {
    const f = e.target.files[0];
    document.getElementById('pg-filename-ebc').textContent = f ? f.name : 'Sin archivo';
  });
  document.getElementById('pg-cargar-ebc')?.addEventListener('click', async () => {
    const file = document.getElementById('pg-file-ebc').files[0];
    if (!file) { toast('Selecciona el archivo EBC OBLIGACIONES.csv', 'error'); return; }
    const fd = new FormData();
    fd.append('archivo', file);
    try {
      const res = await fetch(`${API}/obligaciones-ebc/cargar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${S.token}` },
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      toast(`✅ ${data.insertados} obligaciones cargadas (${(data.companias||[]).join(', ')})`, 'success');
      document.getElementById('pg-filename-ebc').textContent = 'Sin archivo';
      document.getElementById('pg-file-ebc').value = '';
    } catch(e) { toast(e.message, 'error'); }
  });

  // Ver relación de adelantos
  document.getElementById('pg-ver-adelantos').addEventListener('click', () => {
    const compania = document.getElementById('pg-compania').value;
    pgVerRelacionAdelantos(compania, progActual?._id);
  });

  // Al cambiar sociedad → limpiar estado actual y mostrar programaciones existentes
  document.getElementById('pg-compania').addEventListener('change', async (e) => {
    const comp = e.target.value;
    progActual = null;
    benefMap   = {};
    document.getElementById('pg-tabla-wrap').innerHTML = '';
    document.getElementById('pg-filtros').style.display = 'none';
    document.getElementById('pg-footer-btns').style.display = 'none';
    document.getElementById('pg-res-benef').innerHTML = '';
    document.getElementById('pg-res-grupo').innerHTML  = '';
    await pgCargarListaProgs(comp);
  });

  async function pgCargarListaProgs(compania) {
    const wrap = document.getElementById('pg-progs-lista');
    if (!wrap) return;
    if (!compania) { wrap.innerHTML = ''; return; }
    try {
      const progs = await GET(`/pagos/programaciones?compania=${encodeURIComponent(compania)}`);
      if (!progs.length) { wrap.innerHTML = `<p style="font-size:12px;color:var(--text-muted);margin:6px 0">Sin programaciones anteriores para ${compania}</p>`; return; }
      const fmtEstado = e => ({ borrador:'🔵 Borrador', pendiente:'🟡 Pendiente', aprobado:'🟢 Aprobado', pagado:'✅ Pagado' }[e] || e);
      const esAdmin   = S.user.role === 'ADMIN';
      const editable  = e => ['borrador','pendiente'].includes(e) || esAdmin;
      wrap.innerHTML = `
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Programaciones — ${compania}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${progs.map(p => `
            <div style="display:flex;align-items:stretch;gap:0;border:1px solid ${p.estado==='borrador'?'#93c5fd':p.estado==='pendiente'?'#fcd34d':'#86efac'};border-radius:6px;overflow:hidden">
              <button onclick="pgAbrirProg('${p._id}')"
                style="font-size:12px;padding:6px 12px;background:${p.estado==='borrador'?'#eff6ff':p.estado==='pendiente'?'#fffbeb':'#f0fdf4'};border:none;cursor:pointer;text-align:left">
                <div style="font-weight:600">Sem. ${p.semana}/${p.año}</div>
                <div style="color:var(--text-muted);font-size:11px">${new Date(p.fechaPago).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'})}</div>
                <div style="font-size:11px">${fmtEstado(p.estado)}</div>
              </button>
              ${editable(p.estado)?`
              <button onclick="pgEliminarProg('${p._id}',event)"
                style="background:#fee2e2;border:none;border-left:1px solid #fca5a5;padding:0 8px;cursor:pointer;color:#ef4444;font-size:14px"
                title="Eliminar">🗑️</button>`:''}
            </div>`).join('')}
        </div>`;
    } catch(e) { wrap.innerHTML = `<p style="font-size:12px;color:red">${e.message}</p>`; }
  }

  window.pgAbrirProg = async (id) => {
    try {
      progActual = await GET(`/pagos/programaciones/${id}`);
      progActual._readOnly = !['borrador','pendiente'].includes(progActual.estado);
      progActual.obligaciones.forEach(ob => { benefMap[ob.pagarA.toUpperCase()] = ob.grupo; });
      // Restaurar promedios guardados (si existen)
      pagosPromedios = progActual.promediosPagos || {};
      await pgAdelantosResumen(progActual.compania);
      await renderTablaYResumenes();
      if (progActual._readOnly) toast('Vista de solo lectura — estado: ' + progActual.estado, 'success');
      else toast('Programación cargada', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };

  window.pgEliminarProg = async (id, e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta programación? Esta acción no se puede deshacer.')) return;
    try {
      await DEL(`/pagos/programaciones/${id}`);
      if (progActual?._id === id) {
        progActual = null;
        document.getElementById('pg-tabla-wrap').innerHTML = '';
        document.getElementById('pg-filtros').style.display = 'none';
        const _fb = document.getElementById('pg-footer-btns'); if (_fb) _fb.style.display = 'none';
        renderResumenes();
      }
      const comp = document.getElementById('pg-compania').value;
      await pgCargarListaProgs(comp);
      toast('Programación eliminada', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Barra de progreso genérica ─────────────────────────────────────
  // key: 'prog' | 'pagos' | 'adelantos'  — ancla en el botón pg-cargar[-key]
  function pgSetProgress(key, pct, label) {
    const btnId  = key === 'prog' ? 'pg-cargar' : `pg-cargar-${key}`;
    const wrapId = `pg-prog-wrap-${key}`;
    const barId  = `pg-prog-bar-${key}`;
    let bar = document.getElementById(barId);
    if (!bar) {
      const wrap = document.createElement('div');
      wrap.id = wrapId;
      wrap.style.cssText = 'margin-top:6px;animation:fadeIn .2s';
      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px">
          <span id="pg-prog-lbl-${key}">Cargando...</span>
          <span id="pg-prog-pct-${key}">0%</span>
        </div>
        <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
          <div id="${barId}" style="height:100%;width:0%;background:var(--primary);border-radius:3px;transition:width .3s"></div>
        </div>`;
      document.getElementById(btnId).after(wrap);
      bar = document.getElementById(barId);
    }
    bar.style.width = pct + '%';
    bar.style.background = pct === 100 ? '#22c55e' : 'var(--primary)';
    document.getElementById(`pg-prog-lbl-${key}`).textContent = label;
    document.getElementById(`pg-prog-pct-${key}`).textContent = pct + '%';
    if (pct === 100) setTimeout(() => document.getElementById(wrapId)?.remove(), 1500);
  }

  function pgUploadXHR(url, fd, key) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('ebc_token'));
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 70);
          pgSetProgress(key, pct, `Enviando archivo... ${pct}%`);
        }
      });
      xhr.addEventListener('load', () => {
        pgSetProgress(key, 85, 'Procesando...');
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 400) reject(new Error(data.error || `Error ${xhr.status}`));
          else resolve(data);
        } catch(e) { reject(new Error('Respuesta inválida del servidor')); }
      });
      xhr.addEventListener('error', () => reject(new Error('Error de red')));
      xhr.send(fd);
    });
  }

  // ── Cargar CSV ─────────────────────────────────────────────────────
  document.getElementById('pg-cargar').addEventListener('click', async () => {
    const compania = document.getElementById('pg-compania').value.trim();
    const file     = document.getElementById('pg-file').files[0];
    if (!compania) { toast('Selecciona la sociedad', 'error'); return; }
    if (!file)     { toast('Selecciona el archivo CSV', 'error'); return; }
    const fd = new FormData();
    fd.append('archivo', file);
    fd.append('compania', compania);
    document.getElementById('pg-prog-wrap-prog')?.remove();
    pgSetProgress('prog', 0, 'Iniciando...');
    try {
      const data = await pgUploadXHR('/api/pagos/cargar', fd, 'prog');
      pgSetProgress('prog', 92, 'Cargando programación...');
      progActual = await GET(`/pagos/programaciones/${data.id}`);
      progActual.obligaciones.forEach(ob => { benefMap[ob.pagarA.toUpperCase()] = ob.grupo; });
      await pgAdelantosResumen(progActual.compania);
      pgSetProgress('prog', 98, 'Renderizando tabla...');
      await renderTablaYResumenes();
      pgSetProgress('prog', 100, `✓ ${data.total} obligaciones cargadas`);
      toast(`${data.total} obligaciones cargadas`, 'success');
    } catch(e) {
      document.getElementById('pg-prog-wrap-prog')?.remove();
      toast(e.message, 'error');
    }
  });

  // ── Agregar obligaciones (sin eliminar las existentes) ───────────────
  document.getElementById('pg-agregar').addEventListener('click', async () => {
    const file = document.getElementById('pg-file').files[0];
    if (!progActual) { toast('Primero carga una programación', 'error'); return; }
    if (!['borrador','pendiente'].includes(progActual.estado)) { toast('Solo se pueden agregar obligaciones en estado borrador o pendiente', 'error'); return; }
    if (!file) { toast('Selecciona el archivo CSV', 'error'); return; }
    const fd = new FormData();
    fd.append('archivo', file);
    pgSetProgress('prog', 0, 'Agregando obligaciones...');
    try {
      const data = await pgUploadXHR(`/api/pagos/programaciones/${progActual._id}/agregar-obligaciones`, fd, 'prog');
      pgSetProgress('prog', 92, 'Cargando programación...');
      progActual = await GET(`/pagos/programaciones/${progActual._id}`);
      progActual.obligaciones.forEach(ob => { benefMap[ob.pagarA.toUpperCase()] = ob.grupo; });
      await pgAdelantosResumen(progActual.compania);
      pgSetProgress('prog', 98, 'Renderizando tabla...');
      await renderTablaYResumenes();
      pgSetProgress('prog', 100, `✓ ${data.added} nuevas, ${data.skipped} ya existían`);
      toast(`${data.added} obligaciones nuevas agregadas${data.skipped ? ` (${data.skipped} ya existían)` : ''}`, 'success');
    } catch(e) {
      document.getElementById('pg-prog-wrap-prog')?.remove();
      toast(e.message, 'error');
    }
  });

  // ── Render tabla + resúmenes ────────────────────────────────────────
  // Cargar grupos y detalles una vez
  let gruposRef = [], detallesRef = [], pagosPromedios = {};
  async function cargarGruposRef() {
    [gruposRef, detallesRef] = await Promise.all([
      GET('/pagos/grupos'), GET('/pagos/detalles'),
    ]);
  }

  async function renderTablaYResumenes() {
    if (!progActual) return;
    await cargarGruposRef();
    document.getElementById('pg-filtros').style.display = '';
    const readOnly   = !!progActual._readOnly;
    const esBorrador = !readOnly && ['borrador','pendiente'].includes(progActual.estado);
    const btnWrap = document.getElementById('pg-footer-btns');
    if (btnWrap) {
      if (esBorrador) {
        btnWrap.style.display = 'flex';
        document.getElementById('pg-guardar-btn').onclick = pgGuardar;
        document.getElementById('pg-enviar-btn').onclick = pgEnviarAprobacion;
        const aplicarEbcBtn = document.getElementById('pg-aplicar-ebc-btn');
        if (aplicarEbcBtn) {
          aplicarEbcBtn.style.display = '';
          aplicarEbcBtn.onclick = pgAplicarEBC;
        }
      } else {
        btnWrap.style.display = 'none';
      }
    }
    poblarFiltros();
    renderResumenes();
    renderTabla();
  }

  function poblarFiltros() {
    const obs    = progActual?.obligaciones || [];
    const tipos  = [...new Set(obs.map(o => o.tipoDocumento).filter(Boolean))].sort();
    const grupos = [...new Set(obs.map(o => o.grupo).filter(Boolean))].sort();
    const dets   = [...new Set(obs.map(o => o.detalleGrupo).filter(Boolean))].sort();
    document.getElementById('f-tipodoc').innerHTML  = '<option value="">Todos</option>' + tipos.map(t => `<option>${t}</option>`).join('');
    document.getElementById('f-grupo').innerHTML    = '<option value="">Todos</option>' + grupos.map(g => `<option>${esc(g)}</option>`).join('');
    document.getElementById('f-detalle').innerHTML  = '<option value="">Todos</option>' + dets.map(d => `<option>${esc(d)}</option>`).join('');
  }

  // Al cambiar grupo, recargar detalles del grupo seleccionado
  window.pgFiltrarGrupo = () => {
    const grp  = document.getElementById('f-grupo')?.value || '';
    const dets = grp
      ? [...new Set((progActual?.obligaciones||[]).filter(o => o.grupo===grp).map(o=>o.detalleGrupo).filter(Boolean))].sort()
      : [...new Set((progActual?.obligaciones||[]).map(o=>o.detalleGrupo).filter(Boolean))].sort();
    document.getElementById('f-detalle').innerHTML = '<option value="">Todos</option>' + dets.map(d => `<option>${esc(d)}</option>`).join('');
    pgFiltrar();
  };

  function obligacionesFiltradas() {
    const fDoc    = document.getElementById('f-tipodoc')?.value || '';
    const fNum    = (document.getElementById('f-numdoc')?.value || '').toLowerCase();
    const fBenef  = (document.getElementById('f-benef')?.value || '').toLowerCase();
    const fGrp    = document.getElementById('f-grupo')?.value || '';
    const fDet    = document.getElementById('f-detalle')?.value || '';
    const fSoloSel= document.getElementById('f-solo-sel')?.checked || false;
    return (progActual?.obligaciones || []).filter(o =>
      (!fDoc    || o.tipoDocumento === fDoc) &&
      (!fNum    || o.numeroDocumento.toLowerCase().includes(fNum)) &&
      (!fBenef  || o.pagarA.toLowerCase().includes(fBenef)) &&
      (!fGrp    || o.grupo === fGrp) &&
      (!fDet    || o.detalleGrupo === fDet) &&
      (!fSoloSel || o.seleccionado)
    );
  }

  function renderTabla() {
    const obs      = obligacionesFiltradas();
    const wrap     = document.getElementById('pg-tabla-wrap');
    const tc       = parseFloat(document.getElementById('pg-tc')?.value) || 1;
    const readOnly = !!progActual?._readOnly;

    if (!obs.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin obligaciones para los filtros aplicados</p></div>`;
      return;
    }

    const grpOpts = ['OTROS', ...gruposRef.map(g => g.nombre)]
      .map(g => `<option value="${g}">${g}</option>`).join('');

    wrap.innerHTML = `
      <div class="card" style="overflow:hidden">
        <div style="padding:8px 14px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border);display:flex;justify-content:space-between">
          <span>${obs.length} obligaciones · Fecha de pago: <strong>${fechaPagoStr}</strong>
          · Seleccionadas: <strong>${obs.filter(o=>o.seleccionado).length}</strong></span>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;font-weight:normal">
            <input type="checkbox" id="pg-check-all" style="width:14px;height:14px"
                   onchange="pgToggleAll(this.checked)"> Marcar todos
          </label>
        </div>
        <div style="overflow-x:auto;max-height:calc(100vh - 420px);overflow-y:auto">
          <table class="data-table" style="font-size:11px">
            <thead><tr>
              <th style="width:28px"></th>
              <th>Tipo</th><th>N° Documento</th><th>Vencimiento</th><th>F. Documento</th><th class="text-right">Plazo</th>
              <th>Mon.</th><th class="text-right">Monto</th><th class="text-right">Monto S/</th>
              <th>Beneficiario</th><th>Banco</th>
              <th class="text-right">Días Venc.</th>
              <th style="min-width:110px">Grupo</th>
              <th style="min-width:110px">Detalle Grupo</th>
              <th style="width:40px"></th>
            </tr></thead>
            <tbody>
              ${obs.map(o => {
                const dv = o.diasVencido;
                const dvColor   = dv > 0 ? '#ef4444' : dv < 0 ? '#10b981' : '#64748b';
                const dvLabel   = dv > 0 ? `+${dv}` : String(dv);
                const montoColor= o.monto < 0 ? 'color:#ef4444' : '';
                const esLocal   = o.moneda === 'LO';
                const montoSol  = esLocal ? o.monto : o.monto * tc;
                const autoCheck = dv >= 0 && dv <= 9;
                const checked   = o.seleccionado !== undefined ? o.seleccionado : autoCheck;
                // Detalles filtrados por grupo actual
                const dtOpts = ['OTROS', ...detallesRef.filter(d => d.grupoProveedor === o.grupo).map(d => d.nombre)]
                  .map(d => `<option value="${d}" ${o.detalleGrupo===d?'selected':''}>${d}</option>`).join('');
                const grpOptsRow = grpOpts.replace(`value="${o.grupo}"`, `value="${o.grupo}" selected`);
                const tieneParcial = progActual?.obligaciones?.some(x => x.esParcial && x.obligacionOrigenId === String(o._id));
                return `<tr style="${o.esParcial ? 'background:#fef9c3;' : (checked?'background:#bbf7d0;':'')}${o.origenEBC ? 'border-left:3px solid #f59e0b;' : ''}${pgAdelantoRowStyle(o.pagarA)}">
                  <td class="text-center">
                    <input type="checkbox" class="pg-check" data-pa="${esc(o.pagarA)}" data-idx="${obs.indexOf(o)}"
                           style="width:14px;height:14px;accent-color:var(--primary)"
                           ${checked?'checked':''} ${readOnly?'disabled':''}
                           onchange="pgToggleObl(this)">
                  </td>
                  <td><span class="badge badge-outline" style="font-size:10px">${esc(o.tipoDocumento)}</span></td>
                  <td style="white-space:nowrap">${esc(o.numeroDocumento)}</td>
                  <td style="white-space:nowrap">${fmtFecha(o.fechaVencimiento)}</td>
                  <td style="white-space:nowrap">${fmtFecha(o.fechaDocumento)}</td>
                  <td class="text-right" style="color:var(--text-muted);font-size:10px">${
                    o.fechaVencimiento && o.fechaDocumento
                      ? Math.round((new Date(o.fechaVencimiento) - new Date(o.fechaDocumento)) / 86400000) + 'd'
                      : '—'
                  }</td>
                  <td>${esc(o.moneda)}</td>
                  <td class="text-right fw-semibold" style="${montoColor}">${fmtMonto(o.monto)}${o.esParcial ? `<br><span style="font-size:9px;font-weight:600;color:#92400e;background:#fef3c7;border-radius:3px;padding:0 3px">PARCIAL</span>` : ''}${o.origenEBC ? `<span style="font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;display:inline-block;margin-left:4px">📋 EBC</span>` : ''}</td>
                  <td class="text-right fw-semibold" style="${!esLocal?'color:#3b82f6':''}">
                    ${fmtMonto(montoSol)}
                  </td>
                  <td style="max-width:220px">
                    <div style="display:flex;align-items:center;gap:4px">
                      <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0"
                            title="${esc(o.pagarA)}">${esc(o.pagarA)}</span>
                      ${pgAdelantoBadgeHtml(o.pagarA)}
                    </div>
                  </td>
                  <td>${esc(o.banco)}</td>
                  <td class="text-right fw-semibold" style="color:${dvColor}">${dvLabel}</td>
                  <td>${readOnly
                    ? `<span style="font-size:11px">${esc(o.grupo)}</span>`
                    : `<select style="font-size:11px;padding:2px 4px;width:100%;border:1px solid #e2e8f0;border-radius:4px"
                               onchange="pgActGrupo('${esc(o.pagarA)}',this.value,'grupo');this.closest('tr').querySelector('.pg-detalle-sel').innerHTML='<option>OTROS</option>'+pgDetalleOpts(this.value)">
                         ${grpOptsRow}
                       </select>`}
                  </td>
                  <td>${readOnly
                    ? `<span style="font-size:11px">${esc(o.detalleGrupo||'')}</span>`
                    : `<select class="pg-detalle-sel" style="font-size:11px;padding:2px 4px;width:100%;border:1px solid #e2e8f0;border-radius:4px"
                               onchange="pgActGrupo('${esc(o.pagarA)}',this.value,'detalleGrupo')">
                         ${dtOpts}
                       </select>`}
                  </td>
                  <td style="text-align:center;padding:2px">
                    ${!readOnly
                      ? (o.esParcial
                          ? `<button class="btn btn-outline btn-sm" style="color:var(--danger);padding:1px 5px;font-size:13px" title="Eliminar pago parcial" onclick="pgEliminarParcial('${o._id}')">🗑️</button>`
                          : (!tieneParcial
                              ? `<button class="btn btn-outline btn-sm" style="padding:1px 5px;font-size:13px" title="Definir pago parcial" onclick="pgPagoParcial('${o._id}')">✂️</button>`
                              : `<span style="font-size:10px;color:var(--text-muted)" title="Ya tiene un pago parcial">✂️</span>`))
                      : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderResumenes() {
    // Solo obligaciones seleccionadas para pago
    const obs = obligacionesFiltradas().filter(o => o.seleccionado);
    const tc  = parseFloat(document.getElementById('pg-tc')?.value) || 1;
    const fBenefFilt = (document.getElementById('f-benef')?.value || '').toLowerCase();
    const fGrpFilt   = document.getElementById('f-grupo')?.value || '';

    const usd  = o => o.moneda !== 'LO' ? o.monto : 0;
    const sol  = o => o.moneda === 'LO' ? o.monto : 0;
    const tot  = o => o.moneda === 'LO' ? o.monto : o.monto * tc;
    const sumF = (arr, fn) => arr.reduce((s, o) => s + fn(o), 0);

    const hasProm = Object.keys(pagosPromedios).length > 0;
    const THEAD_B = `<thead><tr>
      <th style="width:24px"></th><th>Nombre</th>
      <th class="text-right">USD</th>
      <th class="text-right">S/</th>
      <th class="text-right">Total S/</th>
      ${hasProm ? '<th class="text-right" style="color:#8b5cf6" title="Promedio últimas 4 semanas (Q Pagos)">Prom. S/</th>' : ''}
    </tr></thead>`;
    const THEAD_G = `<thead><tr>
      <th style="width:24px"></th><th>Grupo</th>
      <th class="text-right">USD</th>
      <th class="text-right">S/</th>
      <th class="text-right">Total S/</th>
    </tr></thead>`;
    const TFOOT = (arr, extraCols = 0) => `<tfoot style="border-top:2px solid var(--border);background:var(--bg-secondary);font-weight:700">
      <tr>
        <td colspan="2" style="padding:4px 8px">TOTAL</td>
        <td class="text-right" style="padding:4px 8px">${fmtMonto(sumF(arr, usd))}</td>
        <td class="text-right" style="padding:4px 8px">${fmtMonto(sumF(arr, sol))}</td>
        <td class="text-right" style="padding:4px 8px;color:var(--primary)">${fmtMonto(sumF(arr, tot))}</td>
        ${'<td></td>'.repeat(extraCols)}
      </tr>
    </tfoot>`;

    // ── Por Beneficiario ──────────────────────────────────────────────
    const byBenef = {};
    obs.forEach(o => {
      if (!byBenef[o.pagarA]) byBenef[o.pagarA] = { obs: [], grupo: o.grupo };
      byBenef[o.pagarA].obs.push(o);
    });
    const benefRows = Object.entries(byBenef).sort(([,a],[,b]) => sumF(b.obs,tot) - sumF(a.obs,tot));
    document.getElementById('pg-res-benef').innerHTML = `
      <table class="data-table" style="font-size:11px">
        ${THEAD_B}
        <tbody>
          ${benefRows.length ? benefRows.map(([nombre, d]) => {
            const prom = pagosPromedios[nombre.toUpperCase()];
            return `<tr>
              <td><input type="checkbox" onchange="pgFiltrarDesdeResumen('benef','${esc(nombre)}',this.checked)"
                   ${fBenefFilt===nombre.toLowerCase()?'checked':''}></td>
              <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(nombre)}">${esc(nombre)}</td>
              <td class="text-right">${sumF(d.obs,usd)?fmtMonto(sumF(d.obs,usd)):'—'}</td>
              <td class="text-right">${sumF(d.obs,sol)?fmtMonto(sumF(d.obs,sol)):'—'}</td>
              <td class="text-right fw-semibold">${fmtMonto(sumF(d.obs,tot))}</td>
              ${hasProm?`<td class="text-right" style="color:#8b5cf6">${prom?fmtMonto(prom.promedio):'—'}</td>`:''}
            </tr>`;
          }).join('') : `<tr><td colspan="${hasProm?6:5}" class="text-center text-muted py-8" style="font-size:11px">Sin obligaciones seleccionadas</td></tr>`}
        </tbody>
        ${TFOOT(obs, hasProm?1:0)}
      </table>`;

    // ── Por Grupo ─────────────────────────────────────────────────────
    const byGrupo = {};
    obs.forEach(o => {
      const g = o.grupo || '(Sin grupo)';
      if (!byGrupo[g]) byGrupo[g] = { obs: [], beneficiarios: new Set() };
      byGrupo[g].obs.push(o);
      byGrupo[g].beneficiarios.add(o.pagarA);
    });
    const grupoRows = Object.entries(byGrupo).sort(([,a],[,b]) => sumF(b.obs,tot) - sumF(a.obs,tot));
    document.getElementById('pg-res-grupo').innerHTML = `
      <table class="data-table" style="font-size:11px">
        ${THEAD_G}
        <tbody>
          ${grupoRows.length ? grupoRows.map(([grupo, d]) => `<tr>
            <td><input type="checkbox" onchange="pgFiltrarDesdeResumen('grupo','${esc(grupo)}',this.checked)"
                 ${fGrpFilt===grupo?'checked':''}></td>
            <td class="fw-semibold">${esc(grupo)}</td>
            <td class="text-right">${sumF(d.obs,usd)?fmtMonto(sumF(d.obs,usd)):'—'}</td>
            <td class="text-right">${sumF(d.obs,sol)?fmtMonto(sumF(d.obs,sol)):'—'}</td>
            <td class="text-right fw-semibold">${fmtMonto(sumF(d.obs,tot))}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted py-8" style="font-size:11px">Sin obligaciones seleccionadas</td></tr>'}
        </tbody>
        ${TFOOT(obs, 0)}
      </table>`;
  }

  // ── Funciones globales ─────────────────────────────────────────────
  window.pgFiltrar = () => { renderTabla(); renderResumenes(); };

  window.pgLimpiarFiltros = () => {
    ['f-tipodoc','f-numdoc','f-benef','f-grupo','f-detalle'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const chk = document.getElementById('f-solo-sel');
    if (chk) chk.checked = false;
    renderTabla(); renderResumenes();
  };

  window.pgFiltrarDesdeResumen = (tipo, valor, activo) => {
    const id = tipo === 'benef' ? 'f-benef' : 'f-grupo';
    const el = document.getElementById(id);
    if (el) el.value = activo ? valor : '';
    renderTabla(); renderResumenes();
  };

  window.pgDetalleOpts = (grupoNombre) =>
    detallesRef.filter(d => d.grupoProveedor === grupoNombre)
      .map(d => `<option value="${d.nombre}">${d.nombre}</option>`).join('');

  window.pgToggleAll = (checked) => {
    document.querySelectorAll('.pg-check').forEach(cb => {
      cb.checked = checked;
      const tr = cb.closest('tr');
      if (tr) tr.style.background = checked ? '#bbf7d0' : '';
    });
    if (progActual) progActual.obligaciones.forEach(ob => { ob.seleccionado = checked; });
    renderResumenes();
  };

  window.pgToggleObl = (cb) => {
    if (!progActual) return;
    const obs = obligacionesFiltradas();
    const idx = parseInt(cb.dataset.idx);
    if (obs[idx]) obs[idx].seleccionado = cb.checked;
    const tr = cb.closest('tr');
    if (tr) tr.style.background = cb.checked ? '#bbf7d0' : '';
    if (document.getElementById('f-solo-sel')?.checked) renderTabla();
    renderResumenes();
  };

  window.pgActGrupo = async (pagarA, valor, campo = 'grupo') => {
    if (!progActual) return;
    const key   = pagarA.trim().toUpperCase();
    const nuevo = valor || 'OTROS';

    // Solo actualiza las del mismo beneficiario que tengan OTROS en ese campo
    progActual.obligaciones.forEach(ob => {
      if (ob.pagarA.trim().toUpperCase() === key && (ob[campo] === 'OTROS' || !ob[campo]))
        ob[campo] = nuevo;
    });

    // Actualizar DOM sin re-renderizar la tabla (preserva posición de scroll)
    document.querySelectorAll('.pg-check').forEach(cb => {
      if ((cb.dataset.pa || '').trim().toUpperCase() !== key) return;
      const tr = cb.closest('tr');
      if (!tr) return;
      if (campo === 'grupo') {
        // Actualizar el select de grupo y repoblar el de detalle
        const grpSel = tr.querySelector('select:not(.pg-detalle-sel)');
        if (grpSel) grpSel.value = nuevo;
        const detSel = tr.querySelector('.pg-detalle-sel');
        if (detSel) {
          detSel.innerHTML = `<option value="OTROS">OTROS</option>${pgDetalleOpts(nuevo)}`;
          detSel.value = 'OTROS';
        }
      } else {
        // Solo actualizar el select de detalle
        const detSel = tr.querySelector('.pg-detalle-sel');
        if (detSel) detSel.value = nuevo;
      }
    });
    renderResumenes();

    try {
      await PUT(`/pagos/programaciones/${progActual._id}/grupo-beneficiario`,
        { nombre: pagarA, [campo]: nuevo });
    } catch(e) { toast('Error guardando: ' + e.message, 'error'); }
  };

  // ── Pago parcial ──────────────────────────────────────────────────
  window.pgPagoParcial = (oblId) => {
    const ob = progActual?.obligaciones?.find(o => String(o._id) === oblId);
    if (!ob) return;
    const html = `
      <div style="margin-bottom:14px;font-size:13px">
        <strong>${esc(ob.pagarA)}</strong><br>
        <span style="color:var(--text-muted)">${esc(ob.tipoDocumento)} ${esc(ob.numeroDocumento)}</span><br>
        Monto total: <strong>${esc(ob.moneda)} ${fmtMonto(ob.monto)}</strong>
      </div>
      <label class="form-label">Importe del pago parcial (${esc(ob.moneda)})</label>
      <input id="pg-parcial-monto" type="number" step="0.01" min="0.01" max="${ob.monto - 0.01}"
             class="form-control" style="width:200px" placeholder="0.00">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
        <button id="pg-parcial-ok" class="btn btn-primary btn-sm">✂️ Crear pago parcial</button>
      </div>`;
    openModal('✂️ Pago Parcial', html);
    setTimeout(() => document.getElementById('pg-parcial-monto')?.focus(), 50);
    document.getElementById('pg-parcial-ok').addEventListener('click', async () => {
      const monto = parseFloat(document.getElementById('pg-parcial-monto').value);
      if (!monto || monto <= 0) return toast('Ingresa un importe válido', 'error');
      if (monto >= ob.monto) return toast(`El importe parcial debe ser menor al total (${fmtMonto(ob.monto)})`, 'error');
      try {
        const prog = await POST(`/pagos/programaciones/${progActual._id}/pago-parcial`, { obligacionId: oblId, montoParcial: monto });
        progActual.obligaciones = prog.obligaciones;
        closeModal();
        toast('Pago parcial creado', 'success');
        renderTabla(); renderResumenes();
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  window.pgEliminarParcial = async (oblId) => {
    if (!confirm('¿Eliminar este pago parcial? La obligación original quedará desmarcada.')) return;
    try {
      const prog = await DEL(`/pagos/programaciones/${progActual._id}/obligaciones/${oblId}`);
      progActual.obligaciones = prog.obligaciones;
      toast('Pago parcial eliminado', 'success');
      renderTabla(); renderResumenes();
    } catch (e) { toast(e.message, 'error'); }
  };

  // ── Guardar selecciones ────────────────────────────────────────────
  async function pgGuardar() {
    if (!progActual) return;
    const selecciones = progActual.obligaciones.map(ob => ({ id: ob._id, seleccionado: ob.seleccionado }));
    try {
      await PUT(`/pagos/programaciones/${progActual._id}/guardar`, { selecciones });
      toast('Programación guardada', 'success');
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Aplicar obligaciones EBC seleccionadas ────────────────────────
  async function pgAplicarEBC() {
    if (!progActual) return;
    const compania = document.getElementById('pg-compania')?.value || progActual.compania;
    if (!compania) { toast('Selecciona una empresa primero', 'error'); return; }
    if (!confirm('¿Aplicar las obligaciones EBC seleccionadas a esta programación?')) return;
    try {
      const r = await POST('/obligaciones-ebc/aplicar', { compania, progId: progActual._id });
      if (r.applied === 0) {
        toast('No hay obligaciones EBC seleccionadas para esta empresa', 'info');
      } else {
        toast(`✅ ${r.applied} obligación(es) EBC aplicada(s)`, 'success');
        const updated = await GET(`/pagos/programaciones/${progActual._id}`);
        progActual = updated;
        renderTablaYResumenes();
      }
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Enviar a aprobación ────────────────────────────────────────────
  async function pgEnviarAprobacion() {
    if (!progActual) return;
    const obs = progActual.obligaciones;
    const selecciones = obs.map(ob => ({ id: ob._id, seleccionado: ob.seleccionado }));
    try {
      await POST(`/pagos/programaciones/${progActual._id}/enviar-aprobacion`, { selecciones });
      progActual.estado = 'pendiente';
      const _fb = document.getElementById('pg-footer-btns'); if (_fb) _fb.style.display = 'none';
      toast('Programación enviada a aprobación', 'success');
    } catch(e) { toast(e.message, 'error'); }
  }
}

// ─── Paso 2: Aprobación ───────────────────────────────────────────
async function renderPaso2(container) {
  let ap2Prog      = null;
  let ap2Promedios = {};

  const rolP        = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');
  const puedeAprobar = ['aprobador','admin'].includes(rolP);

  const fmtF = d => d ? new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
  const fmtN = v => v == null ? '—' : Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});

  // ── Footer fijo ─────────────────────────────────────────────────
  let ap2Footer = document.getElementById('ap2-footer');
  if (!ap2Footer) {
    ap2Footer = document.createElement('div');
    ap2Footer.id = 'ap2-footer';
    ap2Footer.style.cssText = `
      position:fixed;bottom:0;left:220px;right:0;z-index:100;
      background:#fff;border-top:2px solid #e2e8f0;
      box-shadow:0 -4px 12px rgba(0,0,0,.08);
      display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap;
    `;
    document.body.appendChild(ap2Footer);
  }
  ap2Footer.style.display = 'flex';

  // ── HTML principal ───────────────────────────────────────────────
  container.innerHTML = `
    <div class="card mb-16" style="padding:14px">
      <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
          <select id="ap2-compania" class="form-control" style="width:150px">
            <option value="">— Seleccionar —</option>
            ${(S.user.role === 'ADMIN' || rolP === 'admin'
              ? ALL_SOCS_COMPRA
              : (S.user.sociedadesPago || [])
            ).map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Cambio (USD→S/)</label>
          <input id="ap2-tc" type="number" step="0.001" min="0" class="form-control"
                 style="width:90px;font-size:13px" value="3.700"
                 oninput="clearTimeout(window._ap2TC);window._ap2TC=setTimeout(ap2Refresh,300)">
        </div>
        <div style="margin-left:auto;align-self:flex-end;display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="ap2Expandir(0)" title="Contraer todo">▸ Contraer</button>
          <button class="btn btn-outline btn-sm" onclick="ap2Expandir(1)" title="Expandir hasta beneficiarios">≡ Beneficiarios</button>
          <button class="btn btn-outline btn-sm" onclick="ap2Expandir(2)" title="Expandir hasta obligaciones">≣ Obligaciones</button>
        </div>
      </div>
    </div>
    <div id="ap2-lista" class="mb-16"></div>
    <!-- Filtros (ocultos hasta abrir una programación) -->
    <div id="ap2-filtros" class="card mb-16" style="padding:12px;display:none">
      <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Tipo Documento</label>
          <select id="ap2-f-tipodoc" class="form-control" style="width:120px;font-size:12px" onchange="ap2Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">N° Documento</label>
          <input id="ap2-f-numdoc" class="form-control" style="width:160px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._ap2FT);window._ap2FT=setTimeout(ap2Filtrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Beneficiario</label>
          <input id="ap2-f-benef" class="form-control" style="width:180px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._ap2FT);window._ap2FT=setTimeout(ap2Filtrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Grupo</label>
          <select id="ap2-f-grupo" class="form-control" style="width:140px;font-size:12px" onchange="ap2Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Detalle Grupo</label>
          <select id="ap2-f-detalle" class="form-control" style="width:140px;font-size:12px" onchange="ap2Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div style="align-self:flex-end;padding-bottom:2px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" id="ap2-f-solo-sel" onchange="ap2Filtrar()"
                   style="width:14px;height:14px;accent-color:var(--primary)">
            Solo programadas
          </label>
        </div>
        <button class="btn btn-outline btn-sm" onclick="ap2LimpiarFiltros()">✕ Limpiar</button>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
      <button class="btn btn-outline btn-sm" onclick="imprimirVista('ap2-wrap','Paso 2 — Aprobación de Pagos')">🖨️ Imprimir</button>
      <button class="btn btn-outline btn-sm" onclick="exportarVistaExcel('ap2-wrap','paso2-aprobacion')">📥 Bajar a Excel</button>
    </div>
    <div id="ap2-wrap" style="padding-bottom:72px"></div>`;

  document.getElementById('ap2-compania').addEventListener('change', async () => {
    ap2Prog = null;
    document.getElementById('ap2-wrap').innerHTML = '';
    document.getElementById('ap2-filtros').style.display = 'none';
    ap2RenderFooter();
    await ap2CargarLista();
  });

  // ── Cargar lista de programaciones (pendientes + aprobadas [+ borrador para admin]) ──
  async function ap2CargarLista() {
    const comp = document.getElementById('ap2-compania').value;
    const el   = document.getElementById('ap2-lista');
    if (!comp) { el.innerHTML = ''; return; }
    const esAdmin = (S.user.role === 'ADMIN' || rolP === 'admin');
    let data;
    const [pend, apro] = await Promise.all([
      GET(`/pagos/programaciones?compania=${comp}&estado=pendiente`),
      GET(`/pagos/programaciones?compania=${comp}&estado=aprobado`),
    ]);
    data = [...pend, ...apro];
    if (!data.length) {
      el.innerHTML = `<p style="color:var(--text-muted);font-size:13px">No hay programaciones pendientes de aprobación en <strong>${esc(comp)}</strong>.</p>`;
      return;
    }
    const BADGES = {
      borrador:  `<span style="font-size:10px;background:#f1f5f9;color:#64748b;border-radius:3px;padding:1px 4px;margin-left:4px">📝 Borrador</span>`,
      pendiente: `<span style="font-size:10px;background:#fef9c3;color:#854d0e;border-radius:3px;padding:1px 4px;margin-left:4px">⏳ Pendiente</span>`,
      aprobado:  `<span style="font-size:10px;background:#bbf7d0;color:#15803d;border-radius:3px;padding:1px 4px;margin-left:4px">✅ Aprobada</span>`,
    };
    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px">
          Programaciones para revisión / aprobación
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${data.map(p => {
            const activo = ap2Prog?._id === p._id;
            const badge  = BADGES[p.estado] || '';
            return `<button class="btn btn-sm ap2-prog-btn" data-id="${p._id}"
              style="font-size:12px;${activo ? 'background:var(--primary);color:#fff;border-color:var(--primary)' : 'border:1px solid #cbd5e1;background:#fff'}">
              📋 Sem ${p.semana}/${p.año}&nbsp;&nbsp;${p.compania}${badge}
            </button>`;
          }).join('')}
        </div>
      </div>`;
    document.querySelectorAll('.ap2-prog-btn').forEach(btn =>
      btn.addEventListener('click', () => ap2AbrirProg(btn.dataset.id))
    );
  }

  // ── Filtros ──────────────────────────────────────────────────────
  function ap2ObsFiltradas() {
    if (!ap2Prog) return [];
    const fDoc  = document.getElementById('ap2-f-tipodoc')?.value || '';
    const fNum  = (document.getElementById('ap2-f-numdoc')?.value || '').toLowerCase();
    const fBen  = (document.getElementById('ap2-f-benef')?.value || '').toLowerCase();
    const fGrp  = document.getElementById('ap2-f-grupo')?.value || '';
    const fDet  = document.getElementById('ap2-f-detalle')?.value || '';
    const fSel  = document.getElementById('ap2-f-solo-sel')?.checked || false;
    return ap2Prog.obligaciones.filter(ob => {
      if (fDoc && ob.tipoDocumento !== fDoc) return false;
      if (fNum && !(ob.numeroDocumento||'').toLowerCase().includes(fNum)) return false;
      if (fBen && !(ob.pagarA||'').toLowerCase().includes(fBen)) return false;
      if (fGrp && ob.grupo !== fGrp) return false;
      if (fDet && ob.detalleGrupo !== fDet) return false;
      if (fSel && !ob.seleccionado) return false;
      return true;
    });
  }

  function ap2PoblarFiltros() {
    const obs    = ap2Prog?.obligaciones || [];
    const tipos  = [...new Set(obs.map(o => o.tipoDocumento).filter(Boolean))].sort();
    const grupos = [...new Set(obs.map(o => o.grupo).filter(Boolean))].sort();
    const dets   = [...new Set(obs.map(o => o.detalleGrupo).filter(Boolean))].sort();
    const el = id => document.getElementById(id);
    if (el('ap2-f-tipodoc')) el('ap2-f-tipodoc').innerHTML = '<option value="">Todos</option>' + tipos.map(t => `<option>${t}</option>`).join('');
    if (el('ap2-f-grupo'))   el('ap2-f-grupo').innerHTML   = '<option value="">Todos</option>' + grupos.map(g => `<option>${esc(g)}</option>`).join('');
    if (el('ap2-f-detalle')) el('ap2-f-detalle').innerHTML = '<option value="">Todos</option>' + dets.map(d => `<option>${esc(d)}</option>`).join('');
    document.getElementById('ap2-filtros').style.display = '';
  }

  // ── Abrir programación ───────────────────────────────────────────
  async function ap2AbrirProg(id) {
    try {
      ap2Prog      = await GET(`/pagos/programaciones/${id}`);
      ap2Promedios = ap2Prog.promediosPagos || {};
      await pgAdelantosResumen(ap2Prog.compania);
      ap2PoblarFiltros();
      ap2RenderGrupos();
      ap2RenderFooter();
      await ap2CargarLista(); // remarcar botón activo
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Guardar / restaurar estado de colapso ───────────────────────
  function ap2SaveState() {
    const grps = {}, obls = {};
    document.querySelectorAll('#ap2-wrap [id^="grp-"]').forEach(el => {
      grps[el.id] = el.style.display !== 'none';
    });
    document.querySelectorAll('#ap2-wrap .ap2-obl-div[data-ap2-ben]').forEach(el => {
      obls[el.dataset.ap2Ben] = el.style.display !== 'none';
    });
    return { grps, obls };
  }
  function ap2RestoreState({ grps, obls }) {
    document.querySelectorAll('#ap2-wrap [id^="grp-"]').forEach(el => {
      const open = grps[el.id] ?? false;
      el.style.display = open ? '' : 'none';
      const arr = el.closest('.card')?.querySelector('.ap2-arr');
      if (arr) arr.textContent = open ? '▾' : '▸';
    });
    document.querySelectorAll('#ap2-wrap .ap2-obl-div[data-ap2-ben]').forEach(el => {
      const open = obls[el.dataset.ap2Ben] ?? false;
      el.style.display = open ? '' : 'none';
      const arr = el.previousElementSibling?.querySelector('.ap2-ben-arr');
      if (arr) arr.textContent = open ? '▾' : '▸';
    });
  }

  // ── Vista agrupada: Grupo → Beneficiario → Obligaciones ─────────
  function ap2RenderGrupos() {
    if (!ap2Prog) { document.getElementById('ap2-wrap').innerHTML = ''; return; }
    const tc     = parseFloat(document.getElementById('ap2-tc')?.value) || 1;
    const toS    = ob => ob.moneda !== 'LO' ? ob.monto * tc : ob.monto;
    const obsVis = ap2ObsFiltradas();

    // Agrupar SOLO las visibles (para mostrar en el árbol)
    const grupos = {};
    obsVis.forEach(ob => {
      const g = ob.grupo || 'OTROS';
      const b = ob.pagarA || '—';
      if (!grupos[g]) grupos[g] = {};
      if (!grupos[g][b]) grupos[g][b] = [];
      grupos[g][b].push(ob);
    });

    // Totales usando TODAS las obligaciones del prog (no solo filtradas)
    const allObs = ap2Prog.obligaciones;
    const benTotales = ben => {
      const sel = allObs.filter(o => (o.pagarA||'') === ben && o.seleccionado);
      const usd = sel.filter(o => o.moneda !== 'LO').reduce((s,o) => s + o.monto, 0);
      const sol = sel.filter(o => o.moneda === 'LO').reduce((s,o) => s + o.monto, 0);
      return { usd, sol, tot: sol + usd * tc };
    };
    const benDeuda = ben => {
      const obs = allObs.filter(o => (o.pagarA||'') === ben);
      return {
        usd: obs.filter(o => o.moneda !== 'LO').reduce((s,o) => s + o.monto, 0),
        sol: obs.filter(o => o.moneda === 'LO').reduce((s,o) => s + o.monto, 0)
      };
    };
    const grpDeuda = grp => {
      const obs = allObs.filter(o => (o.grupo || 'OTROS') === grp);
      return {
        usd: obs.filter(o => o.moneda !== 'LO').reduce((s,o) => s + o.monto, 0),
        sol: obs.filter(o => o.moneda === 'LO').reduce((s,o) => s + o.monto, 0)
      };
    };
    const grpTotales = grp => {
      const sel = allObs.filter(o => (o.grupo || 'OTROS') === grp && o.seleccionado);
      const usd = sel.filter(o => o.moneda !== 'LO').reduce((s,o) => s + o.monto, 0);
      const sol = sel.filter(o => o.moneda === 'LO').reduce((s,o) => s + o.monto, 0);
      return { usd, sol, tot: sol + usd * tc };
    };

    const fmtV = v => v ? fmtN(v) : '<span style="color:#cbd5e1">—</span>';

    // Ordenar grupos de mayor a menor por total programado
    const grpsOrden = Object.keys(grupos).sort((a, b) => grpTotales(b).tot - grpTotales(a).tot);

    const COLS = '16px minmax(120px,1fr) 82px 82px 82px 82px 90px 75px';

    let html = '';
    grpsOrden.forEach(grp => {
      const bens  = grupos[grp];
      const gTot  = grpTotales(grp);
      const gDeuda = grpDeuda(grp);
      const grpId = 'grp-' + grp.replace(/\W/g,'_');

      html += `
      <div class="card mb-8" style="padding:0;overflow:hidden">
        <div onclick="const b=document.getElementById('${grpId}');const open=b.style.display!=='none';b.style.display=open?'none':'';this.querySelector('.ap2-arr').textContent=open?'▸':'▾'"
             style="display:grid;grid-template-columns:${COLS};align-items:center;
                    padding:8px 14px 8px 8px;background:var(--bg-secondary);
                    border-bottom:2px solid var(--primary);cursor:pointer;user-select:none">
          <span class="ap2-arr" style="font-size:11px;color:var(--text-muted)">▸</span>
          <span style="font-weight:700;font-size:13px;color:var(--primary)">📁 ${esc(grp)}</span>
          <div style="text-align:right;font-size:11px;color:var(--text-muted)">${fmtV(gDeuda.sol)}</div>
          <div style="text-align:right;font-size:11px;color:var(--text-muted)">${fmtV(gDeuda.usd)}</div>
          <div style="text-align:right;font-size:11px">${fmtV(gTot.sol)}</div>
          <div style="text-align:right;font-size:11px">${fmtV(gTot.usd)}</div>
          <div style="text-align:right;font-size:12px;font-weight:700;color:var(--primary)">${fmtN(gTot.tot)}</div>
          <div></div>
        </div>
        <div id="${grpId}" style="display:none">
          <!-- Cabecera de columnas -->
          <div style="display:grid;grid-template-columns:${COLS};
                      align-items:center;padding:4px 14px 4px 8px;
                      background:#f1f5f9;border-bottom:1px solid #e2e8f0;
                      font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">
            <div></div>
            <div>Beneficiario</div>
            <div style="text-align:right">Deuda S/</div>
            <div style="text-align:right">Deuda USD</div>
            <div style="text-align:right">Prog. S/</div>
            <div style="text-align:right">Prog. USD</div>
            <div style="text-align:right">Total S/</div>
            <div style="text-align:right">Prom. pagos</div>
          </div>`;

      // Ordenar beneficiarios de mayor a menor por total programado
      const bensOrden = Object.keys(bens).sort((a, b) => benTotales(b).tot - benTotales(a).tot);

      bensOrden.forEach(ben => {
        const oblList = bens[ben];
        const benKey  = ben.toUpperCase().replace(/"/g,'&quot;');
        const bTot    = benTotales(ben);
        const bDeuda  = benDeuda(ben);
        const prom    = ap2Promedios[ben.toUpperCase()];
        const benMon  = bDeuda.usd > 0 ? 'USD' : 'S/';
        const promStr = prom?.promedio != null ? `${benMon} ${fmtN(prom.promedio)}` : '—';

        html += `
        <div style="border-bottom:1px solid #f1f5f9">
          <div class="ap2-ben-row" onclick="ap2ToggleBenObl(this)"
               style="display:grid;grid-template-columns:${COLS};
                      align-items:center;padding:5px 14px 5px 16px;
                      background:#fafbfc;cursor:pointer;user-select:none;${pgAdelantoRowStyle(ben)}">
            <span class="ap2-ben-arr" style="font-size:10px;color:var(--text-muted)">▸</span>
            <div style="display:flex;align-items:center;gap:4px;overflow:hidden">
              <span style="font-weight:600;font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(ben)}</span>
              ${pgAdelantoBadgeHtml(ben)}
            </div>
            <div style="text-align:right;font-size:11px">${fmtV(bDeuda.sol)}</div>
            <div style="text-align:right;font-size:11px">${fmtV(bDeuda.usd)}</div>
            <div style="text-align:right;font-size:11px">${fmtV(bTot.sol)}</div>
            <div style="text-align:right;font-size:11px">${fmtV(bTot.usd)}</div>
            <div style="text-align:right;font-size:12px;font-weight:700;color:var(--primary)">${fmtN(bTot.tot)}</div>
            <div style="text-align:right;font-size:11px;color:#7c3aed;font-weight:600">${promStr}</div>
          </div>
          <div class="ap2-obl-div" data-ap2-ben="${benKey}" style="display:none">
            <table style="width:auto;border-collapse:collapse;font-size:11px">
              <thead>
                <tr style="background:#f8fafc;color:var(--text-muted)">
                  <th style="width:26px;padding:2px 4px 2px 24px"></th>
                  <th style="padding:2px 4px;text-align:left">Tipo</th>
                  <th style="padding:2px 4px;text-align:left">N° Documento</th>
                  <th style="padding:2px 4px;text-align:left">F. Documento</th>
                  <th style="padding:2px 4px;text-align:left">F. Vencimiento</th>
                  <th style="padding:2px 4px;text-align:right">Mon.</th>
                  <th style="padding:2px 4px;text-align:right">Monto</th>
                  <th style="padding:2px 4px;text-align:right">Días Venc.</th>
                  <th style="padding:2px 4px;text-align:left">Banco</th>
                </tr>
              </thead>
              <tbody>
                ${oblList.map(ob => {
                  const dias  = ob.diasVencido ?? 0;
                  const dCol  = dias > 0 ? '#dc2626' : dias === 0 ? '#d97706' : '#166534';
                  return `
                  <tr style="border-top:1px solid #f1f5f9;background:${ob.seleccionado?'#bbf7d0':''}" id="ap2-tr-${ob._id}">
                    <td style="padding:2px 4px 2px 24px">
                      <input type="checkbox" data-id="${ob._id}" data-ben="${benKey}"
                             class="ap2-ob-cb" ${ob.seleccionado ? 'checked' : ''}
                             style="width:12px;height:12px;accent-color:var(--primary);cursor:pointer"
                             onchange="ap2ToggleOb('${ob._id}','${benKey}',this.checked)">
                    </td>
                    <td style="padding:2px 4px">${esc(ob.tipoDocumento||'')}</td>
                    <td style="padding:2px 4px">${esc(ob.numeroDocumento||'')}${ob.origenEBC ? `<span style="font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;display:inline-block;margin-left:4px">📋 EBC</span>` : ''}</td>
                    <td style="padding:2px 4px;white-space:nowrap">${fmtF(ob.fechaDocumento)}</td>
                    <td style="padding:2px 4px;white-space:nowrap">${fmtF(ob.fechaVencimiento)}</td>
                    <td style="padding:2px 4px;text-align:right">${esc(ob.moneda||'')}</td>
                    <td style="padding:2px 4px;text-align:right;${ob.monto<0?'color:#dc2626':''}">${fmtN(ob.monto)}</td>
                    <td style="padding:2px 4px;text-align:right;color:${dCol};font-weight:600">${dias}</td>
                    <td style="padding:2px 4px">${esc(ob.banco||'')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      });

      html += `</div></div>`;
    });

    document.getElementById('ap2-wrap').innerHTML = html ||
      '<p style="color:var(--text-muted);font-size:13px;padding:12px">Sin obligaciones que coincidan con los filtros.</p>';
  }

  // ── Footer con totales y botones ─────────────────────────────────
  function ap2RenderFooter() {
    const obs    = (ap2Prog?.obligaciones || []).filter(o => o.seleccionado);
    const tc     = parseFloat(document.getElementById('ap2-tc')?.value) || 1;
    const totUSD = obs.filter(o => o.moneda !== 'LO').reduce((s,o) => s + o.monto, 0);
    const totSOL = obs.filter(o => o.moneda === 'LO').reduce((s,o) => s + o.monto, 0);
    const totTot = totSOL + totUSD * tc;

    ap2Footer.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted)">
        Programadas:&nbsp;<strong style="color:#111">${obs.length}</strong>
      </div>
      <div style="width:1px;height:20px;background:#e2e8f0"></div>
      ${totUSD ? `<div style="font-size:13px">USD&nbsp;<strong>${fmtN(totUSD)}</strong></div>` : ''}
      ${totSOL ? `<div style="font-size:13px">S/&nbsp;<strong>${fmtN(totSOL)}</strong></div>` : ''}
      ${totUSD && totSOL ? `<div style="width:1px;height:20px;background:#e2e8f0"></div>` : ''}
      <div style="font-size:13px">Todo en S/:&nbsp;<strong style="color:var(--primary);font-size:14px">${fmtN(totTot)}</strong></div>
      ${ap2Prog ? `
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          ${ap2Prog.estado === 'aprobado'
            ? `<span style="font-size:11px;background:#bbf7d0;color:#15803d;border-radius:4px;padding:2px 8px;font-weight:600">✅ Aprobada</span>`
            : ''}
          ${['borrador','pendiente'].includes(ap2Prog.estado) ? `
            <button class="btn btn-outline btn-sm" onclick="ap2AplicarEBC()">📋 Aplicar EBC</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="ap2Guardar()">💾 Guardar</button>
          ${puedeAprobar && ap2Prog.estado !== 'aprobado' ? `
            <button class="btn btn-primary btn-sm" onclick="ap2Aprobar()"
                    style="background:#16a34a;border-color:#16a34a">✅ Aprobar</button>` : ''}
          ${puedeAprobar && ap2Prog.estado === 'aprobado' ? `
            <button class="btn btn-sm" onclick="ap2Desaprobar()"
                    style="border:1px solid #f59e0b;color:#b45309;background:#fffbeb">↩️ Desaprobar</button>` : ''}
          ${(ap2Prog.estado !== 'aprobado' || S.user.role === 'ADMIN') ? `
            <button class="btn btn-sm" onclick="ap2Eliminar()"
                    style="border:1px solid #dc2626;color:#dc2626;background:#fff">🗑️ Eliminar</button>` : ''}
        </div>` : ''}`;
  }

  // ── Funciones globales ───────────────────────────────────────────
  window.ap2Refresh   = () => { ap2RenderGrupos(); ap2RenderFooter(); };
  window.ap2Filtrar   = () => { ap2RenderGrupos(); ap2RenderFooter(); };
  window.ap2LimpiarFiltros = () => {
    ['ap2-f-tipodoc','ap2-f-numdoc','ap2-f-benef','ap2-f-grupo','ap2-f-detalle'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const chk = document.getElementById('ap2-f-solo-sel');
    if (chk) chk.checked = false;
    ap2RenderGrupos(); ap2RenderFooter();
  };

  // Toggle solo la tabla de obligaciones de un beneficiario (clic en fila ben-row)
  window.ap2ToggleBenObl = function(benRow) {
    const oblDiv = benRow.nextElementSibling;
    if (!oblDiv || !oblDiv.classList.contains('ap2-obl-div')) return;
    const open = oblDiv.style.display !== 'none';
    oblDiv.style.display = open ? 'none' : '';
    const arr = benRow.querySelector('.ap2-ben-arr');
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  // Expandir a 3 niveles: 0=contraer grupos, 1=grupos abiertos+obls cerradas, 2=todo abierto
  window.ap2Expandir = function(nivel) {
    // Cuerpos de grupo
    document.querySelectorAll('#ap2-wrap [id^="grp-"]').forEach(b => {
      b.style.display = nivel === 0 ? 'none' : '';
      const arr = b.closest('.card')?.querySelector('.ap2-arr');
      if (arr) arr.textContent = nivel === 0 ? '▸' : '▾';
    });
    // Divs de obligaciones
    document.querySelectorAll('#ap2-wrap .ap2-obl-div').forEach(d => {
      d.style.display = nivel >= 2 ? '' : 'none';
      const arr = d.previousElementSibling?.querySelector('.ap2-ben-arr');
      if (arr) arr.textContent = nivel >= 2 ? '▾' : '▸';
    });
  };

  window.ap2ToggleOb = function(id, benKey, val) {
    const ob = ap2Prog?.obligaciones.find(o => String(o._id) === id);
    if (!ob) return;
    ob.seleccionado = val;
    const state = ap2SaveState();
    ap2RenderGrupos();
    ap2RestoreState(state);
    ap2RenderFooter();
  };

  window.ap2ToggleBen = function(benKey, val) {
    if (!ap2Prog) return;
    ap2Prog.obligaciones.forEach(ob => {
      if ((ob.pagarA||'').toUpperCase() === benKey) ob.seleccionado = val;
    });
    const state = ap2SaveState();
    ap2RenderGrupos();
    ap2RestoreState(state);
    ap2RenderFooter();
  };

  window.ap2AplicarEBC = async function() {
    if (!ap2Prog) return;
    const compania = ap2Prog.compania;
    if (!confirm('¿Aplicar las obligaciones EBC seleccionadas a esta programación?')) return;
    try {
      const r = await POST('/obligaciones-ebc/aplicar', { compania, progId: ap2Prog._id });
      if (r.applied === 0) {
        toast('No hay obligaciones EBC seleccionadas para esta empresa', 'info');
      } else {
        toast(`✅ ${r.applied} obligación(es) EBC aplicada(s)`, 'success');
        const updated = await GET(`/pagos/programaciones/${ap2Prog._id}`);
        ap2Prog = updated;
        ap2RenderGrupos();
        ap2RenderFooter();
      }
    } catch(e) { toast(e.message, 'error'); }
  };

  window.ap2Guardar = async function() {
    if (!ap2Prog) return;
    const selecciones = ap2Prog.obligaciones.map(ob => ({ id: ob._id, seleccionado: ob.seleccionado }));
    try {
      await PUT(`/pagos/programaciones/${ap2Prog._id}/guardar`, { selecciones });
      toast('Programación guardada', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };

  window.ap2Aprobar = async function() {
    if (!ap2Prog) return;
    const n = ap2Prog.obligaciones.filter(o => o.seleccionado).length;
    if (!confirm(`¿Aprobar esta programación con ${n} obligaciones programadas?\nUna vez aprobada, el programador no podrá modificarla.`)) return;
    const selecciones = ap2Prog.obligaciones.map(ob => ({ id: ob._id, seleccionado: ob.seleccionado }));
    try {
      await PUT(`/pagos/programaciones/${ap2Prog._id}/aprobar`, { selecciones });
      toast('✅ Programación aprobada', 'success');
      ap2Prog = null;
      document.getElementById('ap2-wrap').innerHTML = '';
      document.getElementById('ap2-filtros').style.display = 'none';
      ap2RenderFooter();
      await ap2CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  window.ap2Desaprobar = async function() {
    if (!ap2Prog) return;
    if (!confirm('¿Desaprobar esta programación? Volverá al estado "Pendiente" para revisión.')) return;
    try {
      await PUT(`/pagos/programaciones/${ap2Prog._id}/desaprobar`, {});
      toast('↩️ Programación desaprobada', 'success');
      ap2Prog.estado = 'pendiente';
      ap2RenderFooter();
      await ap2CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  window.ap2Eliminar = async function() {
    if (!ap2Prog) return;
    if (!confirm('¿Eliminar esta programación? Esta acción no se puede deshacer.')) return;
    try {
      await DEL(`/pagos/programaciones/${ap2Prog._id}`);
      toast('Programación eliminada', 'success');
      ap2Prog = null;
      document.getElementById('ap2-wrap').innerHTML = '';
      document.getElementById('ap2-filtros').style.display = 'none';
      ap2RenderFooter();
      await ap2CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  // Init
  ap2RenderFooter();
}

// ─── Paso 3: Preparación de Pagos ────────────────────────────────
async function renderPaso3(container) {
  let p3Prog      = null;
  let p3Bancos    = [];

  const rolP        = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');
  const puedePagar  = ['pagador','admin'].includes(rolP);
  const esAdmin     = (S.user.role === 'ADMIN' || rolP === 'admin');

  const fmtN = v => v == null ? '—' : Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtF = d => d ? new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';

  // Footer fijo
  let p3Footer = document.getElementById('ap3-footer');
  if (!p3Footer) {
    p3Footer = document.createElement('div');
    p3Footer.id = 'ap3-footer';
    p3Footer.style.cssText = `
      position:fixed;bottom:0;left:220px;right:0;z-index:100;
      background:#fff;border-top:2px solid #e2e8f0;
      box-shadow:0 -4px 12px rgba(0,0,0,.08);
      display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap;
    `;
    document.body.appendChild(p3Footer);
  }
  p3Footer.style.display = 'flex';

  // Cargar bancos
  p3Bancos = await GET('/pagos/bancos');

  // ── HTML principal ───────────────────────────────────────────────
  container.innerHTML = `
    <div class="card mb-16" style="padding:14px">
      <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
          <select id="p3-compania" class="form-control" style="width:150px">
            <option value="">— Seleccionar —</option>
            ${(esAdmin ? ALL_SOCS_COMPRA : (S.user.sociedadesPago || []))
              .map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Cambio (USD→S/)</label>
          <input id="p3-tc" type="number" step="0.001" min="0" class="form-control"
                 style="width:90px;font-size:13px" value="3.700"
                 oninput="clearTimeout(window._p3TC);window._p3TC=setTimeout(p3Refresh,300)">
        </div>
        <div style="margin-left:auto;align-self:flex-end;display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="p3Expandir(0)" title="Contraer todo">▸ Contraer</button>
          <button class="btn btn-outline btn-sm" onclick="p3Expandir(1)" title="Expandir obligaciones">≣ Obligaciones</button>
        </div>
      </div>
    </div>
    <div id="p3-lista" class="mb-16"></div>
    <!-- Filtros -->
    <div id="p3-filtros" class="card mb-16" style="padding:12px;display:none">
      <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Tipo Documento</label>
          <select id="p3-f-tipodoc" class="form-control" style="width:120px;font-size:12px" onchange="p3Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">N° Documento</label>
          <input id="p3-f-numdoc" class="form-control" style="width:160px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._p3FT);window._p3FT=setTimeout(p3Filtrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Beneficiario</label>
          <input id="p3-f-benef" class="form-control" style="width:180px;font-size:12px" placeholder="Buscar..."
                 oninput="clearTimeout(window._p3FT);window._p3FT=setTimeout(p3Filtrar,320)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Grupo</label>
          <select id="p3-f-grupo" class="form-control" style="width:140px;font-size:12px" onchange="p3Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Banco Asignado</label>
          <select id="p3-f-banco" class="form-control" style="width:140px;font-size:12px" onchange="p3Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Agrupador</label>
          <select id="p3-f-agrup" class="form-control" style="width:140px;font-size:12px" onchange="p3Filtrar()">
            <option value="">Todos</option>
          </select>
        </div>
        <button class="btn btn-outline btn-sm" onclick="p3LimpiarFiltros()">✕ Limpiar</button>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
      <button class="btn btn-outline btn-sm" onclick="imprimirVista('p3-wrap','Paso 3 — Preparación de Pagos')">🖨️ Imprimir</button>
      <button class="btn btn-outline btn-sm" onclick="p3ExportarExcel()">📥 Bajar a Excel</button>
    </div>
    <div id="p3-wrap" style="padding-bottom:120px"></div>`;

  // Evento selector de sociedad
  document.getElementById('p3-compania').addEventListener('change', async () => {
    p3Prog = null;
    document.getElementById('p3-wrap').innerHTML = '';
    document.getElementById('p3-filtros').style.display = 'none';
    p3RenderFooter();
    await p3CargarLista();
  });

  // ── Cargar lista ─────────────────────────────────────────────────
  async function p3CargarLista() {
    const comp = document.getElementById('p3-compania').value;
    const el   = document.getElementById('p3-lista');
    if (!comp) { el.innerHTML = ''; return; }
    // Paso 3 ve aprobado (confirmado en Paso 2) + preparado (ya procesado aquí)
    const [apro, prep] = await Promise.all([
      GET(`/pagos/programaciones?compania=${comp}&estado=aprobado`),
      GET(`/pagos/programaciones?compania=${comp}&estado=preparado`),
    ]);
    const data = [...apro, ...prep];
    if (!data.length) {
      el.innerHTML = `<p style="color:var(--text-muted);font-size:13px">No hay programaciones aprobadas para preparar en <strong>${esc(comp)}</strong>.</p>`;
      return;
    }
    const BADGES = {
      aprobado:  `<span style="font-size:10px;background:#bbf7d0;color:#15803d;border-radius:3px;padding:1px 4px;margin-left:4px">✅ Aprobada</span>`,
      preparado: `<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 4px;margin-left:4px">🏦 Preparada</span>`,
    };
    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px">
          Programaciones para preparación de pagos
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${data.map(p => {
            const activo = p3Prog?._id === p._id;
            const badge  = BADGES[p.estado] || '';
            return `<button class="btn btn-sm p3-prog-btn" data-id="${p._id}"
              style="font-size:12px;${activo ? 'background:var(--primary);color:#fff;border-color:var(--primary)' : 'border:1px solid #cbd5e1;background:#fff'}">
              📋 Sem ${p.semana}/${p.año}&nbsp;&nbsp;${p.compania}${badge}
            </button>`;
          }).join('')}
        </div>
      </div>`;
    document.querySelectorAll('.p3-prog-btn').forEach(btn =>
      btn.addEventListener('click', () => p3AbrirProg(btn.dataset.id))
    );
  }

  // ── Abrir programación ───────────────────────────────────────────
  async function p3AbrirProg(id) {
    try {
      p3Prog = await GET(`/pagos/programaciones/${id}`);
      await pgAdelantosResumen(p3Prog.compania);

      // Pre-cargar defaults de banco/agrupador para obligaciones sin asignar
      const comp = p3Prog.compania;
      const bens = await GET(`/pagos/beneficiarios?compania=${encodeURIComponent(comp)}`);
      const defMap = {}; // nombre.upper → { bancoDefault, agrupadorDefault }
      bens.forEach(b => {
        defMap[b.nombre.toUpperCase()] = {
          banco:    b.bancoDefault    || '',
          agrupador: b.agrupadorDefault || 'INDIVIDUAL',
        };
      });
      p3Prog.obligaciones.forEach(ob => {
        if (!ob.seleccionado) return;
        const key = (ob.pagarA || '').toUpperCase();
        const def = defMap[key];
        if (!ob.bancoAsignado)
          ob.bancoAsignado = (def?.banco) || 'BBVA';
        if (!ob.agrupadorPago || ob.agrupadorPago === 'INDIVIDUAL') {
          if (def?.agrupador && def.agrupador !== 'INDIVIDUAL')
            ob.agrupadorPago = def.agrupador;
        }
      });

      p3ObsConError = new Set(); // limpiar errores al abrir programación
      p3CustomAgrups = [];       // limpiar agrupadores custom de la sesión anterior
      p3PoblarFiltros();
      p3RenderGrupos();
      p3RenderFooter();
      await p3CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Filtros ──────────────────────────────────────────────────────
  function p3ObsFiltradas() {
    if (!p3Prog) return [];
    const fDoc   = document.getElementById('p3-f-tipodoc')?.value || '';
    const fNum   = (document.getElementById('p3-f-numdoc')?.value || '').toLowerCase();
    const fBen   = (document.getElementById('p3-f-benef')?.value || '').toLowerCase();
    const fGrp   = document.getElementById('p3-f-grupo')?.value || '';
    const fBanco = document.getElementById('p3-f-banco')?.value || '';
    const fAgrup = document.getElementById('p3-f-agrup')?.value || '';
    return (p3Prog.obligaciones || []).filter(ob => {
      if (!ob.seleccionado) return false; // solo programadas
      if (fDoc   && ob.tipoDocumento !== fDoc) return false;
      if (fNum   && !(ob.numeroDocumento||'').toLowerCase().includes(fNum)) return false;
      if (fBen   && !(ob.pagarA||'').toLowerCase().includes(fBen)) return false;
      if (fGrp   && ob.grupo !== fGrp) return false;
      if (fBanco && (ob.bancoAsignado||'') !== fBanco) return false;
      if (fAgrup && (ob.agrupadorPago||'INDIVIDUAL') !== fAgrup) return false;
      return true;
    });
  }

  function p3PoblarFiltros() {
    const obs    = (p3Prog?.obligaciones || []).filter(o => o.seleccionado);
    const tipos  = [...new Set(obs.map(o => o.tipoDocumento).filter(Boolean))].sort();
    const grupos = [...new Set(obs.map(o => o.grupo).filter(Boolean))].sort();
    const bancos = [...new Set(obs.map(o => o.bancoAsignado).filter(Boolean))].sort();
    const agrups = [...new Set(obs.map(o => o.agrupadorPago||'INDIVIDUAL'))].sort();
    const el = id => document.getElementById(id);
    if (el('p3-f-tipodoc')) el('p3-f-tipodoc').innerHTML = '<option value="">Todos</option>' + tipos.map(t => `<option>${t}</option>`).join('');
    if (el('p3-f-grupo'))   el('p3-f-grupo').innerHTML   = '<option value="">Todos</option>' + grupos.map(g => `<option>${esc(g)}</option>`).join('');
    if (el('p3-f-banco'))   el('p3-f-banco').innerHTML   = '<option value="">Todos</option>' + bancos.map(b => `<option>${esc(b)}</option>`).join('');
    if (el('p3-f-agrup'))   el('p3-f-agrup').innerHTML   = '<option value="">Todos</option>' + agrups.map(a => `<option>${esc(a)}</option>`).join('');
    document.getElementById('p3-filtros').style.display = '';
  }

  function p3ActualizarFiltroAgrups() {
    const el = document.getElementById('p3-f-agrup');
    if (!el) return;
    const cur    = el.value;
    const obs    = (p3Prog?.obligaciones || []).filter(o => o.seleccionado);
    const agrups = [...new Set(obs.map(o => o.agrupadorPago || 'INDIVIDUAL'))].sort();
    el.innerHTML = '<option value="">Todos</option>' +
      agrups.map(a => `<option value="${esc(a)}"${a === cur ? ' selected' : ''}>${esc(a)}</option>`).join('');
  }

  // ── Guardar / restaurar estado de colapso ───────────────────────
  function p3SaveState() {
    const grps = {}, obls = {};
    document.querySelectorAll('#p3-wrap [id^="p3grp-"]').forEach(el => {
      grps[el.id] = el.style.display !== 'none';
    });
    document.querySelectorAll('#p3-wrap .p3-obl-div[data-p3-ben]').forEach(el => {
      obls[el.dataset.p3Ben] = el.style.display !== 'none';
    });
    return { grps, obls };
  }
  function p3RestoreState({ grps, obls }) {
    document.querySelectorAll('#p3-wrap [id^="p3grp-"]').forEach(el => {
      const open = grps[el.id] ?? false;
      el.style.display = open ? '' : 'none';
      const arr = el.closest('.card')?.querySelector('.p3-arr');
      if (arr) arr.textContent = open ? '▾' : '▸';
    });
    document.querySelectorAll('#p3-wrap .p3-obl-div[data-p3-ben]').forEach(el => {
      const open = obls[el.dataset.p3Ben] ?? false;
      el.style.display = open ? '' : 'none';
      const arr = el.previousElementSibling?.querySelector('.p3-ben-arr');
      if (arr) arr.textContent = open ? '▾' : '▸';
    });
  }

  // ── Agrupadores fijos + custom para esta programación ───────────
  const AGRUPS_FIJOS = ['INDIVIDUAL','BBVA PEN','BBVA PEN OB','BCP PEN','BCP PEN OB','IBK PEN','IBK PEN OB',
                        'BBVA DOL','BBVA DOL OB','BCP DOL','BCP DOL OB','IBK DOL','IBK DOL OB',
                        'DETRACCIONES PEN','DETRACCIONES DOL'];
  let p3CustomAgrups = []; // nombres extra añadidos en esta sesión
  let p3ObsConError  = new Set(); // IDs de obligaciones con error de validación

  function p3AgrupOpts(selVal) {
    const extra = p3CustomAgrups.filter(a => !AGRUPS_FIJOS.includes(a));
    const todos = [...AGRUPS_FIJOS, ...extra];
    const ph = !selVal
      ? `<option value="" selected>— Agrupador —</option>`
      : `<option value="">— Agrupador —</option>`;
    return ph + todos.map(a =>
      `<option value="${esc(a)}" ${a === selVal ? 'selected' : ''}>${esc(a)}</option>`
    ).join('') + `<option value="__nuevo__">＋ Nuevo agrupador...</option>`;
  }

  // ── Validar todas las agrupaciones (llamar al guardar / preparar) ──
  function p3ValidarTodo() {
    // Devuelve { ok, obIds (Set), mensajes[] }
    const allObs = (p3Prog?.obligaciones || []).filter(o => o.seleccionado);
    const errIds  = new Set();
    const msgs    = [];

    // Agrupar por agrupadorPago, excluir INDIVIDUAL
    const byAgrup = {};
    allObs.forEach(ob => {
      const ag = ob.agrupadorPago || 'INDIVIDUAL';
      if (ag === 'INDIVIDUAL') return;
      if (!byAgrup[ag]) byAgrup[ag] = [];
      byAgrup[ag].push(ob);
    });

    Object.entries(byAgrup).forEach(([agrup, obs]) => {
      // Consistencia de moneda
      const monedas = [...new Set(obs.map(o => o.moneda === 'LO' ? 'S/' : 'USD'))];
      if (monedas.length > 1) {
        obs.forEach(o => errIds.add(String(o._id)));
        msgs.push(`Agrupador "${agrup}": mezcla de monedas (${monedas.join(' y ')}). Solo INDIVIDUAL puede tener monedas mixtas.`);
      }

      // Consistencia de banco
      const bancos = [...new Set(obs.map(o => o.bancoAsignado || '').filter(Boolean))];
      if (bancos.length > 1) {
        obs.forEach(o => errIds.add(String(o._id)));
        msgs.push(`Agrupador "${agrup}": mezcla de bancos (${bancos.join(', ')}). Un agrupado solo puede tener un banco.`);
      }
    });

    // Sin banco → observaciones obligatorio
    const sinBancoSinObs = allObs.filter(o => !o.bancoAsignado && !(o.observaciones||'').trim());
    sinBancoSinObs.forEach(o => errIds.add(String(o._id)));
    if (sinBancoSinObs.length)
      msgs.push(`${sinBancoSinObs.length} obligación(es) sin banco asignado requieren Observaciones.`);

    return { ok: errIds.size === 0, obIds: errIds, mensajes: msgs };
  }

  // ── Render lista plana por beneficiario ─────────────────────────
  function p3RenderGrupos() {
    const wrap = document.getElementById('p3-wrap');
    if (!p3Prog) { wrap.innerHTML = ''; return; }
    p3ActualizarFiltroAgrups();
    const tc  = parseFloat(document.getElementById('p3-tc')?.value) || 1;
    const obs = p3ObsFiltradas();
    const allObs = (p3Prog.obligaciones || []).filter(o => o.seleccionado);

    // Sincronizar custom agrupadores existentes en la programación
    allObs.forEach(o => {
      const ag = o.agrupadorPago || 'INDIVIDUAL';
      if (!AGRUPS_FIJOS.includes(ag) && !p3CustomAgrups.includes(ag)) p3CustomAgrups.push(ag);
    });

    // Agrupar por beneficiario + moneda (SOL / USD)
    const bens = {};
    obs.forEach(ob => {
      const b    = ob.pagarA || '(sin beneficiario)';
      const mcat = ob.moneda === 'LO' ? 'SOL' : 'USD';
      const key  = `${b}|||${mcat}`;
      if (!bens[key]) bens[key] = { ben: b, mcat, list: [] };
      bens[key].list.push(ob);
    });
    const benCurrCount = {};
    Object.values(bens).forEach(({ ben }) => { benCurrCount[ben] = (benCurrCount[ben] || 0) + 1; });

    const neto = o => o.monto - (o.retencion || 0);
    const monStr = (oblList, mcat) => {
      const total = oblList.reduce((s,o) => s + neto(o), 0);
      return mcat === 'SOL' ? `S/&nbsp;${fmtN(total)}` : `USD&nbsp;${fmtN(total)}`;
    };

    // Select de banco
    const bancosOpts = (sel) =>
      `<option value="">— Banco —</option>` +
      p3Bancos.filter(b => b.activo).map(b =>
        `<option value="${esc(b.nombre)}" ${b.nombre === sel ? 'selected' : ''}>${esc(b.nombre)}</option>`
      ).join('');

    const COLS = 'grid-template-columns:26px minmax(150px,250px) 170px 150px 170px;gap:0 12px';

    let html = `
    <div class="card mb-8" style="padding:0;overflow:hidden">
      <div style="display:grid;${COLS};
                  align-items:center;padding:5px 14px 5px 18px;
                  background:#f1f5f9;border-bottom:1px solid #e2e8f0;
                  font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">
        <div></div>
        <div>Beneficiario</div>
        <div style="text-align:right">Programado</div>
        <div style="text-align:center">Banco</div>
        <div style="text-align:center">Agrupador de Pago</div>
      </div>`;

    const benGroupKeys = Object.keys(bens).sort((a, b) => {
      const ai = a.indexOf('|||'), bi2 = b.indexOf('|||');
      const nc = a.substring(0, ai).localeCompare(b.substring(0, bi2));
      return nc !== 0 ? nc : (a.substring(ai + 3) === 'SOL' ? -1 : 1);
    });

    benGroupKeys.forEach(groupKey => {
      const { ben, mcat, list: oblList } = bens[groupKey];
      const benKey   = (ben.toUpperCase() + '|||' + mcat)
                        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      const progMon  = monStr(oblList, mcat);
      const showMcat = benCurrCount[ben] > 1;
      const mcatBadge = showMcat
        ? ` <span style="font-size:10px;font-weight:400;color:#64748b;background:#f1f5f9;border-radius:3px;padding:1px 4px">${mcat}</span>`
        : '';
      const benObsList = allObs.filter(o =>
        (o.pagarA||'').toUpperCase() === ben.toUpperCase() &&
        (o.moneda === 'LO' ? 'SOL' : 'USD') === mcat
      );
      const benBancos = [...new Set(benObsList.map(o => o.bancoAsignado || ''))];
      const benAgrups = [...new Set(benObsList.map(o => o.agrupadorPago || 'INDIVIDUAL'))];
      const curBanco = benBancos.length === 1 ? benBancos[0] : '';
      const curAgrup = benAgrups.length === 1 ? benAgrups[0] : '';
      const benConError = p3ObsConError.size > 0 && benObsList.some(o => p3ObsConError.has(String(o._id)));

      html += `
      <div style="border-bottom:1px solid #f1f5f9">
        <div class="p3-ben-row" onclick="if(!['SELECT','OPTION'].includes(event.target.tagName))p3ToggleBenObl(this)"
             style="display:grid;${COLS};
                    align-items:center;padding:6px 14px 6px 18px;
                    background:${benConError ? '#fef9c3' : '#fafbfc'};cursor:pointer;user-select:none;${pgAdelantoRowStyle(ben)}">
          <span class="p3-ben-arr" style="font-size:10px;color:var(--text-muted)">▸</span>
          <span style="font-weight:600;font-size:13px">${esc(ben)}${mcatBadge}${pgAdelantoBadgeHtml(ben)}</span>
          <div style="text-align:right;font-size:12px;line-height:1.5">${progMon}</div>
          <div onclick="event.stopPropagation()">
            <select class="form-control" style="font-size:11px;padding:1px 4px;height:26px;width:100%"
                    onchange="p3SetBancoBen('${benKey}',this.value)">
              ${bancosOpts(curBanco)}
            </select>
          </div>
          <div onclick="event.stopPropagation()">
            <select class="form-control" style="font-size:11px;padding:1px 4px;height:26px;width:100%"
                    onchange="p3SetAgrupBen('${benKey}',this.value)">
              ${p3AgrupOpts(curAgrup)}
            </select>
          </div>
        </div>
        <div class="p3-obl-div" data-p3-ben="${benKey}" style="display:none">
          <table style="width:auto;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f8fafc;color:var(--text-muted)">
                <th style="padding:4px 8px 4px 32px;text-align:left">Tipo Doc</th>
                <th style="padding:4px 8px;text-align:left">N° Documento</th>
                <th style="padding:4px 8px;text-align:left">F. Vencimiento</th>
                <th style="padding:4px 8px;text-align:right">Moneda</th>
                <th style="padding:4px 8px;text-align:right">Monto</th>
                <th style="padding:4px 8px;text-align:right">Retención</th>
                <th style="padding:4px 8px;text-align:right">Neto</th>
                <th style="padding:4px 8px;text-align:center">Banco</th>
                <th style="padding:4px 8px;text-align:center">Agrupador</th>
                <th style="padding:4px 8px;text-align:left">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              ${oblList.map(ob => `
                <tr style="border-top:1px solid #f1f5f9${p3ObsConError.has(String(ob._id)) ? ';background:#fef9c3' : ''}">
                  <td style="padding:4px 8px 4px 32px">${esc(ob.tipoDocumento||'')}</td>
                  <td style="padding:4px 8px">${esc(ob.numeroDocumento||'')}</td>
                  <td style="padding:4px 8px">${fmtF(ob.fechaVencimiento)}</td>
                  <td style="padding:4px 8px;text-align:right">${esc(ob.moneda||'')}</td>
                  <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtN(ob.monto)}</td>
                  <td style="padding:2px 8px;text-align:right">
                    <input type="number" min="0" step="0.01" class="form-control"
                           style="font-size:11px;padding:2px 6px;height:26px;width:90px;text-align:right"
                           placeholder="0.00"
                           value="${ob.retencion ? ob.retencion : ''}"
                           oninput="p3SetRetOb('${ob._id}',this.value)"
                           onblur="p3RetBlur()">
                  </td>
                  <td id="p3-neto-${ob._id}"
                      style="padding:4px 8px;text-align:right;font-weight:600;
                             color:${(ob.retencion||0)>0?'#059669':'inherit'}">
                    ${fmtN(ob.monto - (ob.retencion||0))}
                  </td>
                  <td style="padding:2px 8px;text-align:center">
                    <select class="form-control" style="font-size:11px;padding:1px 4px;height:26px;min-width:110px"
                            onchange="p3SetBancoOb('${ob._id}',this.value)">
                      ${bancosOpts(ob.bancoAsignado||'')}
                    </select>
                  </td>
                  <td style="padding:2px 8px;text-align:center">
                    <select class="form-control" style="font-size:11px;padding:1px 4px;height:26px;min-width:120px"
                            onchange="p3SetAgrupOb('${ob._id}',this.value)">
                      ${p3AgrupOpts(ob.agrupadorPago||'INDIVIDUAL')}
                    </select>
                  </td>
                  <td style="padding:2px 8px">
                    <input type="text" class="form-control"
                           style="font-size:11px;padding:2px 6px;height:26px;min-width:160px;
                                  ${!ob.bancoAsignado ? 'border-color:#f59e0b;background:#fffbeb' : ''}"
                           placeholder="${!ob.bancoAsignado ? 'Requerido ⚠' : 'Observaciones...'}"
                           value="${esc(ob.observaciones||'')}"
                           oninput="p3SetObsOb('${ob._id}',this.value)">
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    });

    html += '</div>';

    // ── Resumen por banco / moneda / agrupador ────────────────────
    const resumen = {};
    allObs.forEach(ob => {
      const banco = ob.bancoAsignado || '(sin banco)';
      const mon   = ob.moneda || 'LO';
      const agrup = ob.agrupadorPago || 'INDIVIDUAL';
      const key   = `${banco}||${mon}||${agrup}`;
      if (!resumen[key]) resumen[key] = { banco, mon, agrup, monto: 0 };
      resumen[key].monto += ob.monto - (ob.retencion || 0);
    });
    const resRows = Object.values(resumen).sort((a,b) =>
      a.banco.localeCompare(b.banco) || a.mon.localeCompare(b.mon) || a.agrup.localeCompare(b.agrup)
    );
    if (resRows.length) {
      html += `
      <div class="card mb-8" style="padding:0;overflow:hidden">
        <div style="padding:7px 14px;background:var(--bg-secondary);border-bottom:1px solid #e2e8f0;
                    font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">
          Resumen por banco / moneda / agrupador
        </div>
        <table style="width:auto;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f8fafc;color:var(--text-muted)">
              <th style="padding:4px 14px;text-align:left">Banco</th>
              <th style="padding:4px 14px;text-align:left">Moneda</th>
              <th style="padding:4px 14px;text-align:left">Agrupador</th>
              <th style="padding:4px 14px;text-align:right">Monto Neto</th>
            </tr>
          </thead>
          <tbody>
            ${resRows.map((r,i) => `
            <tr style="border-top:1px solid #f1f5f9${i%2===1?';background:#fafbfc':''}">
              <td style="padding:4px 14px;font-weight:600;color:#1d4ed8">${esc(r.banco)}</td>
              <td style="padding:4px 14px">${r.mon === 'LO' ? 'Soles' : 'Dólares'}</td>
              <td style="padding:4px 14px;color:#7c3aed">${esc(r.agrup)}</td>
              <td style="padding:4px 14px;text-align:right;font-weight:700">${r.mon !== 'LO' ? 'USD ' : 'S/ '}${fmtN(r.monto)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    wrap.innerHTML = html || '<p style="color:var(--text-muted);padding:16px">No hay obligaciones programadas.</p>';
  }

  // ── Toggle obligaciones de beneficiario ─────────────────────────
  window.p3ToggleBenObl = function(benRow) {
    const oblDiv = benRow.nextElementSibling;
    if (!oblDiv || !oblDiv.classList.contains('p3-obl-div')) return;
    const open = oblDiv.style.display !== 'none';
    oblDiv.style.display = open ? 'none' : '';
    const arr = benRow.querySelector('.p3-ben-arr');
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  // ── Expandir niveles ─────────────────────────────────────────────
  window.p3Expandir = function(nivel) {
    document.querySelectorAll('#p3-wrap .p3-obl-div').forEach(d => {
      d.style.display = nivel >= 1 ? '' : 'none';
      const arr = d.previousElementSibling?.querySelector('.p3-ben-arr');
      if (arr) arr.textContent = nivel >= 1 ? '▾' : '▸';
    });
  };

  // ── Setters a nivel de beneficiario ─────────────────────────────
  window.p3SetBancoBen = function(benKey, val) {
    if (!p3Prog) return;
    const sepIdx  = benKey.indexOf('|||');
    const benPart = sepIdx >= 0 ? benKey.substring(0, sepIdx) : benKey;
    const mcat    = sepIdx >= 0 ? benKey.substring(sepIdx + 3) : null;
    p3Prog.obligaciones.forEach(ob => {
      const obMcat = ob.moneda === 'LO' ? 'SOL' : 'USD';
      if ((ob.pagarA||'').toUpperCase() === benPart && (!mcat || obMcat === mcat) && ob.seleccionado)
        ob.bancoAsignado = val;
    });
    p3ObsConError = new Set();
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
  };

  window.p3SetAgrupBen = function(benKey, val) {
    if (!p3Prog) return;
    if (!val) return; // placeholder "— Agrupador —"

    // Nuevo agrupador personalizado
    if (val === '__nuevo__') {
      const nuevo = prompt('Ingresa el nombre del nuevo agrupador:');
      if (!nuevo || !nuevo.trim()) return;
      const nombre = nuevo.trim().toUpperCase();
      if (!AGRUPS_FIJOS.includes(nombre) && !p3CustomAgrups.includes(nombre))
        p3CustomAgrups.push(nombre);
      val = nombre;
    }

    const sepIdx  = benKey.indexOf('|||');
    const benPart = sepIdx >= 0 ? benKey.substring(0, sepIdx) : benKey;
    const mcat    = sepIdx >= 0 ? benKey.substring(sepIdx + 3) : null;
    p3Prog.obligaciones.forEach(ob => {
      const obMcat = ob.moneda === 'LO' ? 'SOL' : 'USD';
      if ((ob.pagarA||'').toUpperCase() === benPart && (!mcat || obMcat === mcat) && ob.seleccionado)
        ob.agrupadorPago = val;
    });
    p3ObsConError = new Set();
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
  };

  // ── Setters a nivel de obligación individual ─────────────────────
  window.p3SetBancoOb = function(obId, val) {
    if (!p3Prog) return;
    const ob = p3Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.bancoAsignado = val;
    p3ObsConError = new Set();
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
  };

  window.p3SetAgrupOb = function(obId, val) {
    if (!p3Prog) return;
    if (!val) return; // placeholder "— Agrupador —"

    // Nuevo agrupador personalizado
    if (val === '__nuevo__') {
      const nuevo = prompt('Ingresa el nombre del nuevo agrupador:');
      if (!nuevo || !nuevo.trim()) { const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); return; }
      const nombre = nuevo.trim().toUpperCase();
      if (!AGRUPS_FIJOS.includes(nombre) && !p3CustomAgrups.includes(nombre))
        p3CustomAgrups.push(nombre);
      val = nombre;
    }

    const ob = p3Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.agrupadorPago = val;
    p3ObsConError = new Set();
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
  };

  // ── Setter retención (actualiza neto en DOM, re-render en blur) ──
  window.p3SetRetOb = function(obId, val) {
    if (!p3Prog) return;
    const ob = p3Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.retencion = parseFloat(val) || 0;
    // Actualizar celda Neto en el DOM sin re-render (preserva el foco)
    const netoEl = document.getElementById(`p3-neto-${obId}`);
    if (netoEl) {
      const n = ob.monto - ob.retencion;
      netoEl.textContent = fmtN(n);
      netoEl.style.color = ob.retencion > 0 ? '#059669' : '';
    }
  };

  // Re-render completo al salir del campo retención (actualiza totales de beneficiario/grupo/footer)
  window.p3RetBlur = function() {
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
  };

  // ── Setter observaciones (sin re-render para no perder el foco) ──
  window.p3SetObsOb = function(obId, val) {
    if (!p3Prog) return;
    const ob = p3Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (ob) ob.observaciones = val;
    // limpiar marcado de error si ahora tiene observaciones o banco
    if (p3ObsConError.has(String(obId)) && (val.trim() || ob?.bancoAsignado)) {
      p3ObsConError.delete(String(obId));
      const tr = document.querySelector(`[oninput="p3SetObsOb('${obId}',this.value)"]`)?.closest('tr');
      if (tr) tr.style.background = '';
    }
  };

  // ── Exportar Excel Paso 3 ────────────────────────────────────────
  window.p3ExportarExcel = function() {
    if (!p3Prog) { toast('No hay programación abierta', 'error'); return; }
    const obs = (p3Prog.obligaciones || []).filter(o => o.seleccionado);
    if (!obs.length) { toast('No hay obligaciones programadas', 'error'); return; }

    const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE') : '';
    const fmtNum  = n => (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const headers = ['Beneficiario','Tipo Doc','N° Documento','F. Documento','F. Vencimiento','Moneda','Importe','Retención','Pago Neto','Grupo de Pago'];
    const rows = obs
      .slice()
      .sort((a,b) => (a.pagarA||'').localeCompare(b.pagarA||''))
      .map(ob => [
        ob.pagarA         || '',
        ob.tipoDocumento  || '',
        ob.numeroDocumento|| '',
        fmtDate(ob.fechaDocumento),
        fmtDate(ob.fechaVencimiento),
        ob.moneda         || '',
        fmtNum(ob.monto),
        fmtNum(ob.retencion || 0),
        fmtNum(ob.monto - (ob.retencion || 0)),
        ob.agrupadorPago  || 'INDIVIDUAL',
      ].map(csvCell).join(','));

    const csv  = [headers.map(csvCell).join(','), ...rows].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `paso3-preparacion-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ Exportando a Excel', 'success');
  };

  // ── Refresh / filtrar ────────────────────────────────────────────
  window.p3Refresh  = () => { const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter(); };
  window.p3Filtrar  = () => { const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); };
  window.p3LimpiarFiltros = () => {
    ['p3-f-tipodoc','p3-f-numdoc','p3-f-benef','p3-f-grupo','p3-f-banco','p3-f-agrup'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st);
  };

  // ── Footer con resumen por banco + agrupador ─────────────────────
  function p3RenderFooter() {
    const obs = (p3Prog?.obligaciones || []).filter(o => o.seleccionado);
    const tc  = parseFloat(document.getElementById('p3-tc')?.value) || 1;

    // Resumen agrupado por banco + agrupador — importes NETOS (monto − retención)
    const netoOb = o => o.monto - (o.retencion || 0);
    const resumen = {};
    obs.forEach(ob => {
      const banco = ob.bancoAsignado || '(sin banco)';
      const agrup = ob.agrupadorPago || 'INDIVIDUAL';
      const key   = `${banco}||${agrup}`;
      if (!resumen[key]) resumen[key] = { banco, agrup, usd:0, sol:0 };
      if (ob.moneda !== 'LO') resumen[key].usd += netoOb(ob);
      else                     resumen[key].sol += netoOb(ob);
    });

    const totalUSD = obs.filter(o => o.moneda !== 'LO').reduce((s,o) => s + netoOb(o), 0);
    const totalSOL = obs.filter(o => o.moneda === 'LO').reduce((s,o) => s + netoOb(o), 0);
    const totalTot = totalSOL + totalUSD * tc;

    const resHtml = Object.values(resumen).map(r => `
      <div style="display:flex;align-items:center;gap:10px;padding:4px 12px;
                  background:#f8fafc;border-radius:4px;font-size:12px">
        <span style="font-weight:600;color:#1d4ed8">🏦 ${esc(r.banco)}</span>
        <span style="color:#64748b">•</span>
        <span style="color:#7c3aed">${esc(r.agrup)}</span>
        <span style="color:#64748b">→</span>
        ${r.usd ? `<span>USD <strong>${fmtN(r.usd)}</strong></span>` : ''}
        ${r.sol ? `<span>S/ <strong>${fmtN(r.sol)}</strong></span>` : ''}
      </div>`).join('');

    p3Footer.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;overflow-x:auto">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-muted)">Programadas:&nbsp;<strong style="color:#111">${obs.length}</strong></span>
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:11px;color:var(--text-muted)">Neto:</span>
          ${totalUSD ? `<span style="font-size:13px">USD&nbsp;<strong>${fmtN(totalUSD)}</strong></span>` : ''}
          ${totalSOL ? `<span style="font-size:13px">S/&nbsp;<strong>${fmtN(totalSOL)}</strong></span>` : ''}
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:13px">Todo en S/:&nbsp;<strong style="color:var(--primary);font-size:14px">${fmtN(totalTot)}</strong></span>
        </div>
        ${resHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${resHtml}</div>` : ''}
      </div>
      ${p3Prog ? `
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          ${p3Prog.estado === 'preparado'
            ? `<span style="font-size:11px;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:2px 8px;font-weight:600">🏦 Preparada</span>`
            : ''}
          <button class="btn btn-outline btn-sm" onclick="p3Guardar()">💾 Guardar</button>
          ${puedePagar && p3Prog.estado !== 'preparado' ? `
            <button class="btn btn-primary btn-sm" onclick="p3Preparar()"
                    style="background:#1d4ed8;border-color:#1d4ed8">🏦 Enviar a Autorización</button>` : ''}
        </div>` : ''}`;
  }

  // ── Guardar / Preparar ───────────────────────────────────────────
  window.p3Guardar = async function() {
    if (!p3Prog) return;
    // Validar y marcar errores
    const val = p3ValidarTodo();
    p3ObsConError = val.obIds;
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
    const asignaciones = (p3Prog.obligaciones||[]).filter(o => o.seleccionado).map(ob => ({
      id: ob._id, bancoAsignado: ob.bancoAsignado||'', agrupadorPago: ob.agrupadorPago||'INDIVIDUAL', retencion: ob.retencion||0, observaciones: ob.observaciones||''
    }));
    try {
      await PUT(`/pagos/programaciones/${p3Prog._id}/guardar-p3`, { asignaciones });
      if (!val.ok) {
        toast('💾 Guardado con advertencias — revise los campos en amarillo', 'warning');
      } else {
        toast('Preparación guardada', 'success');
      }
    } catch(e) { toast(e.message, 'error'); }
  };

  window.p3Preparar = async function() {
    if (!p3Prog) return;
    // Validar agrupaciones — bloquear si hay errores
    const val = p3ValidarTodo();
    p3ObsConError = val.obIds;
    const st = p3SaveState(); p3RenderGrupos(); p3RestoreState(st); p3RenderFooter();
    if (!val.ok) {
      alert(`⚠️ Corrija los errores antes de enviar a Autorización:\n\n• ${val.mensajes.join('\n• ')}`);
      return;
    }
    const sin = (p3Prog.obligaciones||[]).filter(o => o.seleccionado && !o.bancoAsignado).length;
    if (sin > 0 && !confirm(`Hay ${sin} obligaciones sin banco asignado. ¿Continuar de todas formas?`)) return;
    const n = (p3Prog.obligaciones||[]).filter(o => o.seleccionado).length;
    if (!confirm(`¿Enviar a Autorización esta preparación con ${n} obligaciones?`)) return;
    const asignaciones = (p3Prog.obligaciones||[]).filter(o => o.seleccionado).map(ob => ({
      id: ob._id, bancoAsignado: ob.bancoAsignado||'', agrupadorPago: ob.agrupadorPago||'INDIVIDUAL', retencion: ob.retencion||0, observaciones: ob.observaciones||''
    }));
    try {
      await PUT(`/pagos/programaciones/${p3Prog._id}/preparar`, { asignaciones });
      toast('✅ Enviado a Autorización', 'success');
      p3Prog = null;
      document.getElementById('p3-wrap').innerHTML = '';
      document.getElementById('p3-filtros').style.display = 'none';
      p3RenderFooter();
      await p3CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Gestión de bancos (admin) ────────────────────────────────────
  window.p3GestionBancos = async function() {
    let bancos = await GET('/pagos/bancos');
    const renderModal = () => {
      const content = document.getElementById('p3-modal-bancos-content');
      if (!content) return;
      content.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">
          <thead><tr style="background:#f1f5f9">
            <th style="padding:8px;text-align:left">Banco</th>
            <th style="padding:8px;text-align:left">Código</th>
            <th style="padding:8px;text-align:center">Activo</th>
            <th style="padding:8px"></th>
          </tr></thead>
          <tbody>
            ${bancos.map(b => `
              <tr style="border-top:1px solid #e2e8f0">
                <td style="padding:6px 8px;font-weight:600">${esc(b.nombre)}</td>
                <td style="padding:6px 8px;color:var(--text-muted)">${esc(b.codigo||'')}</td>
                <td style="padding:6px 8px;text-align:center">
                  <input type="checkbox" ${b.activo?'checked':''} style="width:14px;height:14px"
                         onchange="p3ToggleBancoActivo('${b._id}',this.checked)">
                </td>
                <td style="padding:6px 8px;text-align:right">
                  <button onclick="p3EliminarBanco('${b._id}')"
                          style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px">✕</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Nombre</label>
            <input id="p3-nuevo-banco" class="form-control" style="font-size:13px" placeholder="Ej: BBVA">
          </div>
          <div style="width:100px">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Código</label>
            <input id="p3-nuevo-codigo" class="form-control" style="font-size:13px" placeholder="Ej: 011">
          </div>
          <button class="btn btn-primary btn-sm" onclick="p3AgregarBanco()">＋ Agregar</button>
        </div>`;
    };

    // Crear modal
    let modal = document.getElementById('p3-modal-bancos');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'p3-modal-bancos';
      modal.style.cssText = `position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center`;
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:20px;width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <strong style="font-size:16px">🏦 Gestión de Bancos</strong>
            <button onclick="document.getElementById('p3-modal-bancos').remove()"
                    style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b">×</button>
          </div>
          <div id="p3-modal-bancos-content"></div>
        </div>`;
      document.body.appendChild(modal);
    }
    renderModal();

    window.p3AgregarBanco = async function() {
      const nombre = document.getElementById('p3-nuevo-banco').value.trim();
      const codigo = document.getElementById('p3-nuevo-codigo').value.trim();
      if (!nombre) return toast('Ingresa el nombre del banco', 'error');
      try {
        const b = await POST('/pagos/bancos', { nombre, codigo });
        bancos.push(b); p3Bancos.push(b);
        renderModal();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.p3ToggleBancoActivo = async function(id, activo) {
      try {
        await PUT(`/pagos/bancos/${id}`, { activo });
        const b = bancos.find(x => x._id === id);
        if (b) b.activo = activo;
        const b2 = p3Bancos.find(x => x._id === id);
        if (b2) b2.activo = activo;
      } catch(e) { toast(e.message, 'error'); }
    };
    window.p3EliminarBanco = async function(id) {
      if (!confirm('¿Eliminar este banco?')) return;
      try {
        await DEL(`/pagos/bancos/${id}`);
        bancos = bancos.filter(b => b._id !== id);
        p3Bancos = p3Bancos.filter(b => b._id !== id);
        renderModal();
      } catch(e) { toast(e.message, 'error'); }
    };
  };

  // Init
  p3RenderFooter();
}

// ─── Paso 4: Autorización en Bancos ──────────────────────────────
async function renderPaso4(container) {
  let p4Prog         = null;
  let p4Bancos       = [];
  let p4CustomAgrups = [];
  let p4ObsConError  = new Set();
  let p4Marcados     = new Set();

  const rolP     = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');
  const esAdmin  = (S.user.role === 'ADMIN' || rolP === 'admin');
  const puedeAut = ['autorizador','admin'].includes(rolP);

  const fmtN = v => v == null ? '—' : Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtF = d => d ? new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';

  // ── Footer fijo ──────────────────────────────────────────────────
  let p4Footer = document.getElementById('ap4-footer');
  if (!p4Footer) {
    p4Footer = document.createElement('div');
    p4Footer.id = 'ap4-footer';
    p4Footer.style.cssText = `
      position:fixed;bottom:0;left:220px;right:0;z-index:100;
      background:#fff;border-top:2px solid #e2e8f0;
      box-shadow:0 -4px 12px rgba(0,0,0,.08);
      display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap;
    `;
    document.body.appendChild(p4Footer);
  }
  p4Footer.style.display = 'flex';

  // Bancos
  p4Bancos = await GET('/pagos/bancos');

  // ── HTML principal ───────────────────────────────────────────────
  container.innerHTML = `
    <div class="card mb-16" style="padding:14px">
      <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
          <select id="p4-compania" class="form-control" style="width:150px">
            <option value="">— Seleccionar —</option>
            ${(esAdmin ? ALL_SOCS_COMPRA : (S.user.sociedadesPago || []))
              .map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Tipo de Cambio (USD→S/)</label>
          <input id="p4-tc" type="number" step="0.001" min="0" class="form-control"
                 style="width:90px;font-size:13px" value="3.700"
                 oninput="clearTimeout(window._p4TC);window._p4TC=setTimeout(()=>{const s=p4SaveState();p4RenderGrupos();p4RestoreState(s);p4RenderFooter();},300)">
        </div>
      </div>
    </div>
    <div id="p4-lista" class="mb-16"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
      <button class="btn btn-outline btn-sm" onclick="imprimirVista('p4-wrap','Paso 4 — Autorización en Bancos')">🖨️ Imprimir</button>
      <button class="btn btn-outline btn-sm" onclick="exportarVistaExcel('p4-wrap','paso4-autorizacion')">📥 Bajar a Excel</button>
    </div>
    <div id="p4-wrap" style="padding-bottom:80px"></div>`;

  // ── Agrupadores ──────────────────────────────────────────────────
  const AGRUPS_FIJOS_4 = ['INDIVIDUAL','BBVA PEN','BBVA PEN OB','BCP PEN','BCP PEN OB','IBK PEN','IBK PEN OB',
                          'BBVA DOL','BBVA DOL OB','BCP DOL','BCP DOL OB','IBK DOL','IBK DOL OB',
                          'DETRACCIONES PEN','DETRACCIONES DOL'];

  function p4AgrupOpts(selVal) {
    const extra = p4CustomAgrups.filter(a => !AGRUPS_FIJOS_4.includes(a));
    const todos = [...AGRUPS_FIJOS_4, ...extra];
    const ph = !selVal ? `<option value="" selected>— Agrupador —</option>` : `<option value="">— Agrupador —</option>`;
    return ph + todos.map(a =>
      `<option value="${esc(a)}" ${a === selVal ? 'selected' : ''}>${esc(a)}</option>`
    ).join('') + `<option value="__nuevo__">＋ Nuevo agrupador...</option>`;
  }

  function p4BancosOpts(sel) {
    return `<option value="">— Banco —</option>` +
      p4Bancos.filter(b => b.activo).map(b =>
        `<option value="${esc(b.nombre)}" ${b.nombre === sel ? 'selected' : ''}>${esc(b.nombre)}</option>`
      ).join('');
  }

  // ── Guardar estado (qué bancos/agrupadores están abiertos) ────────
  function p4SaveState() {
    const st = { bancos: {}, agrups: {}, indivs: {} };
    document.querySelectorAll('[id^="p4banco-body-"]').forEach(el => {
      st.bancos[el.id] = el.style.display !== 'none';
    });
    document.querySelectorAll('[id^="p4agrup-body-"]').forEach(el => {
      st.agrups[el.id] = el.style.display !== 'none';
    });
    document.querySelectorAll('[id^="p4-indiv-body-"]').forEach(el => {
      st.indivs[el.id] = el.style.display !== 'none';
    });
    return st;
  }
  function p4RestoreState(st) {
    if (!st) return;
    Object.entries(st.bancos||{}).forEach(([id, open]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = open ? '' : 'none';
        const arr = el.previousElementSibling?.querySelector('.p4-banco-arr');
        if (arr) arr.textContent = open ? '▾' : '▸';
      }
    });
    Object.entries(st.agrups||{}).forEach(([id, open]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = open ? '' : 'none';
        const arr = el.previousElementSibling?.querySelector('.p4-agrup-arr');
        if (arr) arr.textContent = open ? '▾' : '▸';
      }
    });
    Object.entries(st.indivs||{}).forEach(([id, open]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = open ? '' : 'none';
        const arrId = id.replace('p4-indiv-body-', 'p4-indiv-arr-');
        const arr = document.getElementById(arrId);
        if (arr) arr.textContent = open ? '▾' : '▸';
      }
    });
  }

  // ── Validación ───────────────────────────────────────────────────
  function p4ValidarTodo() {
    const allObs = (p4Prog?.obligaciones || []).filter(o => o.seleccionado);
    const errIds = new Set();
    const msgs   = [];
    const byAgrup = {};
    allObs.forEach(ob => {
      const ag = ob.agrupadorPago || 'INDIVIDUAL';
      if (ag === 'INDIVIDUAL') return;
      if (!byAgrup[ag]) byAgrup[ag] = [];
      byAgrup[ag].push(ob);
    });
    Object.entries(byAgrup).forEach(([agrup, obs]) => {
      const monedas = [...new Set(obs.map(o => o.moneda === 'LO' ? 'S/' : 'USD'))];
      if (monedas.length > 1) {
        obs.forEach(o => errIds.add(String(o._id)));
        msgs.push(`Agrupador "${agrup}": mezcla de monedas (${monedas.join(' y ')}).`);
      }
      const bancos = [...new Set(obs.map(o => o.bancoAsignado || '').filter(Boolean))];
      if (bancos.length > 1) {
        obs.forEach(o => errIds.add(String(o._id)));
        msgs.push(`Agrupador "${agrup}": mezcla de bancos (${bancos.join(', ')}).`);
      }
    });
    const sinBancoSinObs = allObs.filter(o => !o.bancoAsignado && !(o.observaciones||'').trim());
    sinBancoSinObs.forEach(o => errIds.add(String(o._id)));
    if (sinBancoSinObs.length)
      msgs.push(`${sinBancoSinObs.length} obligación(es) sin banco requieren Observaciones.`);
    return { ok: errIds.size === 0, obIds: errIds, mensajes: msgs };
  }

  // ── Renderizar árbol banco → agrupador → obligaciones ────────────
  function p4RenderGrupos() {
    const wrap = document.getElementById('p4-wrap');
    if (!p4Prog) { wrap.innerHTML = ''; return; }
    const tc  = parseFloat(document.getElementById('p4-tc')?.value) || 1;
    const obs = (p4Prog.obligaciones || []).filter(o => o.seleccionado);

    // Sync custom agrupadores
    obs.forEach(o => {
      const ag = o.agrupadorPago || 'INDIVIDUAL';
      if (!AGRUPS_FIJOS_4.includes(ag) && !p4CustomAgrups.includes(ag)) p4CustomAgrups.push(ag);
    });

    const netoOb = o => o.monto - (o.retencion || 0);

    // Agrupar por banco → agrupador
    const byBanco = {};
    obs.forEach(ob => {
      const banco = ob.bancoAsignado || '(sin banco)';
      const agrup = ob.agrupadorPago  || 'INDIVIDUAL';
      if (!byBanco[banco]) byBanco[banco] = {};
      if (!byBanco[banco][agrup]) byBanco[banco][agrup] = [];
      byBanco[banco][agrup].push(ob);
    });

    // Totales por banco/agrupador (todas las obligaciones del grupo)
    const bancoTot = (banco) => {
      const bo = obs.filter(o => (o.bancoAsignado || '(sin banco)') === banco);
      const usd = bo.filter(o => o.moneda !== 'LO').reduce((s,o) => s + netoOb(o), 0);
      const sol = bo.filter(o => o.moneda === 'LO').reduce((s,o) => s + netoOb(o), 0);
      return { usd, sol };
    };
    const agrupTot = (banco, agrup) => {
      const ao = obs.filter(o =>
        (o.bancoAsignado||'(sin banco)') === banco &&
        (o.agrupadorPago ||'INDIVIDUAL')  === agrup
      );
      const usd = ao.filter(o => o.moneda !== 'LO').reduce((s,o) => s + netoOb(o), 0);
      const sol = ao.filter(o => o.moneda === 'LO').reduce((s,o) => s + netoOb(o), 0);
      return { usd, sol };
    };
    const totStr = ({usd,sol}) => [
      usd ? `USD&nbsp;${fmtN(usd)}` : '',
      sol ? `S/&nbsp;${fmtN(sol)}`  : '',
    ].filter(Boolean).join('&emsp;') || '—';

    let html = '';
    const bancosOrdenados = Object.keys(byBanco).sort((a,b) => {
      if (a === '(sin banco)') return 1;
      if (b === '(sin banco)') return -1;
      return a.localeCompare(b);
    });

    bancosOrdenados.forEach(banco => {
      const bKey   = banco.replace(/\W/g,'_');
      const bt     = bancoTot(banco);
      const bConErr = p4ObsConError.size > 0 &&
        obs.filter(o => (o.bancoAsignado||'(sin banco)') === banco)
           .some(o => p4ObsConError.has(String(o._id)));
      const bObsList = obs.filter(o => (o.bancoAsignado||'(sin banco)') === banco);
      const allBancoMarcado = bObsList.length > 0 && bObsList.every(o => p4Marcados.has(String(o._id)));

      html += `
      <div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div onclick="if(event.target.tagName!=='INPUT')p4ToggleBanco('${esc(bKey)}')"
             style="display:flex;align-items:center;gap:10px;padding:10px 16px;
                    background:${bConErr?'#fef9c3':'#f0f4ff'};cursor:pointer;user-select:none">
          <span class="p4-banco-arr" style="font-size:11px;color:var(--text-muted)">▾</span>
          <input type="checkbox" ${allBancoMarcado ? 'checked' : ''}
                 onclick="event.stopPropagation()"
                 onchange="p4ToggleMarcadoBanco('${esc(bKey)}',this.checked)"
                 style="width:15px;height:15px;accent-color:#1d4ed8;cursor:pointer;flex-shrink:0">
          <span style="font-weight:700;font-size:14px;color:#1d4ed8">🏦 ${esc(banco)}</span>
          <div style="display:flex;flex-direction:column;gap:1px;margin-left:10px">
            ${bt.usd ? `<span style="font-size:11px;color:#1d4ed8;font-weight:600">USD&nbsp;${fmtN(bt.usd)}</span>` : ''}
            ${bt.sol ? `<span style="font-size:11px;color:#1d4ed8;font-weight:600">S/&nbsp;&nbsp;${fmtN(bt.sol)}</span>` : ''}
          </div>
        </div>
        <div id="p4banco-body-${bKey}">`;

      // Agrupadores dentro del banco, ordenados
      const agrups = Object.keys(byBanco[banco]).sort((a,b) => {
        const ia = AGRUPS_FIJOS_4.indexOf(a), ib = AGRUPS_FIJOS_4.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

      // Helper: fila de una obligación en la tabla de detalle
      const p4ObRow = (ob, indent) => `
        <tr style="border-top:1px solid #f1f5f9;background:${p4ObsConError.has(String(ob._id))?'#fef9c3':p4Marcados.has(String(ob._id))?'#f0fdf4':''};${pgAdelantoRowStyle(ob.pagarA||'')}">
          <td style="padding:4px 8px 4px ${indent}px;text-align:center">
            <input type="checkbox" ${p4Marcados.has(String(ob._id))?'checked':''}
                   onclick="event.stopPropagation()"
                   onchange="p4ToggleMarcadoOb('${ob._id}',this.checked)"
                   style="width:14px;height:14px;accent-color:var(--primary);cursor:pointer">
          </td>
          <td style="padding:4px 8px;font-weight:500">${esc(ob.pagarA||'')}${pgAdelantoBadgeHtml(ob.pagarA||'')}</td>
          <td style="padding:4px 8px">${esc(ob.tipoDocumento||'')}</td>
          <td style="padding:4px 8px">${esc(ob.numeroDocumento||'')}</td>
          <td style="padding:4px 8px;white-space:nowrap">${fmtF(ob.fechaVencimiento)}</td>
          <td style="padding:4px 8px;text-align:right">${esc(ob.moneda||'')}</td>
          <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtN(ob.monto)}</td>
          <td style="padding:4px 8px;text-align:right;color:${(ob.retencion||0)>0?'#059669':'var(--text-muted)'}">${fmtN(ob.retencion||0)}</td>
          <td style="padding:4px 8px;text-align:right;font-weight:600;color:${(ob.retencion||0)>0?'#059669':'inherit'}">${fmtN(netoOb(ob))}</td>
          <td style="padding:4px 8px;text-align:center;color:#1d4ed8;font-weight:500">${esc(ob.bancoAsignado||'')}</td>
          <td style="padding:4px 8px;text-align:center;color:#7c3aed">${esc(ob.agrupadorPago||'INDIVIDUAL')}</td>
          <td style="padding:2px 8px">
            <input type="text" class="form-control"
                   style="font-size:11px;padding:2px 6px;height:26px;min-width:150px"
                   placeholder="Observaciones..."
                   value="${esc(ob.observaciones||'')}"
                   oninput="p4SetObsOb('${ob._id}',this.value)">
          </td>
        </tr>`;

      const p4TableHead = `
        <tr style="background:#f1f5f9;color:var(--text-muted)">
          <th style="padding:5px 8px;text-align:center;white-space:nowrap">☑</th>
          <th style="padding:5px 8px;text-align:left;white-space:nowrap">Beneficiario</th>
          <th style="padding:5px 8px;text-align:left;white-space:nowrap">Tipo Doc</th>
          <th style="padding:5px 8px;text-align:left;white-space:nowrap">N° Documento</th>
          <th style="padding:5px 8px;text-align:left;white-space:nowrap">F. Vencimiento</th>
          <th style="padding:5px 8px;text-align:right;white-space:nowrap">Mon</th>
          <th style="padding:5px 8px;text-align:right;white-space:nowrap">Monto</th>
          <th style="padding:5px 8px;text-align:right;white-space:nowrap">Retención</th>
          <th style="padding:5px 8px;text-align:right;white-space:nowrap">Neto</th>
          <th style="padding:5px 8px;text-align:center;white-space:nowrap">Banco</th>
          <th style="padding:5px 8px;text-align:center;white-space:nowrap">Agrupador</th>
          <th style="padding:5px 8px;text-align:left;white-space:nowrap">Observaciones</th>
        </tr>`;

      agrups.forEach(agrup => {
        const aKey    = `${bKey}__${agrup.replace(/\W/g,'_')}`;
        const at      = agrupTot(banco, agrup);
        const oblList = byBanco[banco][agrup];
        const allAgrupMarcado = oblList.length > 0 && oblList.every(o => p4Marcados.has(String(o._id)));

        html += `
          <div style="border-top:1px solid #e2e8f0">
            <div onclick="if(event.target.tagName!=='INPUT')p4ToggleAgrup('${esc(aKey)}')"
                 style="display:flex;align-items:center;gap:8px;padding:7px 16px 7px 32px;
                        background:#f8fafc;cursor:pointer;user-select:none">
              <span class="p4-agrup-arr" style="font-size:10px;color:var(--text-muted)">▸</span>
              <input type="checkbox" ${allAgrupMarcado ? 'checked' : ''}
                     onclick="event.stopPropagation()"
                     onchange="p4ToggleMarcadoAgrup('${esc(aKey)}',this.checked)"
                     style="width:13px;height:13px;accent-color:#7c3aed;cursor:pointer;flex-shrink:0">
              <span style="font-weight:600;font-size:12px;color:#7c3aed">${esc(agrup)}</span>
              <div style="display:flex;flex-direction:column;gap:0;margin-left:8px">
                ${at.usd ? `<span style="font-size:10px;color:#7c3aed;font-weight:600">USD&nbsp;${fmtN(at.usd)}</span>` : ''}
                ${at.sol ? `<span style="font-size:10px;color:#7c3aed;font-weight:600">S/&nbsp;&nbsp;${fmtN(at.sol)}</span>` : ''}
              </div>
            </div>
            <div id="p4agrup-body-${aKey}" style="display:none">`;

        if (agrup === 'INDIVIDUAL') {
          // Sub-agrupar por beneficiario
          const byBen = {};
          oblList.forEach(ob => {
            const b = ob.pagarA || '(sin beneficiario)';
            if (!byBen[b]) byBen[b] = [];
            byBen[b].push(ob);
          });
          Object.keys(byBen).sort().forEach(ben => {
            const benObs = byBen[ben];
            const benKey2 = `${aKey}__${ben.replace(/\W/g,'_')}`;
            const benUsd = benObs.filter(o=>o.moneda!=='LO').reduce((s,o)=>s+netoOb(o),0);
            const benSol = benObs.filter(o=>o.moneda==='LO').reduce((s,o)=>s+netoOb(o),0);
            const allBenMarcado = benObs.every(o => p4Marcados.has(String(o._id)));
            html += `
              <div style="border-top:1px solid #f1f5f9">
                <div onclick="if(event.target.tagName!=='INPUT')p4ToggleIndiv('${benKey2}')"
                     style="display:flex;align-items:center;gap:8px;padding:6px 16px 6px 48px;
                            background:#fafbfc;cursor:pointer;user-select:none;${pgAdelantoRowStyle(ben)}">
                  <span id="p4-indiv-arr-${benKey2}" style="font-size:10px;color:var(--text-muted)">▸</span>
                  <input type="checkbox" ${allBenMarcado ? 'checked' : ''}
                         onclick="event.stopPropagation()"
                         onchange="p4ToggleMarcadoBenIndiv('${benKey2}',this.checked)"
                         style="width:13px;height:13px;accent-color:var(--primary);cursor:pointer;flex-shrink:0">
                  <span style="font-weight:600;font-size:12px">${esc(ben)}${pgAdelantoBadgeHtml(ben)}</span>
                  <div style="display:flex;gap:8px;margin-left:8px;font-size:11px;color:#64748b">
                    ${benUsd ? `<span>USD&nbsp;${fmtN(benUsd)}</span>` : ''}
                    ${benSol ? `<span>S/&nbsp;${fmtN(benSol)}</span>` : ''}
                  </div>
                </div>
                <div id="p4-indiv-body-${benKey2}" style="display:none">
                  <div style="overflow-x:auto">
                  <table style="width:100%;border-collapse:collapse;font-size:12px">
                    <thead>${p4TableHead}</thead>
                    <tbody>${benObs.map(ob => p4ObRow(ob, 56)).join('')}</tbody>
                  </table>
                  </div>
                </div>
              </div>`;
          });
        } else {
          html += `
              <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>${p4TableHead}</thead>
                <tbody>${oblList.map(ob => p4ObRow(ob, 8)).join('')}</tbody>
              </table>
              </div>`;
        }

        html += `</div></div>`;
      });

      html += `</div></div>`;
    });

    wrap.innerHTML = html || '<p style="color:var(--text-muted);padding:16px">No hay obligaciones.</p>';
  }

  // ── Footer ────────────────────────────────────────────────────────
  function p4RenderFooter() {
    const obsAll = (p4Prog?.obligaciones || []).filter(o => o.seleccionado);
    const obs    = obsAll.filter(o => p4Marcados.has(String(o._id)));
    const tc  = parseFloat(document.getElementById('p4-tc')?.value) || 1;
    const netoOb = o => o.monto - (o.retencion || 0);

    // Totales por banco
    const byBanco = {};
    obs.forEach(ob => {
      const banco = ob.bancoAsignado || '(sin banco)';
      if (!byBanco[banco]) byBanco[banco] = { usd:0, sol:0 };
      if (ob.moneda !== 'LO') byBanco[banco].usd += netoOb(ob);
      else                     byBanco[banco].sol += netoOb(ob);
    });
    const totalUSD = obs.filter(o => o.moneda !== 'LO').reduce((s,o) => s + netoOb(o), 0);
    const totalSOL = obs.filter(o => o.moneda === 'LO').reduce((s,o) => s + netoOb(o), 0);
    const totalTot = totalSOL + totalUSD * tc;

    const bancosHtml = Object.entries(byBanco).sort(([a],[b]) => a.localeCompare(b)).map(([banco,{usd,sol}]) => `
      <div style="display:flex;align-items:center;gap:8px;padding:3px 10px;background:#f0f4ff;border-radius:4px;font-size:12px">
        <span style="font-weight:600;color:#1d4ed8">🏦 ${esc(banco)}</span>
        <span style="color:#64748b">→</span>
        ${usd ? `<span>USD <strong>${fmtN(usd)}</strong></span>` : ''}
        ${sol ? `<span>S/ <strong>${fmtN(sol)}</strong></span>` : ''}
      </div>`).join('');

    p4Footer.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;overflow-x:auto">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-muted)">Marcadas:&nbsp;<strong style="color:#111">${obs.length}</strong>${obsAll.length !== obs.length ? `&nbsp;<span style="color:#94a3b8">/ ${obsAll.length}</span>` : ''}</span>
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:11px;color:var(--text-muted)">Neto:</span>
          ${totalUSD ? `<span style="font-size:13px">USD&nbsp;<strong>${fmtN(totalUSD)}</strong></span>` : ''}
          ${totalSOL ? `<span style="font-size:13px">S/&nbsp;<strong>${fmtN(totalSOL)}</strong></span>` : ''}
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:13px">Todo en S/:&nbsp;<strong style="color:var(--primary);font-size:14px">${fmtN(totalTot)}</strong></span>
        </div>
        ${bancosHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${bancosHtml}</div>` : ''}
      </div>
      ${p4Prog ? `
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          ${p4Prog.estado === 'autorizado'
            ? `<span style="font-size:11px;background:#dcfce7;color:#15803d;border-radius:4px;padding:2px 8px;font-weight:600">✅ Autorizada</span>`
            : ''}
          <button class="btn btn-outline btn-sm" onclick="p4Guardar()">💾 Guardar</button>
          ${puedeAut && p4Prog.estado === 'preparado' ? `
            <button class="btn btn-primary btn-sm" onclick="p4Autorizar()"
                    style="background:#15803d;border-color:#15803d">✅ Autorizar</button>` : ''}
        </div>` : ''}`;
  }

  // ── Cargar lista de preparadas ────────────────────────────────────
  async function p4CargarLista() {
    const comp = document.getElementById('p4-compania')?.value;
    const el   = document.getElementById('p4-lista');
    if (!comp) { el.innerHTML = ''; return; }
    const BADGES = {
      preparado: `<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 4px">🏦 Preparada</span>`,
      autorizado:`<span style="font-size:10px;background:#dcfce7;color:#15803d;border-radius:3px;padding:1px 4px">🔑 Autorizada</span>`,
    };
    try {
      // Paso 4 ve preparado (confirmado en Paso 3) + autorizado (ya procesado aquí)
      const [prep, auth] = await Promise.all([
        GET(`/pagos/programaciones?compania=${encodeURIComponent(comp)}&estado=preparado`),
        GET(`/pagos/programaciones?compania=${encodeURIComponent(comp)}&estado=autorizado`),
      ]);
      const data = [...prep, ...auth];
      if (!data.length) {
        el.innerHTML = `<p style="color:var(--text-muted);font-size:13px">No hay programaciones preparadas para <strong>${esc(comp)}</strong>.</p>`;
        return;
      }
      el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${data.map(p => `
          <button class="p4-prog-btn btn btn-outline btn-sm${p4Prog?._id===p._id?' active':''}"
                  data-id="${p._id}"
                  style="font-size:12px;${p4Prog?._id===p._id?'background:#dbeafe;border-color:#3b82f6':''}">
            Semana ${p.semana||''}/${p.año||''}
            &nbsp;${BADGES[p.estado]||''}
          </button>`).join('')}
      </div>`;
      document.querySelectorAll('.p4-prog-btn').forEach(btn =>
        btn.addEventListener('click', () => p4AbrirProg(btn.dataset.id))
      );
    } catch(e) { el.innerHTML = `<p style="color:#ef4444">${e.message}</p>`; }
  }

  // ── Abrir programación ────────────────────────────────────────────
  async function p4AbrirProg(id) {
    try {
      p4Prog = await GET(`/pagos/programaciones/${id}`);
      await pgAdelantosResumen(p4Prog.compania);
      p4ObsConError  = new Set();
      p4Marcados     = new Set();
      p4CustomAgrups = [];
      p4RenderGrupos();
      // Expandir todos los bancos por defecto
      document.querySelectorAll('[id^="p4banco-body-"]').forEach(el => {
        el.style.display = '';
        const arr = el.previousElementSibling?.querySelector('.p4-banco-arr');
        if (arr) arr.textContent = '▾';
      });
      p4RenderFooter();
      await p4CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Toggle banco / agrupador ─────────────────────────────────────
  window.p4ToggleBanco = function(bKey) {
    const body = document.getElementById(`p4banco-body-${bKey}`);
    const arr  = body?.previousElementSibling?.querySelector('.p4-banco-arr');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  window.p4ToggleAgrup = function(aKey) {
    const body = document.getElementById(`p4agrup-body-${aKey}`);
    const arr  = body?.previousElementSibling?.querySelector('.p4-agrup-arr');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  window.p4ToggleIndiv = function(benKey) {
    const body = document.getElementById(`p4-indiv-body-${benKey}`);
    const arr  = document.getElementById(`p4-indiv-arr-${benKey}`);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  window.p4ToggleMarcadoBenIndiv = function(benKey, val) {
    const body = document.getElementById(`p4-indiv-body-${benKey}`);
    if (!body) return;
    body.querySelectorAll('[onchange*="p4ToggleMarcadoOb"]').forEach(el => {
      const m = el.getAttribute('onchange').match(/'([^']+)'/);
      if (m) { if (val) p4Marcados.add(m[1]); else p4Marcados.delete(m[1]); }
    });
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  // ── Marcado (checkboxes P4) ───────────────────────────────────────
  window.p4ToggleMarcadoOb = function(obId, val) {
    if (val) p4Marcados.add(String(obId));
    else     p4Marcados.delete(String(obId));
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  window.p4ToggleMarcadoBanco = function(bKey, val) {
    if (!p4Prog) return;
    (p4Prog.obligaciones || []).filter(o => o.seleccionado).forEach(ob => {
      const bk = (ob.bancoAsignado || '(sin banco)').replace(/\W/g,'_');
      if (bk === bKey) {
        if (val) p4Marcados.add(String(ob._id));
        else     p4Marcados.delete(String(ob._id));
      }
    });
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  window.p4ToggleMarcadoAgrup = function(aKey, val) {
    if (!p4Prog) return;
    (p4Prog.obligaciones || []).filter(o => o.seleccionado).forEach(ob => {
      const bk = (ob.bancoAsignado || '(sin banco)').replace(/\W/g,'_');
      const ak = (ob.agrupadorPago  || 'INDIVIDUAL').replace(/\W/g,'_');
      if (`${bk}__${ak}` === aKey) {
        if (val) p4Marcados.add(String(ob._id));
        else     p4Marcados.delete(String(ob._id));
      }
    });
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  // ── Setters ───────────────────────────────────────────────────────
  window.p4SetBancoOb = function(obId, val) {
    if (!p4Prog) return;
    const ob = p4Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.bancoAsignado = val;
    p4ObsConError = new Set();
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  window.p4SetAgrupOb = function(obId, val) {
    if (!p4Prog) return;
    if (!val) return;
    if (val === '__nuevo__') {
      const nuevo = prompt('Ingresa el nombre del nuevo agrupador:');
      if (!nuevo || !nuevo.trim()) { const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); return; }
      const nombre = nuevo.trim().toUpperCase();
      if (!AGRUPS_FIJOS_4.includes(nombre) && !p4CustomAgrups.includes(nombre)) p4CustomAgrups.push(nombre);
      val = nombre;
    }
    const ob = p4Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.agrupadorPago = val;
    p4ObsConError = new Set();
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  window.p4SetRetOb = function(obId, val) {
    if (!p4Prog) return;
    const ob = p4Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (!ob) return;
    ob.retencion = parseFloat(val) || 0;
    const netoEl = document.getElementById(`p4-neto-${obId}`);
    if (netoEl) {
      netoEl.textContent = (v => Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}))(ob.monto - ob.retencion);
      netoEl.style.color = ob.retencion > 0 ? '#059669' : '';
    }
  };

  window.p4RetBlur = function() {
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
  };

  window.p4SetObsOb = function(obId, val) {
    if (!p4Prog) return;
    const ob = p4Prog.obligaciones.find(o => String(o._id) === String(obId));
    if (ob) ob.observaciones = val;
    if (p4ObsConError.has(String(obId)) && (val.trim() || ob?.bancoAsignado)) {
      p4ObsConError.delete(String(obId));
      const tr = document.querySelector(`[oninput="p4SetObsOb('${obId}',this.value)"]`)?.closest('tr');
      if (tr) tr.style.background = '';
    }
  };

  // ── Guardar / Autorizar ───────────────────────────────────────────
  window.p4Guardar = async function() {
    if (!p4Prog) return;
    const val = p4ValidarTodo();
    p4ObsConError = val.obIds;
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
    const asignaciones = (p4Prog.obligaciones||[]).filter(o => o.seleccionado).map(ob => ({
      id: ob._id, bancoAsignado: ob.bancoAsignado||'', agrupadorPago: ob.agrupadorPago||'INDIVIDUAL',
      retencion: ob.retencion||0, observaciones: ob.observaciones||''
    }));
    try {
      await PUT(`/pagos/programaciones/${p4Prog._id}/guardar-p3`, { asignaciones });
      toast(val.ok ? 'Cambios guardados' : '💾 Guardado con advertencias — revise los campos en amarillo', val.ok ? 'success' : 'warning');
    } catch(e) { toast(e.message, 'error'); }
  };

  window.p4Autorizar = async function() {
    if (!p4Prog) return;
    const val = p4ValidarTodo();
    p4ObsConError = val.obIds;
    const st = p4SaveState(); p4RenderGrupos(); p4RestoreState(st); p4RenderFooter();
    if (!val.ok) {
      alert(`⚠️ Corrija los errores antes de autorizar:\n\n• ${val.mensajes.join('\n• ')}`);
      return;
    }
    const n = (p4Prog.obligaciones||[]).filter(o => o.seleccionado).length;
    if (!confirm(`¿Autorizar esta preparación con ${n} obligaciones?`)) return;
    const asignaciones = (p4Prog.obligaciones||[]).filter(o => o.seleccionado).map(ob => ({
      id: ob._id, bancoAsignado: ob.bancoAsignado||'', agrupadorPago: ob.agrupadorPago||'INDIVIDUAL',
      retencion: ob.retencion||0, observaciones: ob.observaciones||''
    }));
    try {
      await PUT(`/pagos/programaciones/${p4Prog._id}/autorizar`, { asignaciones });
      toast('✅ Programación autorizada', 'success');
      p4Prog = null;
      document.getElementById('p4-wrap').innerHTML = '';
      p4RenderFooter();
      await p4CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Sociedad onChange ─────────────────────────────────────────────
  document.getElementById('p4-compania').addEventListener('change', async () => {
    p4Prog = null;
    document.getElementById('p4-wrap').innerHTML = '';
    p4RenderFooter();
    await p4CargarLista();
  });

  // Init
  p4RenderFooter();
}

// ─── Paso 5: Registro del Movimiento Bancario ─────────────────────
async function renderPaso5(container) {
  let p5Prog    = null;
  let p5Estados = [];   // estados de cuenta cargados para la sociedad

  const rolP       = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');
  const puedePagar = ['pagador','admin'].includes(rolP);
  const esAdminP5  = (S.user.role === 'ADMIN' || rolP === 'admin');
  const socsP5     = esAdminP5 ? ALL_SOCS_COMPRA : (S.user.sociedadesPago || []);

  const fmtN  = v => v == null ? '—' : Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtF  = d => d ? new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
  const netoOb = o => o.monto - (o.retencion || 0);

  // ── Footer fijo ──────────────────────────────────────────────────
  let p5Footer = document.getElementById('ap5-footer');
  if (!p5Footer) {
    p5Footer = document.createElement('div');
    p5Footer.id = 'ap5-footer';
    p5Footer.style.cssText = `
      position:fixed;bottom:0;left:220px;right:0;z-index:100;
      background:#fff;border-top:2px solid #e2e8f0;
      box-shadow:0 -4px 12px rgba(0,0,0,.08);
      display:none;align-items:center;gap:12px;padding:10px 20px;min-height:56px`;
    document.body.appendChild(p5Footer);
  }

  // ── HTML estático ────────────────────────────────────────────────
  container.innerHTML = `
    <div style="padding:16px 20px 80px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
        <select id="p5-compania" class="form-control" style="width:180px">
          <option value="">— Sociedad —</option>
          ${socsP5.map(s=>`<option>${esc(s)}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--text-muted)">TC:</span>
        <input id="p5-tc" type="number" class="form-control" min="1" step="0.001"
               style="width:90px" value="3.75"
               oninput="clearTimeout(window._p5TC);window._p5TC=setTimeout(()=>p5RenderFooter(),300)">
      </div>
      <div id="p5-lista" style="margin-bottom:12px"></div>
      <!-- Dos columnas: izquierda=programación, derecha=movimiento bancario -->
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <!-- ── IZQUIERDA: Programación de pago ── -->
        <div style="flex:1;min-width:320px">
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
            <button class="btn btn-outline btn-sm" onclick="imprimirVista('p5-wrap','Paso 5 — Registro del Movimiento Bancario')">🖨️ Imprimir</button>
            <button class="btn btn-outline btn-sm" onclick="exportarVistaExcel('p5-wrap','paso5-movimiento-bancario')">📥 Bajar a Excel</button>
          </div>
          <div id="p5-wrap"></div>
        </div>
        <!-- ── DERECHA: Movimiento Bancario ── -->
        <div style="flex:1.2;min-width:560px;max-width:900px">
          <div style="border:1px solid #bae6fd;border-radius:8px;overflow:hidden">
            <div style="display:flex;align-items:center;gap:8px;padding:9px 16px;
                        background:#f0f9ff;border-bottom:1px solid #bae6fd">
              <span style="font-weight:700;font-size:13px;color:#0369a1">🏦 Movimiento Bancario</span>
              <span id="p5-estados-badge" style="font-size:11px;color:#64748b;margin-left:4px"></span>
            </div>
            <!-- Upload form -->
            <div style="display:flex;gap:8px;align-items:center;padding:10px 14px;
                        background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">
              <select id="p5-upload-banco" class="form-control" style="width:100px;font-size:12px">
                <option value="">— Banco —</option>
                <option value="BBVA">BBVA</option>
                <option value="BCP">BCP</option>
                <option value="IBK">IBK</option>
              </select>
              <select id="p5-upload-moneda" class="form-control" style="width:120px;font-size:12px">
                <option value="">— Moneda —</option>
                <option value="USD">USD</option>
                <option value="SOL">Soles</option>
              </select>
              <label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;
                            background:#fff;border:1px solid #d1d5db;border-radius:6px;
                            padding:4px 10px;font-size:12px;font-weight:500;color:#374151">
                📎 Subir .xlsx
                <input type="file" id="p5-upload-file" accept=".xlsx,.xls" style="display:none"
                       onchange="p5SubirEstado()">
              </label>
              <span id="p5-upload-status" style="font-size:11px;color:var(--text-muted)"></span>
            </div>
            <div id="p5-estados-lista" style="padding:10px 14px"></div>
          </div>
        </div>
      </div>
    </div>`;

  // ── Save / Restore state ─────────────────────────────────────────
  function p5SaveState() {
    const st = { bancos:{}, agrups:{} };
    document.querySelectorAll('[id^="p5banco-body-"]').forEach(el => {
      st.bancos[el.id] = el.style.display !== 'none';
    });
    document.querySelectorAll('[id^="p5agrup-body-"]').forEach(el => {
      st.agrups[el.id] = el.style.display !== 'none';
    });
    return st;
  }
  function p5RestoreState(st) {
    if (!st) return;
    Object.entries(st.bancos||{}).forEach(([id, open]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = open ? '' : 'none';
        const arr = el.previousElementSibling?.querySelector('.p5-banco-arr');
        if (arr) arr.textContent = open ? '▾' : '▸';
      }
    });
    Object.entries(st.agrups||{}).forEach(([id, open]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = open ? '' : 'none';
        const arr = el.previousElementSibling?.querySelector('.p5-agrup-arr');
        if (arr) arr.textContent = open ? '▾' : '▸';
      }
    });
  }

  // ── Render grupos ────────────────────────────────────────────────
  // ── Tabla de obligaciones (expandible) ──────────────────────────
  function p5TablaObs(oblList) {
    return `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f1f5f9;color:var(--text-muted)">
            <th style="padding:5px 8px 5px 14px;text-align:left;white-space:nowrap">Tipo Doc</th>
            <th style="padding:5px 8px;text-align:left;white-space:nowrap">N° Documento</th>
            <th style="padding:5px 8px;text-align:right;white-space:nowrap">Mon</th>
            <th style="padding:5px 8px;text-align:right;white-space:nowrap">Monto</th>
            <th style="padding:5px 8px;text-align:right;white-space:nowrap">Retención</th>
            <th style="padding:5px 8px;text-align:right;white-space:nowrap">Neto</th>
            <th style="padding:5px 8px;text-align:center;white-space:nowrap;color:#7c3aed">N° Op.</th>
          </tr>
        </thead>
        <tbody>
          ${oblList.map(ob => `
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:4px 8px 4px 14px">${esc(ob.tipoDocumento||'')}</td>
            <td style="padding:4px 8px">${esc(ob.numeroDocumento||'')}</td>
            <td style="padding:4px 8px;text-align:right">${esc(ob.moneda||'')}</td>
            <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtN(ob.monto)}</td>
            <td style="padding:4px 8px;text-align:right">${(ob.retencion||0)>0?fmtN(ob.retencion):'—'}</td>
            <td style="padding:4px 8px;text-align:right;font-weight:600;
                       color:${(ob.retencion||0)>0?'#059669':'inherit'}">${fmtN(netoOb(ob))}</td>
            <td style="padding:4px 8px;text-align:center">
              <input type="number" min="0" step="1" class="form-control"
                     style="width:90px;font-size:11px;height:24px;text-align:center"
                     placeholder="N° Op"
                     data-obid="${esc(String(ob._id))}"
                     value="${esc(ob.operacionBancaria||'')}"
                     oninput="p5SetOpOb('${esc(String(ob._id))}',this.value)">
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function p5RenderGrupos() {
    const wrap = document.getElementById('p5-wrap');
    if (!p5Prog) { wrap.innerHTML = ''; return; }
    const obs = (p5Prog.obligaciones || []).filter(o => o.seleccionado);

    // Agrupar por agrupadorPago
    const byAgrup = {};
    obs.forEach(ob => {
      const ag = (ob.agrupadorPago || 'INDIVIDUAL').trim().toUpperCase();
      if (!byAgrup[ag]) byAgrup[ag] = [];
      byAgrup[ag].push(ob);
    });

    // Orden: INDIVIDUAL primero, luego el resto alfabético
    const agrupOrden = Object.keys(byAgrup).sort((a, b) => {
      if (a === 'INDIVIDUAL') return -1;
      if (b === 'INDIVIDUAL') return 1;
      return a.localeCompare(b);
    });

    const totObs = list => ({
      usd: list.filter(o=>o.moneda!=='LO').reduce((s,o)=>s+netoOb(o),0),
      sol: list.filter(o=>o.moneda==='LO').reduce((s,o)=>s+netoOb(o),0)
    });
    const totBadges = (t, size='11px') =>
      (t.usd ? `<span style="font-size:${size};color:#7c3aed;font-weight:600;white-space:nowrap">USD&nbsp;${fmtN(t.usd)}</span>` : '') +
      (t.usd && t.sol ? ' ' : '') +
      (t.sol ? `<span style="font-size:${size};color:#7c3aed;font-weight:600;white-space:nowrap">S/&nbsp;${fmtN(t.sol)}</span>` : '');

    let html = '';

    agrupOrden.forEach(agrup => {
      const agrupObs = byAgrup[agrup];
      const agKey    = agrup.replace(/\W/g,'_');
      const isIndiv  = agrup === 'INDIVIDUAL';

      if (isIndiv) {
        // ── INDIVIDUALES: filas por beneficiario, N°op/banco/moneda inline ──
        const byBenef = {};
        agrupObs.forEach(ob => {
          const k = ob.pagarA || '(sin beneficiario)';
          if (!byBenef[k]) byBenef[k] = [];
          byBenef[k].push(ob);
        });

        const agrupTot = totObs(agrupObs);
        html += `
        <div style="margin-bottom:14px;border:1px solid #c7d7f8;border-radius:8px;overflow:hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 16px;background:#f0f4ff;flex-wrap:wrap">
            <span style="font-weight:700;font-size:13px;color:#1d4ed8">INDIVIDUALES</span>
            <span style="font-size:11px;color:#64748b">${agrupObs.length} obligación(es)</span>
            <span style="flex:1"></span>
            ${totBadges(agrupTot,'11px')}
          </div>`;

        Object.keys(byBenef).sort((a,b)=>a.localeCompare(b)).forEach(benef => {
          const bObs    = byBenef[benef];
          const bKey    = `${agKey}__${benef.replace(/\W/g,'_')}`;
          const bTot    = totObs(bObs);
          const op      = bObs[0]?.operacionBancaria || '';
          const efBanco = bObs[0]?.p5Banco  || bObs[0]?.bancoAsignado || '';
          const efMon   = bObs[0]?.p5Moneda || (bObs[0]?.moneda==='LO'?'SOL':'USD');

          html += `
          <div style="border-top:1px solid #e2e8f0">
            <!-- Fila compact: nombre + totales + banco/mon/N°op inline -->
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;
                        padding:6px 12px 6px 20px;background:#fafafa;${pgAdelantoRowStyle(benef)}" onclick="event.stopPropagation()">
              <span onclick="p5ToggleAgrup('${esc(bKey)}')" class="p5-agrup-arr"
                    style="cursor:pointer;font-size:10px;color:#94a3b8;padding:2px 4px">▸</span>
              <span style="font-weight:600;font-size:13px;color:#374151;flex:1;min-width:140px">${esc(benef)}${pgAdelantoBadgeHtml(benef)}</span>
              ${totBadges(bTot,'11px')}
              <span style="font-size:11px;color:#1d4ed8;font-weight:500;min-width:60px">${esc(efBanco)||'—'}</span>
              <span style="font-size:11px;color:#059669;font-weight:600;min-width:32px">${esc(efMon)}</span>
              <input type="number" min="0" step="1" class="form-control"
                     style="width:90px;font-size:11px;height:26px" placeholder="N° Op"
                     value="${op}"
                     oninput="p5SetOpBenef('${esc(agrup)}','${esc(benef)}',this.value)">
            </div>
            <!-- Detalle de obligaciones (expandible, con N°op por fila) -->
            <div id="p5agrup-body-${esc(bKey)}" style="display:none;border-top:1px solid #e9d5ff;background:#faf5ff">
              ${p5TablaObs(bObs)}
            </div>
          </div>`;
        });

        html += `</div>`;

      } else {
        // ── AGRUPADO X: cabecera con N°op/banco/moneda → beneficiarios → obligaciones ──
        const agTot   = totObs(agrupObs);
        const op      = agrupObs[0]?.operacionBancaria || '';
        const efBanco = agrupObs[0]?.p5Banco  || agrupObs[0]?.bancoAsignado || '';
        const efMon   = agrupObs[0]?.p5Moneda || (agrupObs[0]?.moneda==='LO'?'SOL':'USD');

        // Sub-agrupar por beneficiario
        const byBenef = {};
        agrupObs.forEach(ob => {
          const k = ob.pagarA || '(sin beneficiario)';
          if (!byBenef[k]) byBenef[k] = [];
          byBenef[k].push(ob);
        });

        // Filas de beneficiarios (expandibles a obligaciones)
        let benefRows = '';
        Object.keys(byBenef).sort((a,b)=>a.localeCompare(b)).forEach(benef => {
          const bObs  = byBenef[benef];
          const bTot  = totObs(bObs);
          const bKey  = `${agKey}__${benef.replace(/\W/g,'_')}`;
          benefRows += `
          <div style="border-top:1px solid #e2e8f0">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;
                        padding:5px 12px 5px 28px;background:#f8faff;${pgAdelantoRowStyle(benef)}" onclick="event.stopPropagation()">
              <span onclick="p5ToggleAgrup('${esc(bKey)}')" class="p5-agrup-arr"
                    style="cursor:pointer;font-size:10px;color:#94a3b8;padding:2px 4px">▸</span>
              <span style="font-size:12px;color:#374151;font-weight:600;flex:1;min-width:120px">${esc(benef)}${pgAdelantoBadgeHtml(benef)}</span>
              ${totBadges(bTot,'10px')}
              <span style="font-size:10px;color:#94a3b8">${bObs.length} oblig.</span>
            </div>
            <div id="p5agrup-body-${esc(bKey)}" style="display:none;background:#faf5ff">
              ${p5TablaObs(bObs)}
            </div>
          </div>`;
        });

        html += `
        <div style="margin-bottom:14px;border:1px solid #c7d7f8;border-radius:8px;overflow:hidden">
          <!-- Cabecera agrupador: nombre + banco/mon/N°op inline -->
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;
                      padding:10px 16px;background:#f0f4ff" onclick="event.stopPropagation()">
            <span onclick="p5ToggleBanco('${esc(agKey)}')" class="p5-banco-arr"
                  style="cursor:pointer;font-size:11px;color:#94a3b8;padding:2px 4px">▸</span>
            <span style="font-weight:700;font-size:14px;color:#1d4ed8;flex:1;min-width:140px">${esc(agrup)}</span>
            <span style="font-size:11px;color:#64748b">${agrupObs.length} oblig.</span>
            ${totBadges(agTot,'11px')}
            <span style="font-size:11px;color:#1d4ed8;font-weight:500;min-width:60px">${esc(efBanco)||'—'}</span>
            <span style="font-size:11px;color:#059669;font-weight:600;min-width:32px">${esc(efMon)}</span>
            <input type="number" min="0" step="1" class="form-control"
                   style="width:90px;font-size:11px;height:26px" placeholder="N° Op"
                   value="${op}"
                   oninput="p5SetOpAgrup('${esc(agrup)}',this.value)">
          </div>
          <!-- Nivel 2: beneficiarios expandibles -->
          <div id="p5banco-body-${esc(agKey)}" style="display:none">
            ${benefRows}
          </div>
        </div>`;
      }
    });

    wrap.innerHTML = html || '<p style="color:var(--text-muted);padding:16px">No hay obligaciones seleccionadas.</p>';
  }

  // ── Tabla de conciliación ────────────────────────────────────────
  function p5RenderComparacion() {
    const el = document.getElementById('p5-comparacion');
    if (!el || !p5Prog) { if (el) el.innerHTML = ''; return; }
    const obs = (p5Prog.obligaciones || []).filter(o => o.seleccionado);

    // Lookup del EC cargado: banco → moneda → nroDoc(norm) → importe
    const ecLookup = {};
    p5Estados.forEach(ec => {
      if (!ecLookup[ec.banco]) ecLookup[ec.banco] = {};
      if (!ecLookup[ec.banco][ec.moneda]) ecLookup[ec.banco][ec.moneda] = {};
      (ec.transacciones||[]).forEach(t => {
        const k = String(parseInt(t.nroDoc||'0',10)||0);
        if (k !== '0') ecLookup[ec.banco][ec.moneda][k] = t.importe;
      });
    });

    // Agrupar por banco + moneda + N° operación (clave compuesta para evitar colisiones)
    const opMap = {};
    obs.forEach(ob => {
      const opNum = (ob.operacionBancaria || '').trim();
      if (!opNum) return;
      const banco  = ob.p5Banco  || ob.bancoAsignado || '(sin banco)';
      const moneda = ob.p5Moneda || (ob.moneda === 'LO' ? 'SOL' : 'USD');
      const key = `${banco}|${moneda}|${opNum}`;
      if (!opMap[key]) opMap[key] = { opNum, banco, moneda, totalOblig:0, count:0, allPaid:true };
      opMap[key].totalOblig += netoOb(ob);
      opMap[key].count++;
      if (!ob.pagada) opMap[key].allPaid = false;
    });

    const entries = Object.entries(opMap).sort(([a],[b]) => {
      const [ab, am, ao] = a.split('|');
      const [bb, bm, bo] = b.split('|');
      // ordenar por banco, moneda, luego número de operación
      return ab.localeCompare(bb) || am.localeCompare(bm) || Number(ao) - Number(bo) || ao.localeCompare(bo);
    });
    const sinOp = obs.filter(o => !(o.operacionBancaria||'').trim()).length;

    if (!entries.length && !sinOp) { el.innerHTML = ''; return; }

    const canPayAny = puedePagar && p5Prog.estado === 'autorizado';
    const rows = entries.map(([, d]) => {
      const { opNum } = d;
      const nroKey    = String(parseInt(opNum,10)||0);
      const ecImporte = ecLookup[d.banco]?.[d.moneda]?.[nroKey] ?? null;
      const dif    = ecImporte != null ? ecImporte + d.totalOblig : null;
      const difOk  = dif != null && Math.abs(dif) < 0.01;
      const rowBg  = d.allPaid ? 'background:#f0fdf4'
                   : dif != null && !difOk ? 'background:#fee2e2' : '';
      const pagarBtn = !d.allPaid && canPayAny
        ? `<button onclick="p5PagarOp('${esc(d.banco)}','${esc(d.moneda)}','${esc(opNum)}')"
                   style="background:#15803d;color:#fff;border:none;padding:2px 10px;border-radius:4px;
                          font-size:11px;cursor:pointer;white-space:nowrap">💳 Pagar</button>`
        : d.allPaid
          ? `<span style="color:#16a34a;font-weight:700;font-size:12px">✅ Pagada</span>`
          : '';
      return `
        <tr style="border-top:1px solid #e2e8f0;${rowBg}">
          <td style="padding:6px 10px;font-family:monospace;font-size:12px;white-space:nowrap">${esc(opNum)}</td>
          <td style="padding:6px 10px;font-size:12px">${esc(d.banco)}</td>
          <td style="padding:6px 10px;font-size:12px">${esc(d.moneda)}</td>
          <td style="padding:6px 10px;text-align:center;font-size:12px">${d.count}</td>
          <td style="padding:6px 10px;text-align:right;font-weight:600;font-size:12px">${fmtN(d.totalOblig)}</td>
          <td style="padding:6px 10px;text-align:right;font-size:12px;color:${ecImporte!=null?'#dc2626':'#94a3b8'}">
            ${ecImporte != null ? fmtN(ecImporte) : '—'}
          </td>
          <td style="padding:6px 10px;text-align:right;font-weight:700;font-size:12px;
                     color:${difOk?'#16a34a':dif!=null?'#dc2626':'#94a3b8'}">
            ${dif != null ? (difOk ? '✓' : ((dif>0?'+':'')+fmtN(dif))) : '—'}
          </td>
          <td style="padding:6px 10px;text-align:center">${pagarBtn}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="padding:8px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;
                    display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px;color:#374151">📊 Conciliación</span>
          ${sinOp ? `<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px">⚠️ ${sinOp} sin N° operación</span>` : '<span style="font-size:11px;background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:4px">✓ Todas con N° op</span>'}
        </div>
        ${entries.length ? `
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f1f5f9;font-size:11px;color:var(--text-muted)">
              <th style="padding:6px 10px;text-align:left;white-space:nowrap">N° Operación</th>
              <th style="padding:6px 10px;text-align:left;white-space:nowrap">Banco</th>
              <th style="padding:6px 10px;text-align:left;white-space:nowrap">Mon</th>
              <th style="padding:6px 10px;text-align:center;white-space:nowrap"># Oblig</th>
              <th style="padding:6px 10px;text-align:right;white-space:nowrap">Total Prog.</th>
              <th style="padding:6px 10px;text-align:right;white-space:nowrap">Importe EC</th>
              <th style="padding:6px 10px;text-align:right;white-space:nowrap">Diferencia</th>
              <th style="padding:6px 10px;text-align:center;white-space:nowrap">Pago</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        </div>` : ''}
      </div>`;
  }

  // ── Footer ───────────────────────────────────────────────────────
  function p5RenderFooter() {
    const obs = (p5Prog?.obligaciones || []).filter(o => o.seleccionado);
    const tc  = parseFloat(document.getElementById('p5-tc')?.value) || 1;
    const totalUSD = obs.filter(o=>o.moneda!=='LO').reduce((s,o)=>s+netoOb(o),0);
    const totalSOL = obs.filter(o=>o.moneda==='LO').reduce((s,o)=>s+netoOb(o),0);
    const totalTot = totalSOL + totalUSD * tc;

    p5Footer.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;overflow-x:auto">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-muted)">Obligaciones:&nbsp;<strong style="color:#111">${obs.length}</strong></span>
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:11px;color:var(--text-muted)">Neto:</span>
          ${totalUSD ? `<span style="font-size:13px">USD&nbsp;<strong>${fmtN(totalUSD)}</strong></span>` : ''}
          ${totalSOL ? `<span style="font-size:13px">S/&nbsp;<strong>${fmtN(totalSOL)}</strong></span>` : ''}
          <div style="width:1px;height:16px;background:#e2e8f0"></div>
          <span style="font-size:13px">Todo en S/:&nbsp;<strong style="color:var(--primary);font-size:14px">${fmtN(totalTot)}</strong></span>
        </div>
      </div>
      ${p5Prog ? `
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          ${p5Prog.estado === 'pagado'
            ? `<span style="font-size:11px;background:#dcfce7;color:#15803d;border-radius:4px;padding:2px 8px;font-weight:600">✅ Pagada</span>`
            : ''}
          <button class="btn btn-outline btn-sm" onclick="p5Guardar()">💾 Grabar</button>
          ${(puedePagar && p5Prog.estado === 'autorizado')
            ? `<button class="btn btn-success btn-sm" onclick="p5Pagar()" style="background:#15803d;color:#fff;border:none"
                       title="Registrar el pago de todas las obligaciones seleccionadas de esta programación">💳 Pagar</button>`
            : ''}
          <button class="btn btn-outline btn-sm" onclick="p5CargaMasiva()"
                  title="Ver beneficiarios y asignar correos">👥 Beneficiarios</button>
          <button class="btn btn-outline btn-sm" onclick="p5VerSinCorreo()"
                  title="Beneficiarios sin correo en esta programación">⚠️ Sin correo</button>
          <button class="btn btn-primary btn-sm" onclick="p5EnviarCorreo()"
                  title="Enviar notificación de pago por correo">✉️ Enviar correo</button>
          ${S.user.role === 'ADMIN' ? `
            <button class="btn btn-sm" onclick="p5EliminarProg()"
                    style="border:1px solid #dc2626;color:#dc2626;background:#fff"
                    title="Eliminar esta programación (solo ADMIN)">🗑️ Eliminar</button>` : ''}
        </div>` : ''}`;
    p5Footer.style.display = p5Prog ? 'flex' : 'none';
  }

  // ── Cargar lista ─────────────────────────────────────────────────
  async function p5CargarLista() {
    const comp = document.getElementById('p5-compania')?.value;
    const el   = document.getElementById('p5-lista');
    if (!comp) { el.innerHTML = ''; return; }
    const BADGES = {
      autorizado: `<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 4px">🔑 Autorizada</span>`,
      pagado:     `<span style="font-size:10px;background:#dcfce7;color:#15803d;border-radius:3px;padding:1px 4px">✅ Pagada</span>`,
    };
    try {
      const [auth, paid] = await Promise.all([
        GET(`/pagos/programaciones?compania=${encodeURIComponent(comp)}&estado=autorizado`),
        GET(`/pagos/programaciones?compania=${encodeURIComponent(comp)}&estado=pagado`),
      ]);
      const data = [...auth, ...paid];
      if (!data.length) {
        el.innerHTML = `<p style="color:var(--text-muted);font-size:13px">No hay programaciones autorizadas para <strong>${esc(comp)}</strong>.</p>`;
        return;
      }
      el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${data.map(p => `
          <button class="p5-prog-btn btn btn-outline btn-sm${p5Prog?._id===p._id?' active':''}"
                  data-id="${p._id}"
                  style="font-size:12px;${p5Prog?._id===p._id?'background:#dbeafe;border-color:#3b82f6':''}">
            Semana ${p.semana||''}/${p.año||''}
            &nbsp;${BADGES[p.estado]||''}
          </button>`).join('')}
      </div>`;
      document.querySelectorAll('.p5-prog-btn').forEach(btn =>
        btn.addEventListener('click', () => p5AbrirProg(btn.dataset.id))
      );
    } catch(e) { el.innerHTML = `<p style="color:#ef4444">${e.message}</p>`; }
  }

  // ── Abrir programación ───────────────────────────────────────────
  async function p5AbrirProg(id) {
    try {
      p5Prog = await GET(`/pagos/programaciones/${id}`);
      await pgAdelantosResumen(p5Prog.compania);
      p5RenderGrupos();
      // Auto-upsert de beneficiarios en Personas (en background, sin bloquear UI)
      {
        const benefs = [...new Set(
          (p5Prog.obligaciones||[]).filter(o=>o.seleccionado).map(o=>o.pagarA||'').filter(Boolean)
        )];
        if (benefs.length && p5Prog.compania) {
          POST('/personas/bulk-upsert', {
            personas: benefs.map(b => ({ nombre: b, compania: p5Prog.compania }))
          }).catch(() => {});
        }
      }
      // Expandir todos los bancos por defecto
      document.querySelectorAll('[id^="p5banco-body-"]').forEach(el => {
        el.style.display = '';
        const arr = el.previousElementSibling?.querySelector('.p5-banco-arr');
        if (arr) arr.textContent = '▾';
      });
      p5RenderFooter();
      p5RefreshECTablas();   // actualizar columnas prog/dif en la tabla bancaria
      await p5CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── Estados de Cuenta ────────────────────────────────────────────
  async function p5CargarEstados() {
    const comp = document.getElementById('p5-compania')?.value;
    if (!comp) return;
    try {
      p5Estados = await GET(`/pagos/estados-cuenta?compania=${encodeURIComponent(comp)}`);
      p5RenderEstados();
    } catch(e) { console.error('estados-cuenta:', e.message); }
  }

  // ecBanco y ecMoneda filtran el opMap para que solo aparezcan las
  // obligaciones asignadas a ESE banco+moneda (evita cruce entre tablas)
  function p5RenderECTabla(trxs, ecBanco, ecMoneda) {
    if (!trxs.length) return '<p style="padding:8px 14px;font-size:12px;color:var(--text-muted)">Sin transacciones.</p>';
    // Mapa N°op (normalizado sin ceros) → total programación SOLO para este banco+moneda
    const opMap = {};
    if (p5Prog) {
      (p5Prog.obligaciones||[]).filter(o => o.seleccionado).forEach(ob => {
        const raw = (ob.operacionBancaria||'').trim();
        if (!raw) return;
        // Filtrar: solo incluir obligaciones asignadas a este EC (banco+moneda)
        if (ecBanco || ecMoneda) {
          const obBanco  = ob.p5Banco  || ob.bancoAsignado || '';
          const obMoneda = ob.p5Moneda || (ob.moneda === 'LO' ? 'SOL' : 'USD');
          if (ecBanco  && obBanco  !== ecBanco)  return;
          if (ecMoneda && obMoneda !== ecMoneda) return;
        }
        const key = String(parseInt(raw, 10) || 0);
        if (key === '0') return;
        opMap[key] = (opMap[key] || 0) + netoOb(ob);
      });
    }
    const hayProg = Object.keys(opMap).length > 0;
    const fmt = v => Number(v).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
    return `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#f1f5f9;color:var(--text-muted)">
        <th style="padding:4px 8px;text-align:left;white-space:nowrap">Fecha</th>
        <th style="padding:4px 8px;text-align:left;white-space:nowrap">N° Op.</th>
        <th style="padding:4px 8px;text-align:left">Concepto</th>
        <th style="padding:4px 8px;text-align:right;white-space:nowrap">Importe</th>
        ${hayProg ? `
        <th style="padding:4px 8px;text-align:right;white-space:nowrap;color:#7c3aed">Prog.</th>
        <th style="padding:4px 8px;text-align:right;white-space:nowrap">Dif.</th>` : ''}
      </tr></thead>
      <tbody>${trxs.map(t => {
        const neg = (t.importe||0) < 0;
        const nroKey = String(parseInt(t.nroDoc||'0', 10) || 0);
        const totalProg = (nroKey !== '0' && opMap[nroKey] != null) ? opMap[nroKey] : null;
        // banco negativo + prog positivo → dif ≈ 0 si cuadra
        const dif   = totalProg != null ? (t.importe||0) + totalProg : null;
        const difOk = dif != null && Math.abs(dif) < 0.01;
        const rowBg = dif != null && !difOk ? 'background:#fef2f2' : '';
        return `<tr style="border-top:1px solid #f1f5f9;${rowBg}">
          <td style="padding:3px 8px;white-space:nowrap;color:#64748b">${t.fecha?new Date(t.fecha).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'}):'—'}</td>
          <td style="padding:3px 8px;font-family:monospace;color:#1d4ed8;white-space:nowrap">${esc(t.nroDoc||'')}</td>
          <td style="padding:3px 8px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.concepto||'')}</td>
          <td style="padding:3px 8px;text-align:right;font-weight:600;color:${neg?'#dc2626':'#16a34a'}">${fmt(t.importe||0)}</td>
          ${hayProg ? `
          <td style="padding:3px 8px;text-align:right;color:#7c3aed;font-weight:600">
            ${totalProg != null ? fmt(totalProg) : '<span style="color:#cbd5e1">—</span>'}
          </td>
          <td style="padding:3px 8px;text-align:right;font-weight:700;
                     color:${difOk?'#16a34a':dif!=null?'#dc2626':'#94a3b8'}">
            ${dif != null ? (difOk ? '✓' : (dif > 0 ? '+' : '') + fmt(dif)) : '—'}
          </td>` : ''}
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function p5RenderEstados() {
    const badge = document.getElementById('p5-estados-badge');
    if (badge) badge.textContent = p5Estados.length ? `(${p5Estados.length} cargado${p5Estados.length>1?'s':''})` : '';
    const el = document.getElementById('p5-estados-lista');
    if (!el) return;
    if (!p5Estados.length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Sin estados de cuenta cargados. Seleccione banco, moneda y suba el archivo .xlsx.</p>';
      return;
    }
    el.innerHTML = p5Estados.map(ec => {
      const id    = `${ec.banco}_${ec.moneda}`;
      const fecha = new Date(ec.cargadoEn).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});
      return `
        <div style="border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;overflow:hidden">
          <div onclick="p5ToggleEstadoCard('${esc(id)}')"
               style="display:flex;align-items:center;gap:10px;padding:8px 14px;
                      background:#f8fafc;cursor:pointer;user-select:none">
            <span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:3px;font-weight:700">🏦 ${esc(ec.banco)}</span>
            <span style="font-size:11px;background:#f0fdf4;color:#15803d;padding:2px 7px;border-radius:3px;font-weight:700">${esc(ec.moneda)}</span>
            <span style="font-size:12px;color:#374151;font-weight:500">${ec.transacciones.length} transacciones</span>
            <span style="font-size:11px;color:#94a3b8">Subido ${fecha}</span>
            <span id="p5-ec-arr-${esc(id)}" style="margin-left:auto;font-size:11px;color:var(--text-muted)">▸</span>
          </div>
          <div id="p5-ec-body-${esc(id)}" style="display:none">
            <div style="padding:6px 12px;border-bottom:1px solid #f1f5f9;
                        display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="text" id="p5-ec-q-${esc(id)}" class="form-control"
                     style="font-size:11px;height:26px;flex:1;min-width:120px"
                     placeholder="N° operación o concepto…"
                     oninput="p5FiltrarEC('${esc(id)}','${esc(ec.banco)}','${esc(ec.moneda)}')">
              <label style="display:flex;align-items:center;gap:4px;font-size:11px;
                            white-space:nowrap;cursor:pointer;color:#374151;user-select:none">
                <input type="checkbox" id="p5-ec-sal-${esc(id)}"
                       onchange="p5FiltrarEC('${esc(id)}','${esc(ec.banco)}','${esc(ec.moneda)}')">
                Solo salidas
              </label>
            </div>
            <div id="p5-ec-tabla-${esc(id)}" style="overflow-x:auto">
              ${p5RenderECTabla(ec.transacciones, ec.banco, ec.moneda)}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // p5ToggleEstados eliminado — panel bancario siempre visible

  window.p5ToggleEstadoCard = function(id) {
    const body = document.getElementById(`p5-ec-body-${id}`);
    const arr  = document.getElementById(`p5-ec-arr-${id}`);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  window.p5FiltrarEC = function(id, banco, moneda) {
    const ec = p5Estados.find(e => e.banco === banco && e.moneda === moneda);
    if (!ec) return;
    const q          = document.getElementById(`p5-ec-q-${id}`)?.value || '';
    const soloSal    = document.getElementById(`p5-ec-sal-${id}`)?.checked || false;
    const texto      = q.toLowerCase().trim();
    let filtradas    = ec.transacciones;
    if (texto)    filtradas = filtradas.filter(t =>
      (t.nroDoc||'').toLowerCase().includes(texto) ||
      (t.concepto||'').toLowerCase().includes(texto));
    if (soloSal)  filtradas = filtradas.filter(t => (t.importe||0) < 0);
    const tablaEl = document.getElementById(`p5-ec-tabla-${id}`);
    if (tablaEl) tablaEl.innerHTML = p5RenderECTabla(filtradas, banco, moneda);
  };

  // Re-renderiza todas las tablas EC (útil al cambiar N° op en la programación)
  function p5RefreshECTablas() {
    p5Estados.forEach(ec => {
      const id = `${ec.banco}_${ec.moneda}`;
      const tablaEl = document.getElementById(`p5-ec-tabla-${id}`);
      if (!tablaEl) return;
      // Re-aplicar filtros actuales
      const q       = document.getElementById(`p5-ec-q-${id}`)?.value || '';
      const soloSal = document.getElementById(`p5-ec-sal-${id}`)?.checked || false;
      const texto   = q.toLowerCase().trim();
      let filtradas = ec.transacciones;
      if (texto)   filtradas = filtradas.filter(t =>
        (t.nroDoc||'').toLowerCase().includes(texto) ||
        (t.concepto||'').toLowerCase().includes(texto));
      if (soloSal) filtradas = filtradas.filter(t => (t.importe||0) < 0);
      tablaEl.innerHTML = p5RenderECTabla(filtradas, ec.banco, ec.moneda);
    });
  }

  window.p5SubirEstado = async function() {
    const comp   = document.getElementById('p5-compania')?.value;
    const banco  = document.getElementById('p5-upload-banco')?.value;
    const moneda = document.getElementById('p5-upload-moneda')?.value;
    const fileEl = document.getElementById('p5-upload-file');
    const file   = fileEl?.files[0];
    const status = document.getElementById('p5-upload-status');
    if (!comp)   { toast('Seleccione una sociedad primero', 'warning'); return; }
    if (!banco)  { toast('Seleccione el banco', 'warning'); return; }
    if (!moneda) { toast('Seleccione la moneda', 'warning'); return; }
    if (!file)   return;
    if (status) status.textContent = '⏳ Procesando...';
    try {
      const fd = new FormData();
      fd.append('compania', comp);
      fd.append('banco', banco);
      fd.append('moneda', moneda);
      fd.append('archivo', file);
      const resp  = await fetch('/api/pagos/estados-cuenta', {
        method: 'POST',
        headers: { Authorization: `Bearer ${S.token}` },
        body: fd
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      if (status) status.textContent = `✅ ${data.count} transacciones cargadas`;
      if (fileEl)  fileEl.value = '';
      await p5CargarEstados();
      // Auto-expandir la tarjeta recién subida
      const id = `${banco}_${moneda}`;
      const body = document.getElementById(`p5-ec-body-${id}`);
      const arr  = document.getElementById(`p5-ec-arr-${id}`);
      if (body && body.style.display === 'none') {
        body.style.display = '';
        if (arr) arr.textContent = '▾';
      }
    } catch(e) {
      if (status) status.textContent = `❌ ${e.message}`;
      toast(e.message, 'error');
    }
  };

  // ── Toggle banco / agrupador ─────────────────────────────────────
  window.p5ToggleBanco = function(bKey) {
    const body = document.getElementById(`p5banco-body-${bKey}`);
    const arr  = body?.previousElementSibling?.querySelector('.p5-banco-arr');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  window.p5ToggleAgrup = function(aKey) {
    const body = document.getElementById(`p5agrup-body-${aKey}`);
    const arr  = body?.previousElementSibling?.querySelector('.p5-agrup-arr');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (arr) arr.textContent = open ? '▸' : '▾';
  };

  // ── Setters nivel beneficiario (INDIVIDUALES: agrup + pagarA) ───
  function obsBenef(agrup, benef) {
    const ag = agrup.trim().toUpperCase();
    return (p5Prog?.obligaciones||[]).filter(o => o.seleccionado &&
      (o.agrupadorPago||'INDIVIDUAL').trim().toUpperCase() === ag &&
      (o.pagarA||'(sin beneficiario)') === benef);
  }
  window.p5SetOpBenef = function(agrup, benef, val) {
    if (!p5Prog) return;
    obsBenef(agrup, benef).forEach(ob => {
      ob.operacionBancaria = val;
      // Sincronizar input individual si está visible en el DOM
      const inp = document.querySelector(`input[data-obid="${ob._id}"]`);
      if (inp) inp.value = val;
    });
    p5RefreshECTablas();
  };
  window.p5SetBancoBenef = function(agrup, benef, val) {
    if (!p5Prog) return;
    obsBenef(agrup, benef).forEach(ob => ob.p5Banco = val);
    p5RefreshECTablas();
  };
  window.p5SetMonedaBenef = function(agrup, benef, val) {
    if (!p5Prog) return;
    obsBenef(agrup, benef).forEach(ob => ob.p5Moneda = val);
    p5RefreshECTablas();
  };

  // ── Setters nivel agrupador (AGRUPADO X) ────────────────────────
  function obsAgrup(agrup) {
    const ag = agrup.trim().toUpperCase();
    return (p5Prog?.obligaciones||[]).filter(o => o.seleccionado &&
      (o.agrupadorPago||'INDIVIDUAL').trim().toUpperCase() === ag);
  }
  window.p5SetOpAgrup = function(agrup, val) {
    if (!p5Prog) return;
    obsAgrup(agrup).forEach(ob => {
      ob.operacionBancaria = val;
      const inp = document.querySelector(`input[data-obid="${ob._id}"]`);
      if (inp) inp.value = val;
    });
    p5RefreshECTablas();
  };
  window.p5SetBancoAgrup = function(agrup, val) {
    if (!p5Prog) return;
    obsAgrup(agrup).forEach(ob => ob.p5Banco = val);
    p5RefreshECTablas();
  };
  window.p5SetMonedaAgrup = function(agrup, val) {
    if (!p5Prog) return;
    obsAgrup(agrup).forEach(ob => ob.p5Moneda = val);
    p5RefreshECTablas();
  };

  // ── Setter nivel obligación individual ──────────────────────────
  window.p5SetOpOb = function(obId, val) {
    if (!p5Prog) return;
    const ob = (p5Prog.obligaciones||[]).find(o => String(o._id) === obId);
    if (ob) ob.operacionBancaria = val;
    p5RefreshECTablas();
  };

  // ── Guardar / Registrar Pago ─────────────────────────────────────
  function p5BuildAsig() {
    return (p5Prog.obligaciones||[]).filter(o => o.seleccionado).map(ob => ({
      id: ob._id,
      operacionBancaria: ob.operacionBancaria || '',
      importeBanco: ob.importeBanco != null ? ob.importeBanco : null,
      p5Banco:  ob.p5Banco  || '',
      p5Moneda: ob.p5Moneda || '',
    }));
  }

  window.p5Guardar = async function() {
    if (!p5Prog) return;
    try {
      await PUT(`/pagos/programaciones/${p5Prog._id}/guardar-p5`, { asignaciones: p5BuildAsig() });
      toast('Cambios guardados', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Carga masiva de personas ──────────────────────────────────────
  // Muestra modal con todos los beneficiarios de la programación,
  // su correo actual (si existe en Personas) y permite asignarlo.
  window.p5CargaMasiva = async function() {
   try {
    if (!p5Prog) { toast('Abra primero una programación', 'error'); return; }
    const comp  = p5Prog.compania;
    const benefs = [...new Set(
      (p5Prog.obligaciones||[]).filter(o=>o.seleccionado).map(o=>o.pagarA||'').filter(Boolean)
    )].sort();

    if (!benefs.length) { toast('No hay beneficiarios seleccionados en esta programación', 'error'); return; }

    // Traer personas existentes de esta compañía
    let personas = [];
    try { personas = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`)); } catch(_){}

    const porNombre = {};
    personas.forEach(p => { porNombre[p.nombre] = p; });

    // Upsert básico: crear las que no existen aún (sin correo)
    const nuevas = benefs.filter(b => !porNombre[b]);
    if (nuevas.length) {
      try {
        await POST('/personas/bulk-upsert', {
          personas: nuevas.map(b => ({ nombre: b, compania: comp }))
        });
        // Recargar
        personas = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`));
        personas.forEach(p => { porNombre[p.nombre] = p; });
      } catch(_){}
    }

    const filas = benefs.map(b => {
      const p  = porNombre[b];
      const cs = (p?.correos||[]).join(', ');
      const id = p?._id || '';
      return `<tr>
        <td style="padding:6px 10px;font-size:13px;font-weight:500">${esc(b)}</td>
        <td style="padding:6px 10px">
          <input class="form-control" style="font-size:12px;height:28px" id="cm-correo-${esc(id||b)}"
                 placeholder="correo1@ej.com, correo2@ej.com"
                 value="${esc(cs)}"
                 data-id="${esc(id)}" data-nombre="${esc(b)}">
        </td>
      </tr>`;
    }).join('');

    const html = `
      <div style="max-height:60vh;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9;font-size:12px;color:var(--text-muted)">
            <th style="padding:6px 10px;text-align:left">Beneficiario</th>
            <th style="padding:6px 10px;text-align:left">Correos (separados por coma)</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="cm-guardar-btn">💾 Guardar todos</button>
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      </div>`;

    openModal('👥 Beneficiarios — Asignación de correos', html);

    document.getElementById('cm-guardar-btn').addEventListener('click', async () => {
      const inputs = document.querySelectorAll('#modal-body input[data-id]');
      let ok = 0, err = 0;
      for (const inp of inputs) {
        const id     = inp.dataset.id;
        const nombre = inp.dataset.nombre;
        const correos = inp.value.split(',').map(s=>s.trim()).filter(Boolean);
        try {
          if (id) {
            await PUT(`/personas/${id}/correo-rapido`, { correos });
          } else {
            // Crear si no tiene id
            await POST('/personas', { nombre, telefono:'', correos, compania: comp });
          }
          ok++;
        } catch(_) { err++; }
      }
      toast(`✅ ${ok} guardados${err?' | ⚠️ '+err+' errores':''}`, ok ? 'success' : 'error');
      closeModal();
    });
   } catch(e) { console.error('p5CargaMasiva', e); toast('Error al abrir beneficiarios: ' + e.message, 'error'); }
  };

  // ── Ver beneficiarios sin correo ──────────────────────────────────
  window.p5VerSinCorreo = async function() {
    if (!p5Prog) return;
    const comp   = p5Prog.compania;
    const benefs = new Set(
      (p5Prog.obligaciones||[]).filter(o=>o.seleccionado).map(o=>o.pagarA||'').filter(Boolean)
    );
    let sinCorreo = [];
    try {
      const todos = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`));
      sinCorreo = todos.filter(p => benefs.has(p.nombre) && !(p.correos||[]).length);
      // También incluir beneficiarios que no están aún en Personas
      const enPersonas = new Set(todos.map(p=>p.nombre));
      [...benefs].forEach(b => { if (!enPersonas.has(b)) sinCorreo.push({ nombre: b, _id: null }); });
    } catch(_){}

    if (!sinCorreo.length) {
      return openModal('✅ Sin correo', '<p style="padding:16px">Todos los beneficiarios de esta programación tienen correo asignado.</p>');
    }

    const filas = sinCorreo.map(p => `
      <tr>
        <td style="padding:6px 10px;font-size:13px">${esc(p.nombre)}</td>
        <td style="padding:6px 10px">
          <input class="form-control" style="font-size:12px;height:28px" required
                 id="sc-correo-${esc(p._id||p.nombre)}"
                 placeholder="correo@empresa.com (obligatorio)"
                 data-id="${esc(p._id||'')}" data-nombre="${esc(p.nombre)}">
        </td>
      </tr>`).join('');

    const html = `
      <p style="font-size:13px;color:#dc2626;margin-bottom:12px">
        Los siguientes beneficiarios <strong>no tienen correo</strong> asignado. Ingrese al menos uno para poder enviarles la notificación.
      </p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#fef2f2;font-size:12px;color:var(--text-muted)">
          <th style="padding:6px 10px;text-align:left">Beneficiario</th>
          <th style="padding:6px 10px;text-align:left">Correo *</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="sc-guardar-btn">💾 Guardar correos</button>
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      </div>`;

    openModal('⚠️ Beneficiarios sin correo', html);

    document.getElementById('sc-guardar-btn').addEventListener('click', async () => {
      const inputs = document.querySelectorAll('#modal-body input[data-id]');
      let ok = 0, err = 0, lastErr = '';
      for (const inp of inputs) {
        const correos = inp.value.split(',').map(s=>s.trim()).filter(Boolean);
        if (!correos.length) continue;
        const id     = inp.dataset.id;
        const nombre = inp.dataset.nombre;
        try {
          if (id) {
            await PUT(`/personas/${id}/correo-rapido`, { correos });
          } else {
            try {
              await POST('/personas', { nombre, telefono:'', correos, compania: comp });
            } catch (e1) {
              // Si ya existe (carrera con otro proceso o no se detectó antes), buscar y actualizar
              const existente = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`))
                .find(p => p.nombre === nombre);
              if (existente?._id) {
                await PUT(`/personas/${existente._id}/correo-rapido`, { correos });
              } else {
                throw e1;
              }
            }
          }
          ok++;
        } catch(e) { err++; lastErr = e.message || ''; }
      }
      toast(`✅ ${ok} correo(s) guardado(s)${err ? ` | ⚠️ ${err} con error${lastErr ? ': ' + lastErr : ''}` : ''}`, err && !ok ? 'error' : 'success');
      if (ok) closeModal();
    });
  };

  // ── Enviar correo de pago ─────────────────────────────────────────
  // Envía notificación a los beneficiarios con obligaciones pagadas.
  // Si no se especifica banco/moneda/op, aplica a todas las pagadas.
  window.p5EnviarCorreo = async function(banco, moneda, operacionBancaria) {
    if (!p5Prog) return;
    const obs = (p5Prog.obligaciones||[]).filter(o=>o.seleccionado && o.pagada);
    if (!obs.length) return toast('No hay obligaciones pagadas en esta programación', 'error');

    const label = banco && moneda && operacionBancaria
      ? `\nBanco: ${banco} | Moneda: ${moneda} | Op. ${operacionBancaria}`
      : '\n(Se incluirán todas las obligaciones pagadas)';
    if (!confirm(`¿Enviar correo de notificación de pago?${label}`)) return;

    try {
      const data = await POST('/personas/enviar-correo-pago', {
        progId: p5Prog._id,
        banco:  banco  || '',
        moneda: moneda || '',
        operacionBancaria: operacionBancaria || '',
      });
      const sent      = data?.sent ?? 0;
      const sinCorreo = data?.sinCorreo || [];

      toast(`✅ ${sent} correo${sent === 1 ? '' : 's'} de notificación enviado${sent === 1 ? '' : 's'}`, sent ? 'success' : 'error');

      openModal('✉️ Notificación de pago — resultado del envío', `
        <div style="padding:4px 0">
          <p style="font-size:14px;margin-bottom:10px">
            ${sent
              ? `✅ Se ${sent === 1 ? 'envió' : 'enviaron'} <strong>${sent}</strong> correo${sent === 1 ? '' : 's'} de notificación de pago${label.replace(/\n/g, ' — ').trim()}.`
              : `⚠️ No se envió ningún correo${label.replace(/\n/g, ' — ').trim()}.`}
          </p>
          ${sinCorreo.length ? `
            <p style="font-size:13px;color:#dc2626;margin:12px 0 6px;font-weight:600">⚠️ ${sinCorreo.length} beneficiario(s) sin correo asignado (no recibieron notificación):</p>
            <ul style="font-size:12px;color:#6b7280;margin:0 0 12px 18px;max-height:140px;overflow-y:auto">
              ${sinCorreo.map(b => `<li>${esc(b)}</li>`).join('')}
            </ul>
            <button class="btn btn-outline btn-sm" onclick="closeModal();p5VerSinCorreo()">📧 Asignar correos ahora</button>
          ` : ''}
          <div style="margin-top:16px;text-align:right">
            <button class="btn btn-primary btn-sm" onclick="closeModal()">Cerrar</button>
          </div>
        </div>
      `);
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Pagar operación específica (banco+moneda+N°op) ───────────────
  window.p5PagarOp = async function(banco, moneda, opNum) {
    if (!p5Prog) return;
    if (!confirm(`¿Registrar pago de la operación N° ${opNum}\nBanco: ${banco} | Moneda: ${moneda}?\n\nSolo se marcarán las obligaciones de esta combinación.`)) return;
    try {
      const data = await PUT(`/pagos/programaciones/${p5Prog._id}/pagar-op`, {
        banco, moneda, operacionBancaria: opNum,
        asignaciones: p5BuildAsig(),
      });
      const msg = `✅ ${data.marked} obligación(es) pagada(s)` +
                  (data.progEstado === 'pagado' ? ' — Programación completamente pagada' : '');
      toast(msg, 'success');
      await p5AbrirProg(p5Prog._id);
    } catch(e) { toast(e.message, 'error'); }
  };

  window.p5Pagar = async function() {
    if (!p5Prog) return;
    const obs   = (p5Prog.obligaciones||[]).filter(o => o.seleccionado);
    const sinOp = obs.filter(o => !(o.operacionBancaria||'').trim()).length;
    if (sinOp) {
      if (!confirm(`⚠️ Hay ${sinOp} obligación(es) sin N° de operación bancaria.\n¿Registrar el pago de todas formas?`)) return;
    }
    if (!confirm(`¿Confirmar registro de pago de esta programación con ${obs.length} obligaciones?`)) return;
    try {
      await PUT(`/pagos/programaciones/${p5Prog._id}/pagar`, { asignaciones: p5BuildAsig() });
      toast('✅ Pago registrado', 'success');
      p5Prog = null;
      document.getElementById('p5-wrap').innerHTML = '';
      p5RenderFooter();
      await p5CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Eliminar programación (solo ADMIN) ───────────────────────────
  window.p5EliminarProg = async function() {
    if (!p5Prog) return;
    if (S.user.role !== 'ADMIN') return;
    if (!confirm(`⚠️ ¿Eliminar definitivamente la programación Sem ${p5Prog.semana}/${p5Prog.año} de ${p5Prog.compania} (estado: ${p5Prog.estado})?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      await DEL(`/pagos/programaciones/${p5Prog._id}`);
      toast('🗑️ Programación eliminada', 'success');
      p5Prog = null;
      document.getElementById('p5-wrap').innerHTML = '';
      p5RenderFooter();
      await p5CargarLista();
    } catch(e) { toast(e.message, 'error'); }
  };

  // ── Sociedad onChange ────────────────────────────────────────────
  document.getElementById('p5-compania').addEventListener('change', async () => {
    p5Prog = null;
    document.getElementById('p5-wrap').innerHTML = '';
    p5RenderFooter();
    await Promise.all([p5CargarLista(), p5CargarEstados()]);
  });

  // Init
  p5RenderFooter();
}

// ─── View: Admin ──────────────────────────────────────────────────
// ─── View: Flujo de Caja ─────────────────────────────────────────
async function viewFlujoCaja(container) {
  const esAdminFC = S.user.role === 'ADMIN' || S.user.rolPago === 'admin';
  const socsFC    = esAdminFC ? ALL_SOCS_COMPRA : (S.user.sociedadesPago || []);

  const fmtMonto = n => (n||0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const SECCION_LABEL = {
    SALDO_INICIAL:   '1. SALDO INICIAL',
    INGRESOS:        '2. INGRESOS',
    EGRESOS:         '3. EGRESOS',
    OTROS:           '4. OTROS',
    POR_IDENTIFICAR: '5. POR IDENTIFICAR',
    SALDO_FINAL:     '6. SALDO FINAL',
  };
  const TIPO_ACT_LABEL = { OPERACION: 'Operación', FINANCIAMIENTO: 'Financiamiento', INVERSION: 'Inversión' };
  const TIPO_ACT_COLOR = { OPERACION: '#2563eb', FINANCIAMIENTO: '#9333ea', INVERSION: '#ea580c' };

  const fcISOWeekCode = (d => {
    const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = u.getUTCDay() || 7;
    u.setUTCDate(u.getUTCDate() + 4 - day);
    const jan4 = new Date(Date.UTC(u.getUTCFullYear(), 0, 4));
    return u.getUTCFullYear() * 100 + 1 + Math.round(((u - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
  })(new Date());

  const fcAddWeeks = (yyyyiw, n) => {
    let w = yyyyiw;
    for (let i = 0; i < n; i++) {
      const year = Math.floor(w / 100), week = w % 100;
      const dow = (m, d2) => new Date(Date.UTC(year, m - 1, d2)).getUTCDay();
      const max = (dow(1,1) === 4 || dow(12,31) === 4) ? 53 : 52;
      w = week < max ? year * 100 + week + 1 : (year + 1) * 100 + 1;
    }
    return w;
  };

  const fcWeekLabel = yyyyiw => `Sem ${yyyyiw % 100}/${Math.floor(yyyyiw / 100)}`;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">💵 Flujo de Caja</div>
    </div>
    <div class="page-body">
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border)">
        ${esAdminFC ? `<button class="fc-mode-btn" data-mode="real"
          style="padding:8px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-muted)"
          onclick="fcSetMode('real')">📊 Flujo Real</button>` : ''}
        <button class="fc-mode-btn" data-mode="carga"
          style="padding:8px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-muted)"
          onclick="fcSetMode('carga')">📂 Carga y Conciliación</button>
        <button class="fc-mode-btn" data-mode="proyeccion"
          style="padding:8px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-muted)"
          onclick="fcSetMode('proyeccion')">📈 Proyección</button>
      </div>

      <!-- Panel Flujo Real (solo administrador) -->
      <div id="fc-panel-real" style="display:none">
        ${esAdminFC ? `<div class="card mb-16" style="padding:16px">
          <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end">
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px">Sociedad(es)</label>
              <div id="fc-socs" style="display:flex;flex-wrap:wrap;gap:10px;max-width:520px">
                ${socsFC.map((s,i) => `
                  <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer">
                    <input type="checkbox" class="fc-soc-chk" value="${esc(s)}" ${i===0?'checked':''}> ${esc(s)}
                  </label>`).join('') || '<span class="text-muted" style="font-size:13px">Sin sociedades asignadas</span>'}
              </div>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Moneda</label>
              <select id="fc-moneda" class="form-control" style="width:170px">
                <option value="SOL">Soles (S/)</option>
                <option value="USD">Dólares (US$)</option>
                <option value="COMBO">Combinado (en soles)</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Periodo</label>
              <select id="fc-granularidad" class="form-control" style="width:130px">
                <option value="semana">Semanal</option>
                <option value="mes">Mensual</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Desde</label>
              <input id="fc-desde" type="date" class="form-control" style="width:145px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px"># Periodos</label>
              <input id="fc-periodos" type="number" min="1" max="52" value="12" class="form-control" style="width:90px">
            </div>
            <div>
              <button class="btn btn-primary btn-sm" onclick="fcVerFlujo()">🔍 Ver Flujo</button>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
          <button class="btn btn-outline btn-sm" onclick="imprimirVista('fc-wrap','Flujo de Caja')">🖨️ Imprimir</button>
          <button class="btn btn-outline btn-sm" onclick="exportarVistaExcel('fc-wrap','flujo-de-caja')">📥 Bajar a Excel</button>
        </div>
        <div id="fc-wrap"><div class="text-muted text-center py-24">Selecciona sociedad(es) y presiona "Ver Flujo".</div></div>` : ''}
      </div>

      <!-- Panel Carga y Conciliación -->
      <div id="fc-panel-carga" style="display:none">
        <div class="card mb-16" style="padding:14px">
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin-bottom:14px">
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
              <select id="fc-carga-soc" class="form-control" style="width:160px" onchange="fcCargarCuentas()">
                ${socsFC.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;min-width:160px">
              <span style="font-size:11px;font-weight:600;color:var(--text-muted)">💳 PAGOS ERP</span>
              <div style="display:flex;align-items:center;border:1px solid var(--border);border-radius:6px;padding:4px 8px;background:var(--bg-secondary);cursor:pointer" onclick="document.getElementById('fc-erp-file').click()">
                <span id="fc-erp-nombre" style="font-size:11px;color:var(--text-muted);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Sin archivo</span>
              </div>
              <input type="file" id="fc-erp-file" accept=".csv" style="display:none" onchange="fcCargarERP()">
              <button class="btn btn-primary btn-sm" style="font-size:11px;padding:4px 12px" onclick="document.getElementById('fc-erp-file').click()">📂 Cargar</button>
              <div id="fc-erp-status" style="font-size:10px;color:var(--text-muted)"></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;justify-content:flex-end">
              <button class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 12px;color:#dc2626;border-color:#dc2626" onclick="fcBorrarDatos()">🗑️ Borrar datos</button>
            </div>
          </div>
          <div id="fc-cuentas-wrap" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">
            <span style="font-size:12px;color:var(--text-muted)">Cargando cuentas...</span>
          </div>
        </div>
        <div id="fc-conc-wrap" style="margin-bottom:16px"></div>
      </div>

      <!-- Panel Proyección -->
      <div id="fc-panel-proyeccion" style="display:none">
        <div class="card mb-16" style="padding:16px">
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Sociedad</label>
              <select id="fcproy-compania" class="form-control" style="width:180px">
                ${socsFC.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Desde (YYYYSS)</label>
              <input id="fcproy-desde" type="number" value="${fcISOWeekCode}" class="form-control" style="width:110px">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Hasta (YYYYSS)</label>
              <input id="fcproy-hasta" type="number" value="${fcAddWeeks(fcISOWeekCode, 11)}" class="form-control" style="width:110px">
            </div>
            <div>
              <button class="btn btn-primary btn-sm" onclick="fcProyCargar()">🔄 Cargar</button>
            </div>
          </div>
        </div>
        <div id="fcproy-tiendas-wrap"><div class="text-muted text-center py-24">Selecciona una sociedad y presiona "Cargar".</div></div>
        <div id="fcproy-calculo-wrap"></div>
      </div>
    </div>`;

  window.fcVerFlujo = async function() {
    const companias = [...document.querySelectorAll('.fc-soc-chk:checked')].map(c => c.value);
    const moneda    = document.getElementById('fc-moneda').value;
    const granularidad = document.getElementById('fc-granularidad').value;
    const periodos  = document.getElementById('fc-periodos').value || 12;
    const desde     = document.getElementById('fc-desde').value; // YYYY-MM-DD o vacío
    const wrap = document.getElementById('fc-wrap');
    if (!companias.length) { toast('Selecciona al menos una sociedad', 'warning'); return; }
    wrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const desdeParam = desde ? `&desde=${encodeURIComponent(desde)}` : '';
      const data = await GET(`/flujo-caja/resumen?companias=${encodeURIComponent(companias.join(','))}&moneda=${moneda}&granularidad=${granularidad}&periodos=${periodos}${desdeParam}`);
      const simbolo = moneda === 'USD' ? 'US$' : 'S/';

      const SECCION_ORDEN = ['SALDO_INICIAL','INGRESOS','EGRESOS','OTROS','POR_IDENTIFICAR','SALDO_FINAL'];
      // Agrupar por sección en el orden correcto
      const porSeccion = {};
      data.filas.forEach(f => { (porSeccion[f.seccion] = porSeccion[f.seccion] || []).push(f); });

      let filasHtml = '';
      SECCION_ORDEN.forEach(sec => {
        const filas = porSeccion[sec];
        if (!filas || !filas.length) return;
        const esResumen = ['SALDO_INICIAL','SALDO_FINAL'].includes(sec);
        const secId = `fc-sec-${sec}`;
        // Fila de cabecera de sección (clickeable)
        filasHtml += `<tr class="fc-sec-hdr" data-sec="${sec}" onclick="fcToggleSec('${sec}')"
            style="background:#1a1f3a;cursor:pointer;user-select:none">
          <td colspan="${data.periodos.length + 1}" style="padding:6px 10px;color:#fff;font-weight:700;font-size:12px">
            <span id="fc-arr-${sec}" style="margin-right:6px;font-size:10px">${esResumen ? '' : '▾'}</span>${esc(SECCION_LABEL[sec] || sec)}
          </td>
        </tr>`;
        // Filas de la sección (colapsables)
        filas.forEach(f => {
          filasHtml += `<tr class="fc-fila-${sec}" ${esResumen ? 'style="font-weight:700;background:#bbf7d0"' : ''}>
            <td style="padding:5px 10px 5px 28px">${esc(f.nombre)}</td>
            ${f.valores.map(v => `<td style="padding:5px 10px;text-align:right;${v<0?'color:#dc2626':''}">${fmtMonto(v)}</td>`).join('')}
          </tr>`;
        });
      });

      wrap.innerHTML = `
        <div class="card" style="overflow:auto">
          <table class="data-table" style="font-size:12px;white-space:nowrap">
            <thead>
              <tr>
                <th style="position:sticky;left:0;background:#1a1f3a;z-index:1">Línea (${esc(simbolo)}) — ${esc(companias.join(', '))}</th>
                ${data.periodos.map(p => `<th style="text-align:right">${esc(p.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>`;

      window.fcToggleSec = function(sec) {
        const filas = document.querySelectorAll(`.fc-fila-${sec}`);
        const arr   = document.getElementById(`fc-arr-${sec}`);
        if (!filas.length) return;
        const abierto = filas[0].style.display !== 'none';
        filas.forEach(tr => tr.style.display = abierto ? 'none' : '');
        if (arr) arr.textContent = abierto ? '▸' : '▾';
      };

      wrap.innerHTML += `
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          ℹ️ Por ahora se muestra el saldo inicial real (desde Cuentas Bancarias) y la estructura completa del flujo;
          los movimientos reales y proyectados se incorporarán en una próxima entrega.
        </p>`;
    } catch(e) {
      wrap.innerHTML = `<div class="text-center py-24" style="color:#dc2626">${esc(e.message)}</div>`;
    }
  };

  // ── Carga de datos bancarios ──────────────────────────────────────────────

  window.fcBorrarDatos = async function() {
    const compania = document.getElementById('fc-carga-soc').value;
    if (!confirm(`¿Borrar todos los EECC y Pagos ERP de ${compania}?\nEsta acción no se puede deshacer.`)) return;
    try {
      await Promise.all([
        DEL(`/flujo-caja/eecc?compania=${encodeURIComponent(compania)}`),
        DEL(`/flujo-caja/pagos-erp?compania=${encodeURIComponent(compania)}`),
      ]);
      document.querySelectorAll('[id^="fc-eecc-status-"]').forEach(el => { el.textContent = ''; });
      document.querySelectorAll('[id^="fc-eecc-nombre-"]').forEach(el => { el.textContent = 'Sin archivo'; });
      document.getElementById('fc-erp-status').textContent = '';
      document.getElementById('fc-conc-wrap').innerHTML = '';
      toast('EECC y Pagos ERP borrados', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };

  window.fcCargarCuentas = async function() {
    const compania = document.getElementById('fc-carga-soc').value;
    const wrap = document.getElementById('fc-cuentas-wrap');
    wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Cargando...</span>';
    try {
      const cuentas = await GET(`/flujo-caja/cuentas?compania=${encodeURIComponent(compania)}`);
      if (!cuentas.length) {
        wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Sin cuentas configuradas para esta sociedad.</span>';
        return;
      }
      wrap.innerHTML = cuentas.map(c => {
        const bid = `${c.banco}-${c.moneda}`.replace(/[^A-Z0-9-]/gi, '_');
        const lbl = c.alias ? esc(c.alias) : `${esc(c.banco)} · ${esc(c.moneda)}`;
        const mon = c.moneda === 'USD' ? '🇺🇸' : '🇵🇪';
        return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;min-width:170px;max-width:200px;background:var(--bg-secondary)">
          <p style="font-weight:700;font-size:12px;margin-bottom:2px">${mon} ${lbl}</p>
          <p style="font-size:10px;color:var(--text-muted);margin-bottom:8px">${esc(c.banco)} · ${c.moneda === 'USD' ? 'Dólares' : 'Soles'}</p>
          <div style="border:1px solid var(--border);border-radius:5px;padding:3px 7px;background:var(--bg);cursor:pointer;margin-bottom:5px"
               onclick="document.getElementById('fc-eecc-${bid}').click()">
            <span id="fc-eecc-nombre-${bid}" style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">Sin archivo</span>
          </div>
          <input type="file" id="fc-eecc-${bid}" accept=".xls,.xlsx" style="display:none"
                 onchange="fcCargarEECC('${esc(c.banco)}','${esc(c.moneda)}','${bid}')">
          <div style="display:flex;gap:5px">
            <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 10px;flex:1"
                    onclick="document.getElementById('fc-eecc-${bid}').click()">📂 Cargar</button>
            <button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 10px;flex:1"
                    onclick="fcVerConciliacion('${esc(c.banco)}','${esc(c.moneda)}')">🔗 Conciliar</button>
          </div>
          <div id="fc-eecc-status-${bid}" style="font-size:10px;margin-top:4px;color:var(--text-muted)"></div>
        </div>`;
      }).join('');
    } catch(e) {
      wrap.innerHTML = `<span style="font-size:12px;color:#dc2626">Error: ${esc(e.message)}</span>`;
    }
  };

  window.fcCargarEECC = async function(banco, moneda, bid) {
    const compania = document.getElementById('fc-carga-soc').value;
    const fi = document.getElementById(`fc-eecc-${bid}`);
    const st = document.getElementById(`fc-eecc-status-${bid}`);
    if (!fi.files.length) return;
    document.getElementById(`fc-eecc-nombre-${bid}`).textContent = fi.files[0].name;
    st.textContent = '⏳ Cargando...';
    const fd = new FormData();
    fd.append('archivo', fi.files[0]);
    fd.append('compania', compania);
    fd.append('banco', banco);
    fd.append('moneda', moneda);
    fi.value = '';
    try {
      const r = await fetch('/api/flujo-caja/eecc/cargar', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + localStorage.getItem('ebc_token') },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      st.innerHTML = `<span style="color:#16a34a">✓ ${j.count} movimientos</span>`;
      toast(`EECC cargado: ${j.count} movimientos · ${banco} ${moneda}`);
    } catch(e) {
      st.innerHTML = `<span style="color:#dc2626">✗ ${esc(e.message)}</span>`;
    }
  };

  window.fcCargarERP = async function() {
    const compania = document.getElementById('fc-carga-soc').value;
    const fi = document.getElementById('fc-erp-file');
    const st = document.getElementById('fc-erp-status');
    if (!fi.files.length) { toast('Selecciona un archivo CSV de Pagos ERP', 'warning'); return; }
    document.getElementById('fc-erp-nombre').textContent = fi.files[0].name;
    st.textContent = '⏳ Cargando...';
    const fd = new FormData();
    fd.append('archivo', fi.files[0]);
    fd.append('compania', compania);
    fi.value = '';
    try {
      const r = await fetch('/api/flujo-caja/pagos-erp/cargar', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + localStorage.getItem('ebc_token') },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Error');
      st.innerHTML = `<span style="color:#16a34a">✓ ${j.total} pagos · ${j.cuentas.length} cuenta(s): ${j.cuentas.map(esc).join(', ')}</span>`;
      toast(`Pagos ERP: ${j.total} registros cargados`);
    } catch(e) {
      st.innerHTML = `<span style="color:#dc2626">✗ ${esc(e.message)}</span>`;
    }
  };

  window.fcVerConciliacion = async function(banco, moneda) {
    const compania = document.getElementById('fc-carga-soc').value;
    const wrap = document.getElementById('fc-conc-wrap');
    wrap.innerHTML = '<div class="text-muted text-center py-16">⏳ Calculando conciliación...</div>';
    try {
      const data = await GET(`/flujo-caja/conciliacion?compania=${encodeURIComponent(compania)}&banco=${encodeURIComponent(banco)}&moneda=${encodeURIComponent(moneda)}`);
      const simbolo = moneda === 'USD' ? 'US$' : 'S/';
      const fmtF = d => d ? new Date(d).toLocaleDateString('es-PE', {day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}) : '';
      const fmtN = v => v == null ? '' : Number(v).toLocaleString('es-PE', {minimumFractionDigits:2, maximumFractionDigits:2});
      const BGMAP = { CONCILIADO: '#dcfce7', SIN_ERP: '#fef9c3', INGRESO: '#dbeafe' };
      const LBLMAP = { CONCILIADO: '✓ Conciliado', SIN_ERP: '⚠ Sin ERP', INGRESO: '↑ Ingreso' };

      const FUENTELBL = { MOV_BANCARIO: 'Cód. op.', PROVEEDOR: 'Proveedor', OPERACION: 'Operación', DIRECTA: 'Directo' };
      const SECC_ORD = ['SALDO_INICIAL','INGRESOS','EGRESOS','OTROS','POR_IDENTIFICAR','SALDO_FINAL'];
      const SECC_LBL = {'SALDO_INICIAL':'1. Saldo Inicial','INGRESOS':'2. Ingresos','EGRESOS':'3. Egresos','OTROS':'4. Otros','POR_IDENTIFICAR':'5. Por Identificar','SALDO_FINAL':'6. Saldo Final'};

      // Guardar contexto para funciones de asignación
      _fcConData = { compania, banco, moneda, transacciones: data.transacciones, lineas: data.lineas };

      // Celda de línea para fila EECC sin sub-registros ERP
      const lineaCellTrx = (t) => {
        if (t.erpRegistros && t.erpRegistros.length > 0) return ''; // líneas vienen de sub-filas ERP
        const nd = (t.nroDoc || '').replace(/'/g, "\\'");
        if (t.lineaFuente === 'MANUAL') {
          return `<span style="font-size:11px;color:#b45309;font-weight:600">⚑ Por asignar</span>
                  <button onclick="fcConAsignar('${nd}')" style="font-size:10px;color:#b45309;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0 0 0 4px">✏ Cambiar</button>
                  ${t.lineaDirecta ? `<button onclick="fcConQuitarAsign('${nd}')" style="font-size:10px;color:#6b7280;background:none;border:none;cursor:pointer;padding:0 0 0 2px">✕</button>` : ''}`;
        }
        if (t.lineaNombre) {
          const src = `<span style="font-size:10px;color:var(--text-muted)">${esc(FUENTELBL[t.lineaFuente]||t.lineaFuente||'')}</span>`;
          if (t.lineaDirecta) {
            return `<span style="font-size:11px">${esc(t.lineaNombre)}</span> ${src}
                    <button onclick="fcConAsignar('${nd}')" style="font-size:10px;color:#6b7280;background:none;border:none;cursor:pointer;padding:0 0 0 4px" title="Cambiar">✏</button>
                    <button onclick="fcConQuitarAsign('${nd}')" style="font-size:10px;color:#6b7280;background:none;border:none;cursor:pointer;padding:0 0 0 2px" title="Quitar asignación directa">✕</button>`;
          }
          return `<span style="font-size:11px">${esc(t.lineaNombre)}</span><br>${src}`;
        }
        return `<span style="font-size:10px;color:#dc2626;font-weight:600">Sin asignar</span>
                <button onclick="fcConAsignar('${nd}')" style="font-size:10px;padding:2px 6px;border:1px solid #dc2626;border-radius:3px;background:none;color:#dc2626;cursor:pointer;margin-left:4px">🔗 Asignar</button>`;
      };

      // Celda de línea para sub-fila ERP (asignación vía Mapeo Proveedores)
      const lineaCellErp = (r) => {
        const pv = (r.pagarA || '').replace(/'/g, "\\'");
        if (r.lineaNombre) {
          return `<span style="font-size:11px">${esc(r.lineaNombre)}</span><br>
                  <span style="font-size:10px;color:var(--text-muted)">Proveedor</span>`;
        }
        return `<span style="font-size:10px;color:#dc2626;font-weight:600">Sin asignar</span>
                <button onclick="fcConAsignarProv('${pv}')" style="font-size:10px;padding:2px 6px;border:1px solid #dc2626;border-radius:3px;background:none;color:#dc2626;cursor:pointer;margin-left:4px">🔗 Mapeo</button>`;
      };

      const trxRows = data.transacciones.flatMap(t => {
        const bg = BGMAP[t.estado] || '';
        const bgStyle = bg ? `background:${bg}` : '';
        const tieneERP = t.erpRegistros && t.erpRegistros.length > 0;
        const rows = [`<tr style="${bgStyle}">
          <td style="padding:4px 8px;font-size:12px;white-space:nowrap">${esc(fmtF(t.fecha))}</td>
          <td style="padding:4px 8px;font-size:12px;white-space:nowrap">${esc(t.codigo||'')}${t.codigo?' · ':''}${esc(t.nroDoc||'')}</td>
          <td style="padding:4px 8px;font-size:12px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.concepto||'')}</td>
          <td style="padding:4px 8px;font-size:12px;text-align:right;white-space:nowrap;${t.importe<0?'color:#dc2626':''}">${fmtN(t.importe)}</td>
          <td style="padding:4px 8px;font-size:11px;white-space:nowrap">${esc(LBLMAP[t.estado]||t.estado)}</td>
          <td style="padding:4px 8px;line-height:1.4">${tieneERP ? '' : lineaCellTrx(t)}</td>
        </tr>`];
        // Sub-filas ERP: cada una con su propia línea del flujo vía Mapeo Proveedores
        (t.erpRegistros || []).forEach(r => {
          rows.push(`<tr style="${bgStyle};opacity:0.9">
            <td style="padding:2px 8px 2px 20px;font-size:10px;color:var(--text-muted);white-space:nowrap">↳ ERP</td>
            <td></td>
            <td style="padding:2px 8px;font-size:11px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500">${esc(r.pagarA||'')}${r.tipoPago?` <span style="font-weight:400;color:var(--text-muted)">· ${esc(r.tipoPago)}</span>`:''}</td>
            <td style="padding:2px 8px;font-size:11px;text-align:right;white-space:nowrap;color:#dc2626">${fmtN(r.importe)}</td>
            <td></td>
            <td style="padding:2px 8px;line-height:1.4">${lineaCellErp(r)}</td>
          </tr>`);
        });
        return rows;
      }).join('');

      let erpRows = '';
      if (data.soloERP.length) {
        erpRows = `<tr style="background:#1a1f3a"><td colspan="6" style="padding:5px 8px;color:#fff;font-weight:700;font-size:11px">PAGOS ERP SIN MOVIMIENTO EN BANCO (${data.soloERP.length})</td></tr>`;
        erpRows += data.soloERP.map(g => {
          const total = moneda === 'USD'
            ? g.registros.reduce((s,r) => s + r.pagoExtranjero, 0)
            : g.registros.reduce((s,r) => s + r.pagoLocal, 0);
          const provs = [...new Set(g.registros.map(r => r.pagarA).filter(Boolean))].join(', ');
          const fecha = g.registros[0]?.fechaPago ? fmtF(g.registros[0].fechaPago) : '';
          return `<tr style="background:#fee2e2">
            <td style="padding:4px 8px;font-size:12px;white-space:nowrap">${esc(fecha)}</td>
            <td style="padding:4px 8px;font-size:12px">${g.numeroPago}</td>
            <td style="padding:4px 8px;font-size:12px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(provs)}</td>
            <td style="padding:4px 8px;font-size:12px;text-align:right;color:#dc2626;white-space:nowrap">${fmtN(total)}</td>
            <td style="padding:4px 8px;font-size:11px;white-space:nowrap">✗ Sin banco · ${g.registros.length} reg.</td>
            <td></td>
          </tr>`;
        }).join('');
      }

      const s = data.stats;

      // Tarjeta de pendientes sin línea asignada (EECC sin ERP + sub-registros ERP sin proveedor mapeado)
      const sinLineaItems = [];
      data.transacciones.forEach(t => {
        if (t.erpRegistros && t.erpRegistros.length > 0) {
          t.erpRegistros.forEach(r => {
            if (!r.lineaId) sinLineaItems.push({ fecha: t.fecha, nroDoc: t.nroDoc, concepto: r.pagarA || t.concepto, importe: r.importe, esERP: true, pagarA: r.pagarA });
          });
        } else if (!t.lineaId) {
          sinLineaItems.push({ fecha: t.fecha, nroDoc: t.nroDoc, concepto: t.concepto, importe: t.importe, esERP: false });
        }
      });
      const _slSecc = ['SALDO_INICIAL','INGRESOS','EGRESOS','OTROS','POR_IDENTIFICAR','SALDO_FINAL'];
      const _slLbl  = {'SALDO_INICIAL':'1. Saldo Inicial','INGRESOS':'2. Ingresos','EGRESOS':'3. Egresos','OTROS':'4. Otros','POR_IDENTIFICAR':'5. Por Identificar','SALDO_FINAL':'6. Saldo Final'};
      const _slSorted = [...data.lineas].sort((a,b) => {
        if (!!a.esManual !== !!b.esManual) return a.esManual ? 1 : -1;
        const si = _slSecc.indexOf(a.seccion), sj = _slSecc.indexOf(b.seccion);
        return si!==sj ? si-sj : (a.orden||0)-(b.orden||0) || a.nombre.localeCompare(b.nombre,'es');
      });
      const _lineaOpts = '<option value="">— Seleccionar línea —</option>' +
        _slSorted.map(l => {
          const lbl = l.esManual ? `⚑ ${esc(l.nombre)}` : `${esc(_slLbl[l.seccion]||l.seccion)} — ${esc(l.nombre)}`;
          return `<option value="${l._id}">${lbl}</option>`;
        }).join('');

      const sinLineaCard = sinLineaItems.length ? `
        <div class="card mb-16" style="padding:12px;border-left:4px solid #f59e0b">
          <div style="margin-bottom:10px;font-weight:700;font-size:13px;color:#92400e">⚠ ${sinLineaItems.length} elemento${sinLineaItems.length>1?'s':''} sin línea del flujo asignada</div>
          <div style="overflow:auto;max-height:320px">
            <table class="data-table" style="font-size:12px;width:100%">
              <thead><tr>
                <th style="text-align:left;white-space:nowrap">Fecha Op.</th>
                <th style="text-align:left;white-space:nowrap">Nº Doc</th>
                <th style="text-align:left">Concepto / Proveedor</th>
                <th style="text-align:right;white-space:nowrap">Importe</th>
                <th style="text-align:left;min-width:220px">Línea del flujo</th>
              </tr></thead>
              <tbody>${sinLineaItems.map(item => {
                const nd  = (item.nroDoc||'').replace(/'/g,"\\'");
                const pv  = (item.pagarA||'').replace(/'/g,"\\'");
                const sel = item.esERP
                  ? `<select class="form-control" style="font-size:11px;padding:2px 6px;height:auto"
                       onchange="if(this.value)fcConMapearProvDirecto('${pv}',this.value)">${_lineaOpts}</select>`
                  : `<select class="form-control" style="font-size:11px;padding:2px 6px;height:auto"
                       onchange="if(this.value)fcConAsignarDirecto('${nd}',this.value)">${_lineaOpts}</select>`;
                return `<tr>
                  <td style="padding:4px 8px;white-space:nowrap">${esc(fmtF(item.fecha))}</td>
                  <td style="padding:4px 8px;white-space:nowrap">${esc(item.nroDoc||'')}</td>
                  <td style="padding:4px 8px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${item.esERP ? `<span style="font-size:10px;color:var(--text-muted)">↳ ERP</span> ` : ''}${esc(item.concepto||'')}
                  </td>
                  <td style="padding:4px 8px;text-align:right;white-space:nowrap;${item.importe<0?'color:#dc2626':''}">${fmtN(item.importe)}</td>
                  <td style="padding:4px 8px">${sel}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>` : '';

      wrap.innerHTML = `
        <div class="card mb-16" style="padding:12px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
            <b style="font-size:13px">Conciliación ${esc(banco)} ${esc(simbolo)} — ${esc(compania)}${data.alias ? ' · ' + esc(data.alias) : ''}</b>
            <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${s.conciliados} conciliados</span>
            <span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${s.soloEECC} solo en EECC</span>
            <span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${s.soloERP} solo en ERP</span>
            ${s.sinLinea ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">⚠ ${s.sinLinea} sin línea</span>` : ''}
            ${s.nuevosProveedores ? `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">+${s.nuevosProveedores} prov. nuevos añadidos</span>` : ''}
            ${data.cargadoEn ? `<span style="font-size:11px;color:var(--text-muted)">EECC al ${esc(fmtF(data.cargadoEn))}</span>` : ''}
          </div>
          <div style="overflow:auto;max-height:520px">
            <table class="data-table" style="font-size:12px;width:100%">
              <thead><tr>
                <th style="text-align:left;white-space:nowrap">Fecha</th>
                <th style="text-align:left;white-space:nowrap">Cód / Nº Doc</th>
                <th style="text-align:left">Concepto / Proveedor ERP</th>
                <th style="text-align:right;white-space:nowrap">Importe (${esc(simbolo)})</th>
                <th style="text-align:left">Estado</th>
                <th style="text-align:left">Línea del flujo</th>
              </tr></thead>
              <tbody>${trxRows}${erpRows}</tbody>
            </table>
          </div>
        </div>
        ${sinLineaCard}`;

      // Funciones de asignación directa (en closure sobre compania/banco/moneda/data)
      window.fcConAsignar = (nroDoc) => {
        if (!_fcConData) return;
        const { transacciones, lineas } = _fcConData;
        const t = transacciones.find(tx => tx.nroDoc === nroDoc) || {};
        const SECC_ORD2 = ['SALDO_INICIAL','INGRESOS','EGRESOS','OTROS','POR_IDENTIFICAR','SALDO_FINAL'];
        const SECC_LBL2 = {'SALDO_INICIAL':'1. Saldo Inicial','INGRESOS':'2. Ingresos','EGRESOS':'3. Egresos','OTROS':'4. Otros','POR_IDENTIFICAR':'5. Por Identificar','SALDO_FINAL':'6. Saldo Final'};
        const sorted = [...lineas].sort((a,b) => {
          if (!!a.esManual !== !!b.esManual) return a.esManual ? 1 : -1;
          const si = SECC_ORD2.indexOf(a.seccion), sj = SECC_ORD2.indexOf(b.seccion);
          return si!==sj?si-sj:(a.orden||0)-(b.orden||0)||a.nombre.localeCompare(b.nombre,'es');
        });
        const html = `
          <div style="margin-bottom:12px;padding:10px;background:var(--bg-secondary);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted)">Fecha: <b>${esc(fmtF(t.fecha))}</b> &nbsp;·&nbsp; Nº: <b>${esc(nroDoc)}</b></div>
            <div style="font-size:13px;margin-top:4px;font-weight:600">${esc(t.concepto||'')}</div>
            <div style="font-size:13px;margin-top:2px;color:${(t.importe||0)<0?'#dc2626':'#16a34a'}">${esc(simbolo)} ${fmtN(t.importe)}</div>
          </div>
          <label style="font-size:12px;color:var(--text-muted)">Línea del flujo:</label>
          <select id="fccon-linea-sel" class="form-control" style="font-size:12px;width:100%;margin-top:4px">
            <option value="">— Seleccionar línea —</option>
            ${sorted.map(l => {
              const lbl = l.esManual ? `⚑ ${esc(l.nombre)}` : `${esc(SECC_LBL2[l.seccion]||l.seccion)} — ${esc(l.nombre)}`;
              const sel = t.lineaId === String(l._id) ? ' selected' : '';
              return `<option value="${l._id}"${sel}>${lbl}</option>`;
            }).join('')}
          </select>
          <input type="hidden" id="fccon-nrodoc-val" value="${esc(nroDoc)}">
          <div style="margin-top:12px;text-align:right">
            <button class="btn btn-primary btn-sm" onclick="fcConConfirmarAsign()">✓ Asignar</button>
          </div>`;
        openModal('🔗 Asignar línea del flujo', html, null, { medium: true });
      };

      window.fcConConfirmarAsign = async () => {
        const lineaId = document.getElementById('fccon-linea-sel')?.value;
        const nroDoc  = document.getElementById('fccon-nrodoc-val')?.value;
        if (!lineaId) { toast('Selecciona una línea del flujo', 'warning'); return; }
        const { compania: c, banco: b, moneda: m } = _fcConData;
        try {
          await PUT('/flujo-caja/asignacion', { compania: c, banco: b, moneda: m, nroDoc, lineaId });
          document.getElementById('modal')?.classList.add('hidden');
          toast('✅ Línea asignada', 'success');
          await window.fcVerConciliacion(_fcConData.banco, _fcConData.moneda);
        } catch(err) { toast(err.message, 'error'); }
      };

      window.fcConAsignarDirecto = async (nroDoc, lineaId) => {
        if (!lineaId || !_fcConData) return;
        const { compania: c, banco: b, moneda: m } = _fcConData;
        try {
          await PUT('/flujo-caja/asignacion', { compania: c, banco: b, moneda: m, nroDoc, lineaId });
          toast('✅ Línea asignada', 'success');
          await window.fcVerConciliacion(_fcConData.banco, _fcConData.moneda);
        } catch(err) { toast(err.message, 'error'); }
      };

      window.fcConMapearProvDirecto = async (pagarA, lineaId) => {
        if (!lineaId || !_fcConData) return;
        const { compania: c } = _fcConData;
        try {
          await PUT('/flujo-caja/proveedor-linea', { compania: c, nombreProveedor: pagarA, lineaId });
          toast('✅ Proveedor mapeado', 'success');
          await window.fcVerConciliacion(_fcConData.banco, _fcConData.moneda);
        } catch(err) { toast(err.message, 'error'); }
      };

      window.fcConQuitarAsign = async (nroDoc) => {
        if (!confirm('¿Quitar la asignación directa de esta línea?')) return;
        const { compania: c, banco: b, moneda: m } = _fcConData;
        try {
          await PUT('/flujo-caja/asignacion', { compania: c, banco: b, moneda: m, nroDoc, lineaId: null });
          toast('✅ Asignación directa eliminada', 'success');
          await window.fcVerConciliacion(_fcConData.banco, _fcConData.moneda);
        } catch(err) { toast(err.message, 'error'); }
      };

      // Asignación de línea a proveedor desde sub-fila ERP (actualiza Mapeo Proveedores)
      window.fcConAsignarProv = (pagarA) => {
        if (!_fcConData) return;
        const { compania: c, lineas } = _fcConData;
        const SECC_ORD2 = ['SALDO_INICIAL','INGRESOS','EGRESOS','OTROS','POR_IDENTIFICAR','SALDO_FINAL'];
        const SECC_LBL2 = {'SALDO_INICIAL':'1. Saldo Inicial','INGRESOS':'2. Ingresos','EGRESOS':'3. Egresos','OTROS':'4. Otros','POR_IDENTIFICAR':'5. Por Identificar','SALDO_FINAL':'6. Saldo Final'};
        const sorted = [...lineas].sort((a,b) => {
          if (!!a.esManual !== !!b.esManual) return a.esManual ? 1 : -1;
          const si = SECC_ORD2.indexOf(a.seccion), sj = SECC_ORD2.indexOf(b.seccion);
          return si!==sj?si-sj:(a.orden||0)-(b.orden||0)||a.nombre.localeCompare(b.nombre,'es');
        });
        const html = `
          <div style="margin-bottom:12px;padding:10px;background:var(--bg-secondary);border-radius:6px">
            <div style="font-size:11px;color:var(--text-muted)">Proveedor ERP</div>
            <div style="font-size:13px;margin-top:4px;font-weight:600">${esc(pagarA)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">La línea asignada quedará guardada en Mapeo de Proveedores y se aplicará a todos los pagos futuros de este proveedor.</div>
          </div>
          <label style="font-size:12px;color:var(--text-muted)">Línea del flujo:</label>
          <select id="fccon-prov-linea-sel" class="form-control" style="font-size:12px;width:100%;margin-top:4px">
            <option value="">— Seleccionar línea —</option>
            ${sorted.map(l => {
              const lbl = l.esManual ? `⚑ ${esc(l.nombre)}` : `${esc(SECC_LBL2[l.seccion]||l.seccion)} — ${esc(l.nombre)}`;
              return `<option value="${l._id}">${lbl}</option>`;
            }).join('')}
          </select>
          <input type="hidden" id="fccon-prov-nombre" value="${esc(pagarA)}">
          <div style="margin-top:12px;text-align:right">
            <button class="btn btn-primary btn-sm" onclick="fcConConfirmarAsignProv()">✓ Guardar en Mapeo</button>
          </div>`;
        openModal('🔗 Asignar línea — Mapeo Proveedores', html, null, { medium: true });
      };

      window.fcConConfirmarAsignProv = async () => {
        const lineaId        = document.getElementById('fccon-prov-linea-sel')?.value;
        const nombreProveedor = document.getElementById('fccon-prov-nombre')?.value;
        if (!lineaId) { toast('Selecciona una línea del flujo', 'warning'); return; }
        const { compania: c } = _fcConData;
        try {
          await PUT('/flujo-caja/proveedor-linea', { compania: c, nombreProveedor, lineaId });
          document.getElementById('modal')?.classList.add('hidden');
          toast('✅ Proveedor mapeado. Recargando...', 'success');
          await window.fcVerConciliacion(_fcConData.banco, _fcConData.moneda);
        } catch(err) { toast(err.message, 'error'); }
      };

    } catch(e) {
      wrap.innerHTML = `<div class="text-center py-16" style="color:#dc2626">${esc(e.message)}</div>`;
    }
  };

  // Tab mode switcher
  window.fcSetMode = function(mode) {
    document.querySelectorAll('.fc-mode-btn').forEach(b => {
      const active = b.dataset.mode === mode;
      b.style.color             = active ? 'var(--primary)' : 'var(--text-muted)';
      b.style.borderBottomColor = active ? 'var(--primary)' : 'transparent';
    });
    document.getElementById('fc-panel-real').style.display       = mode === 'real'       ? '' : 'none';
    document.getElementById('fc-panel-carga').style.display      = mode === 'carga'      ? '' : 'none';
    document.getElementById('fc-panel-proyeccion').style.display = mode === 'proyeccion' ? '' : 'none';
  };
  window.fcSetMode(esAdminFC ? 'real' : 'carga');

  // ── Conciliación: contexto para modal de asignación ─────────────────────
  let _fcConData = null; // { compania, banco, moneda, transacciones, lineas }

  // ── Proyección: estado módulo-level ──────────────────────────────────────
  let _fcProyTiendas    = [];
  let _fcProySupuestos  = {}; // tiendaId → [supuesto]

  const fcProyFmt = n => (n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  window.fcProyCargar = async function() {
    const compania = document.getElementById('fcproy-compania')?.value;
    const wrap = document.getElementById('fcproy-tiendas-wrap');
    if (!compania) { toast('Selecciona una sociedad', 'warning'); return; }
    wrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    document.getElementById('fcproy-calculo-wrap').innerHTML = '';
    try {
      _fcProyTiendas = await GET(`/proyeccion/tiendas?compania=${encodeURIComponent(compania)}`);
      // Cargar supuestos de todas las tiendas en paralelo
      const results = await Promise.all(_fcProyTiendas.map(t => GET(`/proyeccion/tiendas/${t._id}/supuestos`)));
      _fcProySupuestos = {};
      _fcProyTiendas.forEach((t, i) => { _fcProySupuestos[t._id] = results[i]; });
      fcProyRenderTiendas(compania);
    } catch (e) { wrap.innerHTML = `<div class="text-center py-24" style="color:#dc2626">${esc(e.message)}</div>`; }
  };

  function fcProyRenderTiendas(compania) {
    const wrap = document.getElementById('fcproy-tiendas-wrap');
    if (!_fcProyTiendas.length) {
      wrap.innerHTML = `<div class="text-muted text-center py-24">No hay tiendas configuradas para ${esc(compania)}. Ve a Admin → 🏪 Tiendas para agregarlas.</div>`;
      return;
    }
    const html = _fcProyTiendas.map(t => {
      const sups = _fcProySupuestos[t._id] || [];
      const supsRows = sups.map(s => `
        <tr>
          <td style="padding:4px 10px">${fcWeekLabel(s.semana)} (${s.semana})</td>
          <td style="padding:4px 10px;text-align:right">${fcProyFmt(s.ventaBruta)}</td>
          <td style="padding:4px 10px;text-align:center">
            <button class="btn btn-sm" style="padding:1px 8px;font-size:11px;color:#dc2626;border-color:#dc2626"
              onclick="fcProyEliminarSupuesto('${t._id}', ${s.semana})">🗑</button>
          </td>
        </tr>`).join('');
      const canalesDesc = (t.canales || []).map(c => {
        if (c.tipo === 'efectivo') return `Efectivo ${(c.pct*100).toFixed(0)}%`;
        return `${c.nombre||c.tipo} ${(c.pct*100).toFixed(0)}% (com ${(c.comisionRate*100).toFixed(1)}%)`;
      }).join(' · ');
      return `
        <div class="card mb-12" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);cursor:pointer"
            onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
            <div>
              <span style="font-weight:600;font-size:13px">🏪 ${esc(t.nombre)}</span>
              <span style="margin-left:10px;font-size:11px;color:var(--text-muted)">${esc(t.moneda)} · IGV ${(t.igvRate*100).toFixed(0)}% · RC ${(t.rcRate*100).toFixed(0)}% · TIP ${(t.tipRate*100).toFixed(0)}%</span>
              ${canalesDesc ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(canalesDesc)}</div>` : ''}
            </div>
            <span style="font-size:11px;color:var(--text-muted)">${sups.length} supuesto(s) ▾</span>
          </div>
          <div style="padding:12px 14px">
            ${sups.length ? `
              <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:10px">
                <thead><tr style="color:var(--text-muted)">
                  <th style="padding:4px 10px;text-align:left;font-weight:500">Semana</th>
                  <th style="padding:4px 10px;text-align:right;font-weight:500">Venta Bruta (${esc(t.moneda)})</th>
                  <th></th>
                </tr></thead>
                <tbody>${supsRows}</tbody>
              </table>` : '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Sin supuestos — la venta se asume 0.</p>'}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input id="fcproy-sem-${t._id}" type="number" placeholder="Sem YYYYSS" class="form-control" style="width:120px;font-size:12px">
              <input id="fcproy-vb-${t._id}" type="number" placeholder="Venta bruta" class="form-control" style="width:130px;font-size:12px" min="0">
              <button class="btn btn-sm btn-outline" onclick="fcProyAgregarSupuesto('${t._id}')">+ Agregar</button>
            </div>
          </div>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" onclick="fcProyVerCalculo()">📈 Ver Cálculo</button>
      </div>
      ${html}`;
  }

  window.fcProyAgregarSupuesto = async function(tiendaId) {
    const semana    = Number(document.getElementById(`fcproy-sem-${tiendaId}`)?.value);
    const ventaBruta = Number(document.getElementById(`fcproy-vb-${tiendaId}`)?.value);
    if (!semana || semana < 190001 || semana > 210053) { toast('Semana inválida (ej: 202638)', 'warning'); return; }
    if (isNaN(ventaBruta) || ventaBruta < 0) { toast('Venta bruta inválida', 'warning'); return; }
    try {
      const sup = await POST(`/proyeccion/tiendas/${tiendaId}/supuestos`, { semana, ventaBruta });
      const list = _fcProySupuestos[tiendaId] || [];
      const idx = list.findIndex(s => s.semana === sup.semana);
      if (idx >= 0) list[idx] = sup; else list.push(sup);
      list.sort((a, b) => a.semana - b.semana);
      _fcProySupuestos[tiendaId] = list;
      const compania = document.getElementById('fcproy-compania')?.value;
      fcProyRenderTiendas(compania);
      toast('Supuesto guardado', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  window.fcProyEliminarSupuesto = async function(tiendaId, semana) {
    if (!confirm(`¿Eliminar supuesto de la semana ${semana}?`)) return;
    try {
      await DEL(`/proyeccion/tiendas/${tiendaId}/supuestos/${semana}`);
      _fcProySupuestos[tiendaId] = (_fcProySupuestos[tiendaId] || []).filter(s => s.semana !== semana);
      const compania = document.getElementById('fcproy-compania')?.value;
      fcProyRenderTiendas(compania);
      toast('Supuesto eliminado', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  let _fcProyCalcData = null;
  let _fcProyPorTienda = false;

  function fcProyBuildTbody(data, channelMap, agg, porTienda) {
    const cols  = data.semanas.length + 1;
    const tdNum = v => `<td style="padding:4px 10px;text-align:right;font-size:12px">${fcProyFmt(v)}</td>`;
    const tdLbl = (lbl, indent) => `<td style="padding:4px 10px${indent?' 4px 22px':''};font-size:12px;white-space:nowrap">${esc(lbl)}</td>`;
    const trSec = (lbl, bg) => `<tr style="background:${bg||'#1a1f3a'}"><td colspan="${cols}" style="padding:5px 10px;color:#fff;font-weight:700;font-size:11px">${lbl}</td></tr>`;

    if (!porTienda) {
      // ── Vista agregada ────────────────────────────────────────────
      let t = trSec('INGRESOS — Tiendas');
      channelMap.forEach((ch, key) => {
        t += `<tr>${tdLbl(ch.label, true)}${data.semanas.map(s => tdNum(agg[s].ch[key]?.monto)).join('')}</tr>`;
      });
      t += `<tr>${tdLbl('TIP cobrado', true)}${data.semanas.map(s => tdNum(agg[s].tip)).join('')}</tr>`;
      t += trSec('EGRESOS — Tiendas');
      t += `<tr>${tdLbl('IGV Neto (a pagar SUNAT)', true)}${data.semanas.map(s => {
        let igvCom = 0;
        channelMap.forEach((ch, key) => { if (ch.tipo !== 'efectivo') igvCom += agg[s].ch[key]?.igvComision || 0; });
        return tdNum(agg[s].igv - igvCom);
      }).join('')}</tr>`;
      t += `<tr>${tdLbl('RC (Recargo al consumo)', true)}${data.semanas.map(s => tdNum(agg[s].rc)).join('')}</tr>`;
      t += `<tr>${tdLbl('TIP empleados', true)}${data.semanas.map(s => tdNum(agg[s].tip)).join('')}</tr>`;
      channelMap.forEach((ch, key) => {
        if (ch.tipo === 'efectivo') return;
        if (!data.semanas.some(s => (agg[s].ch[key]?.comision || 0) > 0)) return;
        t += `<tr>${tdLbl(`Comisión ${ch.label}`, true)}${data.semanas.map(s => tdNum(agg[s].ch[key]?.comision)).join('')}</tr>`;
      });
      return t;
    }

    // ── Vista por tienda ──────────────────────────────────────────
    let t = '';
    data.tiendas.forEach(tienda => {
      // Canales de esta tienda
      const tChMap = new Map();
      data.semanas.forEach(sem => {
        const d = tienda.porSemana[sem];
        if (!d) return;
        d.canales.forEach(c => {
          const key = c.tipo === 'efectivo' ? 'efectivo' : `${c.tipo}::${c.nombre}`;
          if (!tChMap.has(key)) tChMap.set(key, { tipo: c.tipo, nombre: c.nombre, label: c.tipo === 'efectivo' ? 'Efectivo' : c.nombre });
        });
      });

      // Sub-header de tienda
      t += `<tr style="background:#1e3a5f"><td colspan="${cols}" style="padding:6px 10px;color:#93c5fd;font-weight:700;font-size:12px">🏪 ${esc(tienda.nombre)} (${esc(tienda.moneda)})</td></tr>`;

      // INGRESOS de esta tienda
      t += trSec('  INGRESOS', '#0f2744');
      tChMap.forEach((ch, key) => {
        t += `<tr>${tdLbl(ch.label, true)}${data.semanas.map(s => {
          const c = (tienda.porSemana[s]?.canales || []).find(x => (x.tipo === 'efectivo' ? 'efectivo' : `${x.tipo}::${x.nombre}`) === key);
          return tdNum(c?.monto || 0);
        }).join('')}</tr>`;
      });
      t += `<tr>${tdLbl('TIP cobrado', true)}${data.semanas.map(s => tdNum(tienda.porSemana[s]?.tip || 0)).join('')}</tr>`;

      // EGRESOS de esta tienda
      t += trSec('  EGRESOS', '#0f2744');
      t += `<tr>${tdLbl('IGV Neto (a pagar SUNAT)', true)}${data.semanas.map(s => {
        const d = tienda.porSemana[s];
        if (!d) return tdNum(0);
        const igvCom = (d.canales || []).reduce((acc, c) => acc + (c.tipo !== 'efectivo' ? (c.igvComision || 0) : 0), 0);
        return tdNum(d.igv - igvCom);
      }).join('')}</tr>`;
      t += `<tr>${tdLbl('RC (Recargo al consumo)', true)}${data.semanas.map(s => tdNum(tienda.porSemana[s]?.rc || 0)).join('')}</tr>`;
      t += `<tr>${tdLbl('TIP empleados', true)}${data.semanas.map(s => tdNum(tienda.porSemana[s]?.tip || 0)).join('')}</tr>`;
      tChMap.forEach((ch, key) => {
        if (ch.tipo === 'efectivo') return;
        const hasCom = data.semanas.some(s => {
          const c = (tienda.porSemana[s]?.canales || []).find(x => (x.tipo === 'efectivo' ? 'efectivo' : `${x.tipo}::${x.nombre}`) === key);
          return (c?.comision || 0) > 0;
        });
        if (!hasCom) return;
        t += `<tr>${tdLbl(`Comisión ${ch.label}`, true)}${data.semanas.map(s => {
          const c = (tienda.porSemana[s]?.canales || []).find(x => (x.tipo === 'efectivo' ? 'efectivo' : `${x.tipo}::${x.nombre}`) === key);
          return tdNum(c?.comision || 0);
        }).join('')}</tr>`;
      });
    });
    return t;
  }

  function fcProyRenderResultado(compania) {
    const data = _fcProyCalcData;
    const calcWrap = document.getElementById('fcproy-calculo-wrap');
    const thStyle = 'padding:5px 10px;text-align:right;font-size:11px;white-space:nowrap';

    // Canales únicos globales (para vista agregada)
    const channelMap = new Map();
    data.tiendas.forEach(t => {
      data.semanas.forEach(sem => {
        (t.porSemana[sem]?.canales || []).forEach(c => {
          const key = c.tipo === 'efectivo' ? 'efectivo' : `${c.tipo}::${c.nombre}`;
          if (!channelMap.has(key)) channelMap.set(key, { tipo: c.tipo, nombre: c.nombre, label: c.tipo === 'efectivo' ? 'Efectivo' : c.nombre });
        });
      });
    });

    // Agregados globales
    const agg = {};
    data.semanas.forEach(sem => {
      agg[sem] = { igv: 0, rc: 0, tip: 0, ch: {} };
      channelMap.forEach((_, key) => { agg[sem].ch[key] = { monto: 0, comision: 0, igvComision: 0 }; });
      data.tiendas.forEach(t => {
        const d = t.porSemana[sem];
        if (!d) return;
        agg[sem].igv += d.igv || 0;
        agg[sem].rc  += d.rc  || 0;
        agg[sem].tip += d.tip || 0;
        d.canales.forEach(c => {
          const key = c.tipo === 'efectivo' ? 'efectivo' : `${c.tipo}::${c.nombre}`;
          if (agg[sem].ch[key]) {
            agg[sem].ch[key].monto       += c.monto       || 0;
            agg[sem].ch[key].comision    += c.comision    || 0;
            agg[sem].ch[key].igvComision += c.igvComision || 0;
          }
        });
      });
    });

    calcWrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px">
        <h3 style="font-size:13px;font-weight:600;margin:0">Cálculo Proyectado — Venta Tiendas · ${esc(compania)}</h3>
        <button class="btn btn-sm btn-outline" onclick="fcProyToggleDesglose()">
          ${_fcProyPorTienda ? '📊 Ver agregado' : '🏪 Desglose por tienda'}
        </button>
      </div>
      <div class="card" style="overflow:auto">
        <table class="data-table" style="font-size:12px;white-space:nowrap">
          <thead><tr>
            <th style="position:sticky;left:0;background:#1a1f3a;z-index:1;${thStyle};text-align:left">Línea (S/)</th>
            ${data.semanas.map(s => `<th style="${thStyle}">${fcWeekLabel(s)}</th>`).join('')}
          </tr></thead>
          <tbody>${fcProyBuildTbody(data, channelMap, agg, _fcProyPorTienda)}</tbody>
        </table>
      </div>`;
  }

  window.fcProyToggleDesglose = function() {
    const compania = document.getElementById('fcproy-compania')?.value;
    _fcProyPorTienda = !_fcProyPorTienda;
    fcProyRenderResultado(compania);
  };

  window.fcProyVerCalculo = async function() {
    const compania = document.getElementById('fcproy-compania')?.value;
    const desde    = document.getElementById('fcproy-desde')?.value;
    const hasta    = document.getElementById('fcproy-hasta')?.value;
    const calcWrap = document.getElementById('fcproy-calculo-wrap');
    if (!compania || !desde || !hasta) { toast('Completa sociedad, desde y hasta', 'warning'); return; }
    calcWrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Calculando...</div>';
    try {
      const data = await GET(`/proyeccion/calculo-tiendas?compania=${encodeURIComponent(compania)}&desde=${desde}&hasta=${hasta}`);
      if (!data.tiendas.length) {
        calcWrap.innerHTML = '<div class="text-muted text-center py-24">No hay tiendas activas para esta sociedad.</div>';
        return;
      }
      _fcProyCalcData  = data;
      _fcProyPorTienda = false;
      fcProyRenderResultado(compania);
    } catch (e) {
      calcWrap.innerHTML = `<div class="text-center py-24" style="color:#dc2626">${esc(e.message)}</div>`;
    }
  };

  // Fecha Desde por omisión y carga automática del flujo (solo admin)
  if (esAdminFC) {
    const _fcD = new Date();
    _fcD.setDate(_fcD.getDate() - 84);
    _fcD.setDate(_fcD.getDate() - ((_fcD.getDay() || 7) - 1)); // retroceder al lunes
    document.getElementById('fc-desde').value = _fcD.toISOString().slice(0, 10);
    if (socsFC.length) await window.fcVerFlujo();
  }

  // Cargar cuentas del panel de carga al iniciar
  if (socsFC.length) await window.fcCargarCuentas();
}

// ─── View: Registro de Bajas, Consumos, Transferencias y 86 ───────
const MOV_FLUJOS = {
  BAJA:          { label: 'Bajas',          icon: '🔻', accesoField: 'accesoBajas',          rolField: 'rolBCT', tipos: ['MANIPULACIÓN', 'CALIDAD', 'VENCIMIENTO'], tipoLabel: 'Tipo de Baja' },
  CONSUMO:       { label: 'Consumos',       icon: '🍽️', accesoField: 'accesoConsumos',       rolField: 'rolBCT', tipos: ['CONSUMO TIENDAS', 'RANCHO', 'PRUEBAS'], tipoLabel: 'Tipo de Consumo' },
  TRANSFERENCIA: { label: 'Transferencias', icon: '🔄', accesoField: 'accesoTransferencias', rolField: 'rolBCT' },
  '86':          { label: '86',             icon: '🗑️', accesoField: 'acceso86',             rolField: 'rol86' },
};

async function viewMovimientos(container) {
  const isAdmin = S.user.role === 'ADMIN';
  const tabs = Object.keys(MOV_FLUJOS).filter(f => isAdmin || S.user[MOV_FLUJOS[f].accesoField]);

  if (!tabs.length) {
    container.innerHTML = `
      <div class="page-header"><div class="page-title">🗑️ Bajas / Consumos / Transferencias / 86</div></div>
      <div class="page-body"><div class="empty-state"><div class="empty-icon">🔒</div><p>No tienes acceso a este módulo.</p></div></div>`;
    return;
  }

  let flujoActual = tabs[0];

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🗑️ Bajas / Consumos / Transferencias / 86</div>
    </div>
    <div class="page-body">
      <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:16px;width:fit-content">
        ${tabs.map(f => `<button class="mv-tab" data-flujo="${f}" style="padding:8px 16px;font-size:13px;border:none;cursor:pointer;background:${f === flujoActual ? 'var(--accent)' : 'var(--bg-secondary)'};color:${f === flujoActual ? '#fff' : 'var(--text)'}">${MOV_FLUJOS[f].icon} ${MOV_FLUJOS[f].label}</button>`).join('')}
      </div>
      <div id="mv-content"></div>
    </div>`;

  container.querySelectorAll('.mv-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      flujoActual = btn.dataset.flujo;
      container.querySelectorAll('.mv-tab').forEach(b => {
        const active = b.dataset.flujo === flujoActual;
        b.style.background = active ? 'var(--accent)' : 'var(--bg-secondary)';
        b.style.color = active ? '#fff' : 'var(--text)';
      });
      renderTab();
    });
  });

  function toDatetimeLocal(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function loadItemsFor(operacion) {
    if (!operacion) return [];
    try { return await GET(`/items?operacion=${operacion}`); } catch { return []; }
  }

  async function loadItemsVentaFor(operacion) {
    if (!operacion) return [];
    try { return await GET(`/items/venta?operacion=${operacion}`); } catch { return []; }
  }

  async function renderTab() {
    const cfg = MOV_FLUJOS[flujoActual];
    const content = document.getElementById('mv-content');
    content.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;

    let opsData = {};
    try { opsData = await GET(`/movimientos/operaciones?flujo=${flujoActual}`); }
    catch (err) { content.innerHTML = `<div class="msg-error">${err.message}</div>`; return; }

    const operaciones = opsData.operaciones || [];
    const destinos = opsData.destinos || [];
    const es86 = flujoActual === '86';
    const rol = isAdmin ? 'REGISTRO' : (S.user[cfg.rolField] || '');
    const puedeCrear = isAdmin || (es86 ? rol === 'REGISTRO' : rol === 'SOLICITUD');

    content.innerHTML = `
      <div class="card mb-16" style="padding:16px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          ${operaciones.length > 1 ? `
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
            <select id="mv-f-op" class="form-control" style="width:140px">
              <option value="">Todas</option>
              ${operaciones.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>` : ''}
          ${!es86 ? `
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Estado</label>
            <select id="mv-f-estado" class="form-control" style="width:140px">
              <option value="">Todos</option>
              <option value="REGISTRADO">Registrado</option>
              <option value="PROCESADO">Procesado</option>
            </select>
          </div>` : ''}
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Desde</label>
            <input type="date" id="mv-f-desde" class="form-control" style="width:140px">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Hasta</label>
            <input type="date" id="mv-f-hasta" class="form-control" style="width:140px">
          </div>
          <button class="btn btn-primary" id="mv-buscar">🔍 Buscar</button>
          ${puedeCrear ? `<button class="btn btn-success" id="mv-nuevo">+ Nuevo</button>` : ''}
        </div>
      </div>
      <div id="mv-table-wrap"></div>`;

    let currentRegistros = [];

    document.getElementById('mv-buscar').addEventListener('click', () => buscar());
    if (puedeCrear) document.getElementById('mv-nuevo').addEventListener('click', () => {
      renderTable(document.getElementById('mv-table-wrap'), currentRegistros, rol, operaciones, destinos, 'new', buscar);
    });

    async function buscar() {
      const wrap = document.getElementById('mv-table-wrap');
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
      const params = new URLSearchParams({ flujo: flujoActual });
      const opSel = document.getElementById('mv-f-op')?.value;
      if (opSel) params.set('operacion', opSel);
      const estadoSel = document.getElementById('mv-f-estado')?.value;
      if (estadoSel) params.set('estado', estadoSel);
      const desde = document.getElementById('mv-f-desde')?.value;
      if (desde) params.set('desde', desde);
      const hasta = document.getElementById('mv-f-hasta')?.value;
      if (hasta) params.set('hasta', hasta);

      try {
        currentRegistros = await GET(`/movimientos?${params.toString()}`);
        await renderTable(wrap, currentRegistros, rol, operaciones, destinos, null, buscar);
      } catch (err) { wrap.innerHTML = `<div class="msg-error">${err.message}</div>`; }
    }

    await buscar();
  }

  async function renderTable(wrap, registros, rol, operaciones, destinos, editingId = null, buscar) {
    const cfg = MOV_FLUJOS[flujoActual];
    const esTransferencia = flujoActual === 'TRANSFERENCIA';
    const es86 = flujoActual === '86';
    const tieneTipo = !!cfg.tipos;

    if (!registros.length && editingId === null) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin registros.</p></div>`;
      return;
    }

    const fmtCant = v => Number(v).toLocaleString('es-CL', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const fmtFechaHora = d => d ? new Date(d).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    function puedeEditarRegistro(r) {
      if (isAdmin) return true;
      if (es86) return rol === 'REGISTRO';
      if (r.estado !== 'REGISTRADO') return false;
      if (rol === 'SOLICITUD') return r.creadoPorId === S.user.id;
      return rol === 'REGISTRO';
    }

    function estadoBadge(estado) {
      if (estado === 'PROCESADO') return { bg: '#d1fae5', color: '#059669' };
      if (estado === 'RECHAZADO') return { bg: '#fee2e2', color: '#dc2626' };
      return { bg: '#f3f4f6', color: '#6b7280' };
    }

    function editRowHtml(record) {
      const opDefault = record?.operacion || (operaciones.length === 1 ? operaciones[0] : '');
      const fechaDefault = record?.fecha ? record.fecha.slice(0, 10) : today();
      const fechaHoraDefault = toDatetimeLocal(record?.fecha ? new Date(record.fecha) : new Date());
      return `<tr data-edit-row="1">
        <td><input type="${es86 ? 'datetime-local' : 'date'}" id="mv-edit-fecha" class="form-control" style="min-width:160px" value="${es86 ? fechaHoraDefault : fechaDefault}"></td>
        <td>${operaciones.length > 1
          ? `<select id="mv-edit-operacion" class="form-control">${operaciones.map(o => `<option value="${o}" ${o === opDefault ? 'selected' : ''}>${o}</option>`).join('')}</select>`
          : `${esc(opDefault)}<input type="hidden" id="mv-edit-operacion" value="${esc(opDefault)}">`}</td>
        ${esTransferencia ? `<td><select id="mv-edit-destino" class="form-control"></select></td>` : ''}
        <td style="position:relative;min-width:330px">
          <input type="text" id="mv-edit-item-search" class="form-control" style="min-width:330px" autocomplete="off" placeholder="Buscar por código o nombre...">
          <input type="hidden" id="mv-edit-item" value="${record?.item ?? ''}">
          <div id="mv-edit-item-results" style="position:fixed;z-index:1000;background:var(--white);border:1px solid var(--border);max-height:220px;overflow-y:auto;display:none;box-shadow:0 2px 6px rgba(0,0,0,.1)"></div>
        </td>
        ${tieneTipo ? `<td><select id="mv-edit-tipo" class="form-control">${cfg.tipos.map(t => `<option value="${t}" ${record?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>` : ''}
        ${!es86 ? `<td style="text-align:right"><input type="number" id="mv-edit-cantidad" class="form-control" style="width:100px" step="0.0001" min="0.0001" value="${record?.cantidad ?? ''}"></td>` : ''}
        <td style="min-width:562px"><input type="text" id="mv-edit-comentarios" class="form-control" style="width:100%" value="${esc(record?.comentarios || '')}"></td>
        <td style="font-size:12px">
          ${!es86 && record ? (() => { const b = estadoBadge(record.estado); return `<span class="badge" style="background:${b.bg};color:${b.color}">${record.estado}</span><br>`; })() : ''}
          ${esc(record?.creadoPorNombre || '—')}
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-xs btn-primary" id="mv-edit-save" title="Guardar">💾</button>
          <button class="btn btn-xs btn-outline" id="mv-edit-cancel" title="Cancelar">✕</button>
        </td>
      </tr>`;
    }

    const rowsHtml = registros.map(r => {
      if (r.id === editingId) return editRowHtml(r);
      const editable = puedeEditarRegistro(r);
      const procesable = !es86 && rol === 'REGISTRO' && r.estado === 'REGISTRADO';
      return `<tr>
        <td>${es86 ? fmtFechaHora(r.fecha) : fmtDate(r.fecha)}</td>
        <td>${esc(r.operacion)}</td>
        ${esTransferencia ? `<td>${esc(r.operacionDestino)}</td>` : ''}
        <td style="min-width:330px">${esc(String(r.item))}${r.itemNombre ? ' - ' + esc(r.itemNombre) : ''}</td>
        ${tieneTipo ? `<td>${esc(r.tipo)}</td>` : ''}
        ${!es86 ? `<td class="text-right">${fmtCant(r.cantidad)}</td>` : ''}
        <td style="min-width:562px;white-space:normal">${esc(r.comentarios || '')}</td>
        <td style="font-size:12px">
          ${!es86 ? (() => { const b = estadoBadge(r.estado); return `<span class="badge" style="background:${b.bg};color:${b.color}" title="${esc(r.comentarioProceso || '')}">${r.estado}</span><br>`; })() : ''}
          ${esc(r.creadoPorNombre || '')}
        </td>
        <td style="white-space:nowrap">
          ${editable ? `<button class="btn btn-xs btn-outline" onclick="mvEditar('${r.id}')" title="Editar">✏️</button>` : ''}
          ${editable ? `<button class="btn btn-xs btn-outline" style="color:#ef4444;border-color:#ef4444" onclick="mvEliminar('${r.id}')" title="Eliminar">🗑️</button>` : ''}
          ${procesable ? `<button class="btn btn-xs btn-outline" style="color:#059669;border-color:#059669" onclick="mvProcesar('${r.id}','PROCESADO')" title="Procesar">✅</button>` : ''}
          ${procesable ? `<button class="btn btn-xs btn-outline" style="color:#ef4444;border-color:#ef4444" onclick="mvProcesar('${r.id}','RECHAZADO')" title="Rechazar">❌</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    const newRowHtml = editingId === 'new' ? editRowHtml(null) : '';

    wrap.innerHTML = `
      <div class="card">
        <div style="overflow-x:auto">
          <table class="data-table mv-table">
            <thead><tr>
              <th>Fecha${es86 ? ' / Hora' : ''}</th>
              <th>Operación</th>
              ${esTransferencia ? '<th>Destino</th>' : ''}
              <th style="min-width:330px">Ítem</th>
              ${tieneTipo ? '<th>Tipo</th>' : ''}
              ${!es86 ? '<th class="text-right">Cantidad</th>' : ''}
              <th style="min-width:562px">Comentarios</th>
              <th>${es86 ? 'Creado por' : 'Estado / Creado por'}</th>
              <th>Acciones</th>
            </tr></thead>
            <tbody>
              ${newRowHtml}
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>`;

    window.mvEditar = (id) => renderTable(wrap, registros, rol, operaciones, destinos, id, buscar);

    window.mvEliminar = async (id) => {
      if (!confirm('¿Eliminar este registro?')) return;
      try {
        await DEL(`/movimientos/${id}`);
        toast('Registro eliminado', 'success');
        buscar();
      } catch (err) { toast(err.message, 'error'); }
    };

    window.mvProcesar = async (id, estado) => {
      const label = estado === 'PROCESADO' ? 'procesado' : 'rechazado';
      const comentario = prompt(`Comentario (opcional) para marcar como ${label}:`, '');
      if (comentario === null) return;
      try {
        await PUT(`/movimientos/${id}/procesar`, { estado, comentario: comentario.trim() });
        toast(`Registro ${label}`, 'success');
        buscar();
      } catch (err) { toast(err.message, 'error'); }
    };

    const editRowEl = wrap.querySelector('tr[data-edit-row]');
    if (!editRowEl) return;

    const record = editingId === 'new' ? null : registros.find(r => r.id === editingId);
    const operacionEl = document.getElementById('mv-edit-operacion');

    let itemsCache = [];
    const itemSearchEl = document.getElementById('mv-edit-item-search');
    const itemHiddenEl = document.getElementById('mv-edit-item');
    const itemResultsEl = document.getElementById('mv-edit-item-results');

    function renderItemResults(filter) {
      const f = filter.trim().toLowerCase();
      const matches = (f
        ? itemsCache.filter(it => String(it.item).toLowerCase().includes(f) || (it.nombre || '').toLowerCase().includes(f))
        : itemsCache).slice(0, 50);
      if (!matches.length) { itemResultsEl.style.display = 'none'; itemResultsEl.innerHTML = ''; return; }
      itemResultsEl.innerHTML = matches.map(it =>
        `<div class="mv-item-option" data-item="${esc(it.item)}" data-nombre="${esc(it.nombre)}" style="padding:6px 8px;cursor:pointer;font-size:13px">${esc(it.item)} - ${esc(it.nombre)}</div>`
      ).join('');
      const rect = itemSearchEl.getBoundingClientRect();
      itemResultsEl.style.left = `${rect.left}px`;
      itemResultsEl.style.top = `${rect.bottom}px`;
      itemResultsEl.style.width = `${rect.width}px`;
      itemResultsEl.style.display = 'block';
    }

    async function populateItems(operacion, selectedItem) {
      itemSearchEl.disabled = true;
      itemSearchEl.value = 'Cargando...';
      itemsCache = es86 ? await loadItemsVentaFor(operacion) : await loadItemsFor(operacion);
      itemSearchEl.disabled = false;
      if (selectedItem) {
        const found = itemsCache.find(it => String(it.item) === String(selectedItem));
        itemSearchEl.value = found ? `${found.item} - ${found.nombre}` : String(selectedItem);
        itemHiddenEl.value = selectedItem;
      } else {
        itemSearchEl.value = '';
        itemHiddenEl.value = '';
      }
    }

    itemSearchEl.addEventListener('input', () => {
      itemHiddenEl.value = '';
      renderItemResults(itemSearchEl.value);
    });
    itemSearchEl.addEventListener('focus', () => renderItemResults(itemSearchEl.value));
    itemResultsEl.addEventListener('click', (e) => {
      const opt = e.target.closest('.mv-item-option');
      if (!opt) return;
      itemHiddenEl.value = opt.dataset.item;
      itemSearchEl.value = `${opt.dataset.item} - ${opt.dataset.nombre}`;
      itemResultsEl.style.display = 'none';
    });
    if (window._mvItemDocClick) document.removeEventListener('click', window._mvItemDocClick);
    window._mvItemDocClick = (e) => {
      if (e.target !== itemSearchEl && !itemResultsEl.contains(e.target)) itemResultsEl.style.display = 'none';
    };
    document.addEventListener('click', window._mvItemDocClick);

    function refreshDestinos() {
      if (!esTransferencia) return;
      const destSel = document.getElementById('mv-edit-destino');
      const origen = operacionEl.value;
      destSel.innerHTML = destinos.filter(d => d !== origen).map(o => `<option value="${o}" ${record?.operacionDestino === o ? 'selected' : ''}>${o}</option>`).join('');
    }

    await populateItems(operacionEl.value, record?.item);
    refreshDestinos();

    if (operacionEl.tagName === 'SELECT') {
      operacionEl.addEventListener('change', () => { populateItems(operacionEl.value, null); refreshDestinos(); });
    }

    document.getElementById('mv-edit-cancel').onclick = () => renderTable(wrap, registros, rol, operaciones, destinos, null, buscar);

    document.getElementById('mv-edit-save').onclick = async () => {
      const fechaVal = document.getElementById('mv-edit-fecha').value;
      if (!fechaVal) return toast('Ingrese fecha', 'error');
      const item = document.getElementById('mv-edit-item').value;
      if (!item) return toast('Seleccione un ítem', 'error');

      const body = {
        flujo: flujoActual,
        operacion: operacionEl.value,
        fecha: es86 ? new Date(fechaVal).toISOString() : fechaVal,
        item,
        comentarios: document.getElementById('mv-edit-comentarios').value.trim(),
      };
      if (esTransferencia) {
        const destino = document.getElementById('mv-edit-destino').value;
        if (!destino) return toast('Seleccione operación destino', 'error');
        body.operacionDestino = destino;
      }
      if (tieneTipo) body.tipo = document.getElementById('mv-edit-tipo').value;
      if (!es86) {
        const cant = Number(document.getElementById('mv-edit-cantidad').value);
        if (!cant || cant <= 0) return toast('Cantidad debe ser mayor a 0', 'error');
        body.cantidad = cant;
      }

      try {
        if (record) await PUT(`/movimientos/${record.id}`, body);
        else await POST('/movimientos', body);
        toast('Guardado correctamente', 'success');
        buscar();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  await renderTab();
}

// ─── View: Cierre de Caja ────────────────────────────────────────
const CJ_MEDIOS = [['efectivo', '💵 Efectivo'], ['tarjeta', '💳 Tarjeta'], ['delivery', '🛵 Delivery (CxC)'], ['transferencia', '🏦 Transferencia']];
const CJ_COMBOS = [['ventaPEN', 'Medio de Pago S/'], ['ventaUSD', 'Medio de Pago US$'], ['propinaPEN', 'Tip S/'], ['propinaUSD', 'Tip US$']];
const cjN   = v => Number(v) || 0;
const cjFmt = v => cjN(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CJ_DENOM_PEN = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];
const CJ_DENOM_USD = [100, 50, 20, 10, 5, 1];
const cjDenomSym = moneda => moneda === 'USD' ? 'US$' : 'S/';

function cjDenomTableHtml(prefix, moneda, valores, dis) {
  const denoms = moneda === 'USD' ? CJ_DENOM_USD : CJ_DENOM_PEN;
  const sym = cjDenomSym(moneda);
  return `
    <table class="data-table" style="font-size:12px">
      <thead><tr><th style="text-align:center">Denom.</th><th style="text-align:center">Cant.</th><th style="text-align:center">Subtotal</th></tr></thead>
      <tbody>
        ${denoms.map(d => `<tr>
          <td style="text-align:center">${sym} ${d}</td>
          <td style="text-align:center"><input type="number" min="0" step="1" class="form-control cj-denom-input" data-prefix="${prefix}" data-moneda="${moneda}" data-denom="${d}" value="${valores[d] || ''}" placeholder="0" style="width:64px;text-align:center" ${dis}></td>
          <td id="cj-denom-sub-${prefix}-${moneda}-${d}" style="text-align:right">${cjFmt(d * (valores[d] || 0))}</td>
        </tr>`).join('')}
        <tr style="font-weight:700;background:#f8fafc">
          <td colspan="2" style="text-align:right">Total ${sym}</td>
          <td id="cj-denom-total-${prefix}-${moneda}" style="text-align:right">${cjFmt(denoms.reduce((s, d) => s + d * (valores[d] || 0), 0))}</td>
        </tr>
      </tbody>
    </table>`;
}

function cjDenomListener(prefix, moneda) {
  const denoms = moneda === 'USD' ? CJ_DENOM_USD : CJ_DENOM_PEN;
  document.querySelectorAll(`.cj-denom-input[data-prefix="${prefix}"][data-moneda="${moneda}"]`).forEach(el => {
    el.addEventListener('input', () => {
      let total = 0;
      denoms.forEach(d => {
        const qty = cjN(document.querySelector(`.cj-denom-input[data-prefix="${prefix}"][data-moneda="${moneda}"][data-denom="${d}"]`)?.value);
        const sub = d * qty;
        total += sub;
        const subEl = document.getElementById(`cj-denom-sub-${prefix}-${moneda}-${d}`);
        if (subEl) subEl.textContent = cjFmt(sub);
      });
      const totalEl = document.getElementById(`cj-denom-total-${prefix}-${moneda}`);
      if (totalEl) totalEl.textContent = cjFmt(total);
    });
  });
}

function cjDenomTotal(prefix, moneda) {
  const denoms = moneda === 'USD' ? CJ_DENOM_USD : CJ_DENOM_PEN;
  return denoms.reduce((s, d) => s + d * cjN(document.querySelector(`.cj-denom-input[data-prefix="${prefix}"][data-moneda="${moneda}"][data-denom="${d}"]`)?.value), 0);
}

function cjDenomValores(prefix, moneda) {
  const denoms = moneda === 'USD' ? CJ_DENOM_USD : CJ_DENOM_PEN;
  const obj = {};
  denoms.forEach(d => {
    const qty = Math.round(cjN(document.querySelector(`.cj-denom-input[data-prefix="${prefix}"][data-moneda="${moneda}"][data-denom="${d}"]`)?.value));
    if (qty > 0) obj[d] = qty;
  });
  return obj;
}
const cjBadge = (texto, color, bg) => `<span class="badge" style="background:${bg};color:${color}">${texto}</span>`;
const CJ_ESTADO_BADGE = {
  ABIERTO:    cjBadge('ABIERTO', '#1d4ed8', '#dbeafe'),
  CERRADO:    cjBadge('CERRADO', '#065f46', '#d1fae5'),
  ENVIADO:    cjBadge('ENVIADO', '#92400e', '#fef3c7'),
  RECIBIDO:   cjBadge('RECIBIDO', '#065f46', '#d1fae5'),
  PENDIENTE:  cjBadge('PENDIENTE', '#92400e', '#fef3c7'),
  EN_OFICINA: cjBadge('EN OFICINA', '#1d4ed8', '#dbeafe'),
  DEPOSITADO: cjBadge('DEPOSITADO', '#065f46', '#d1fae5'),
};

let _cjOps = [];
let _cjTab = '';
let _cjCierres = [];
let _cjEnvios = [];
let _cjDepositos = [];
let _cjEnvioDisponibles = [];
let _cjDepositoDisponibles = [];

async function viewCierreCaja(container) {
  const isAdmin = S.user.role === 'ADMIN';
  const tabs = [];
  if (isAdmin || S.user.rolCaja)         tabs.push('cierres');
  if (isAdmin || S.user.accesoOficina)   tabs.push('oficina');
  if (isAdmin || S.user.accesoDepositos) tabs.push('depositos');

  if (!tabs.length) {
    container.innerHTML = `
      <div class="page-header"><div class="page-title">🧾 Cierre de Caja</div></div>
      <div class="page-body"><div class="empty-state"><div class="empty-icon">🔒</div><p>No tienes acceso a este módulo.</p></div></div>`;
    return;
  }

  try { _cjOps = await GET('/caja/operaciones'); } catch (err) { _cjOps = []; }

  const TAB_LABEL = { cierres: '🧾 Cierres de Caja', oficina: '🏢 Envío a Oficina', depositos: '🏦 Depósito Bancario' };
  if (!tabs.includes(_cjTab)) _cjTab = tabs[0];

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja</div></div>
    <div class="page-body">
      <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:16px;width:fit-content">
        ${tabs.map(t => `<button class="cj-tab" data-tab="${t}" style="padding:8px 16px;font-size:13px;border:none;cursor:pointer;background:${t === _cjTab ? 'var(--accent)' : 'var(--bg-secondary)'};color:${t === _cjTab ? '#fff' : 'var(--text)'}">${TAB_LABEL[t]}</button>`).join('')}
      </div>
      <div id="cj-content"></div>
    </div>`;

  container.querySelectorAll('.cj-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _cjTab = btn.dataset.tab;
      container.querySelectorAll('.cj-tab').forEach(b => {
        const active = b.dataset.tab === _cjTab;
        b.style.background = active ? 'var(--accent)' : 'var(--bg-secondary)';
        b.style.color = active ? '#fff' : 'var(--text)';
      });
      cjRenderTab();
    });
  });

  await cjRenderTab();
}

async function cjRenderTab() {
  const content = document.getElementById('cj-content');
  if (!content) return;
  content.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  if (_cjTab === 'cierres')   return cjRenderCierres(content);
  if (_cjTab === 'oficina')   return cjRenderOficina(content);
  if (_cjTab === 'depositos') return cjRenderDepositos(content);
}

function cjFilterBarHtml(prefix) {
  return `
    <div class="card mb-16" style="padding:16px">
      <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div>
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
          <select id="${prefix}-op" class="form-control" style="width:140px">
            ${_cjOps.map(o => `<option value="${esc(o.operacion)}">${esc(o.operacion)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Desde</label>
          <input type="date" id="${prefix}-desde" class="form-control" style="width:140px">
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Hasta</label>
          <input type="date" id="${prefix}-hasta" class="form-control" style="width:140px">
        </div>
        <button id="${prefix}-buscar" class="btn btn-outline btn-sm">🔍 Buscar</button>
        <div id="${prefix}-acciones" style="margin-left:auto;display:flex;gap:8px"></div>
      </div>
    </div>`;
}

// ── Tab: Cierres de Caja ──────────────────────────────────────────
async function cjRenderCierres(content) {
  const isAdmin = S.user.role === 'ADMIN';
  const puedeRegistrar = isAdmin || S.user.rolCaja === 'REGISTRO';

  content.innerHTML = `${cjFilterBarHtml('cj-c')}<div id="cj-c-tabla"></div>`;

  if (puedeRegistrar) {
    document.getElementById('cj-c-acciones').innerHTML = `<button id="cj-c-nuevo" class="btn btn-primary btn-sm">+ Nuevo Cierre</button>`;
    document.getElementById('cj-c-nuevo').addEventListener('click', () => window.cjAbrirFormCierre(document.getElementById('cj-c-op').value, null));
  }
  document.getElementById('cj-c-buscar').addEventListener('click', window.cjBuscarCierres);
  await window.cjBuscarCierres();
}

window.cjBuscarCierres = async function() {
  const tabla = document.getElementById('cj-c-tabla');
  const op = document.getElementById('cj-c-op')?.value;
  const desde = document.getElementById('cj-c-desde')?.value;
  const hasta = document.getElementById('cj-c-hasta')?.value;
  if (!op) { tabla.innerHTML = `<div class="empty-state"><p>No hay operaciones disponibles.</p></div>`; return; }
  tabla.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  const q = new URLSearchParams({ operacion: op });
  if (desde) q.set('desde', desde);
  if (hasta) q.set('hasta', hasta);
  try { _cjCierres = await GET(`/caja/cierres?${q}`); }
  catch (err) { tabla.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  cjRenderTablaCierres();
};

function cjRenderTablaCierres() {
  const tabla = document.getElementById('cj-c-tabla');
  const isAdmin = S.user.role === 'ADMIN';
  if (!_cjCierres.length) { tabla.innerHTML = `<div class="empty-state"><p>Sin cierres registrados en el rango seleccionado.</p></div>`; return; }
  tabla.innerHTML = `
    <div class="card" style="overflow:hidden;overflow-x:auto">
      <table class="data-table" style="font-size:12px;white-space:nowrap">
        <thead><tr>
          <th style="text-align:center">Fecha</th><th style="text-align:center">Turno</th><th style="text-align:center">Estado</th>
          <th style="text-align:center">Medio de Pago S/</th><th style="text-align:center">Medio de Pago US$</th>
          <th style="text-align:center">Tip S/</th><th style="text-align:center">Tip US$</th>
          <th style="text-align:center">Ef. Contado S/</th><th style="text-align:center">Ef. Contado US$</th>
          ${isAdmin ? '<th style="text-align:center">Acciones</th>' : ''}
        </tr></thead>
        <tbody>
          ${_cjCierres.map(c => {
            const tv = k => CJ_MEDIOS.reduce((s, [m]) => s + cjN(c.cobranzas?.[m]?.[k]), 0);
            return `<tr style="cursor:pointer" onclick="cjAbrirFormCierreId('${c.id}')">
              <td>${esc(c.fecha)}</td>
              <td>${esc(c.turno || 'Único')}</td>
              <td>${CJ_ESTADO_BADGE[c.estado] || c.estado}</td>
              <td style="text-align:right">${cjFmt(tv('ventaPEN'))}</td>
              <td style="text-align:right">${cjFmt(tv('ventaUSD'))}</td>
              <td style="text-align:right">${cjFmt(tv('propinaPEN'))}</td>
              <td style="text-align:right">${cjFmt(tv('propinaUSD'))}</td>
              <td style="text-align:right">${cjFmt(c.efectivoContado?.ventaPEN)}</td>
              <td style="text-align:right">${cjFmt(c.efectivoContado?.ventaUSD)}</td>
              ${isAdmin ? `<td style="text-align:center"><button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();cjEliminarCierre('${c.id}')">🗑️</button></td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

window.cjEliminarCierre = async function(id) {
  if (!confirm('¿Eliminar este cierre de caja? Esta acción no se puede deshacer.')) return;
  try {
    await DEL(`/caja/cierres/${id}`);
    toast('Cierre eliminado', 'success');
    window.cjBuscarCierres();
  } catch (e) { toast(e.message, 'error'); }
};

window.cjAbrirFormCierreId = function(id) {
  const c = _cjCierres.find(x => x.id === id);
  if (c) window.cjAbrirFormCierre(c.operacion, c);
};

window.cjAbrirFormCierre = function(operacion, existente) {
  if (!existente) window.cjAbrirFormApertura(operacion);
  else window.cjAbrirFormCompleto(existente);
};

// Paso 1 de un cierre nuevo: solo el conteo de Apertura. Una vez grabado, se crea
// el CierreCaja y se pasa al formulario completo, sin volver a mostrar la apertura.
window.cjAbrirFormApertura = function(operacion) {
  const fecha = today();
  const turnos = _cjOps.find(o => o.operacion === operacion)?.turnos?.length
    ? _cjOps.find(o => o.operacion === operacion).turnos : ['Único'];
  const html = `
    <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div><label class="form-label">Operación</label><input type="text" class="form-control" value="${esc(operacion)}" disabled style="width:120px"></div>
      <div><label class="form-label">Fecha</label><input type="date" id="cj-a-fecha" class="form-control" value="${fecha}" style="width:160px"></div>
      <div><label class="form-label">Turno</label><select id="cj-a-turno" class="form-control" style="width:160px">
        ${turnos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select></div>
    </div>
    <div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">Apertura de Caja (conteo de billetes y monedas)</div>
    <div style="display:flex;gap:28px;margin-bottom:8px;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center">S/</div>
        ${cjDenomTableHtml('apertura', 'PEN', {}, '')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center">US$</div>
        ${cjDenomTableHtml('apertura', 'USD', {}, '')}
      </div>
    </div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      <button id="cj-a-grabar" class="btn btn-primary btn-sm">🔓 Grabar Apertura</button>
    </div>`;

  openModal(`🧾 Apertura de Caja — ${esc(operacion)}`, html, null, { wide: true });
  cjDenomListener('apertura', 'PEN');
  cjDenomListener('apertura', 'USD');

  document.getElementById('cj-a-grabar').addEventListener('click', async () => {
    const fechaVal = document.getElementById('cj-a-fecha').value;
    if (!fechaVal) return toast('Selecciona la fecha', 'error');
    try {
      await POST('/caja/cierres', {
        operacion,
        fecha: fechaVal,
        turno: document.getElementById('cj-a-turno').value,
        conteoApertura: { PEN: cjDenomValores('apertura', 'PEN'), USD: cjDenomValores('apertura', 'USD') },
      });
      toast('Apertura registrada', 'success');
      closeModal();
      window.cjBuscarCierres();
    } catch (e) { toast(e.message, 'error'); }
  });
};

// Paso 2: cobranzas, conteo de cierre y envío a oficina. La apertura ya no se muestra.
window.cjAbrirFormCompleto = function(existente) {
  const isAdmin = S.user.role === 'ADMIN';
  const soloLectura = existente.estado === 'CERRADO' && !isAdmin;
  const dis = soloLectura ? 'disabled' : '';
  const cob = existente.cobranzas || {};
  const valCierrePEN = existente.conteoCierre?.PEN || {};
  const valCierreUSD = existente.conteoCierre?.USD || {};

  const filaInput = ([medio, label]) => `
    <tr>
      <td style="font-weight:600;white-space:nowrap">${label}</td>
      ${CJ_COMBOS.map(([k]) => `<td><input type="number" step="0.01" class="form-control cj-cob-input" data-medio="${medio}" data-combo="${k}" value="${cjN(cob[medio]?.[k])}" style="width:100px;text-align:right" ${dis}></td>`).join('')}
    </tr>`;

  // Totales ya enviados a oficina (solo lectura, calculado de combos en EN_OFICINA/DEPOSITADO)
  const enviado = { PEN: 0, USD: 0 };
  CJ_COMBOS.forEach(([k]) => {
    if (['EN_OFICINA', 'DEPOSITADO'].includes(existente.estadoEfectivo?.[k])) {
      if (k.endsWith('PEN')) enviado.PEN += cjN(existente.efectivoContado?.[k]);
      else enviado.USD += cjN(existente.efectivoContado?.[k]);
    }
  });

  const html = `
    <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div><label class="form-label">Operación</label><input type="text" class="form-control" value="${esc(existente.operacion)}" disabled style="width:120px"></div>
      <div><label class="form-label">Fecha</label><input type="date" id="cj-f-fecha" class="form-control" value="${esc(existente.fecha)}" disabled style="width:160px"></div>
      <div><label class="form-label">Turno</label><input type="text" class="form-control" value="${esc(existente.turno || 'Único')}" disabled style="width:120px"></div>
      <div><label class="form-label">Estado</label><div style="padding-top:8px">${CJ_ESTADO_BADGE[existente.estado || 'ABIERTO']}</div></div>
    </div>
    <div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">Cobranzas declaradas</div>
    <div style="overflow-x:auto;margin-bottom:16px">
      <table class="data-table" style="font-size:12px">
        <thead><tr><th style="text-align:center">Medio de pago</th><th style="text-align:center">Medio de Pago S/</th><th style="text-align:center">Medio de Pago US$</th><th style="text-align:center">Tip S/</th><th style="text-align:center">Tip US$</th></tr></thead>
        <tbody>${CJ_MEDIOS.map(filaInput).join('')}</tbody>
      </table>
    </div>
    <div style="font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">Cierre de Caja (conteo de billetes y monedas)</div>
    <div style="display:flex;gap:28px;margin-bottom:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center">S/</div>
        ${cjDenomTableHtml('cierre', 'PEN', valCierrePEN, dis)}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center">US$</div>
        ${cjDenomTableHtml('cierre', 'USD', valCierreUSD, dis)}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-align:center;text-transform:uppercase;letter-spacing:.5px">Enviado a Oficina</div>
        <table class="data-table" style="font-size:12px">
          <thead><tr><th style="text-align:center">S/</th><th style="text-align:center">$</th></tr></thead>
          <tbody><tr>
            <td><input type="number" step="0.01" id="cj-f-enviado-PEN" class="form-control" value="${enviado.PEN}" style="width:100px;text-align:right" ${dis}></td>
            <td><input type="number" step="0.01" id="cj-f-enviado-USD" class="form-control" value="${enviado.USD}" style="width:100px;text-align:right" ${dis}></td>
          </tr></tbody>
        </table>
      </div>
    </div>
    <div><label class="form-label">Comentarios</label><textarea id="cj-f-comentarios" class="form-control" rows="2" style="width:100%" ${dis}>${esc(existente.comentarios || '')}</textarea></div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">${soloLectura ? 'Cerrar' : 'Cancelar'}</button>
      ${!soloLectura ? `<button id="cj-f-guardar" class="btn btn-outline btn-sm">💾 Guardar</button>` : ''}
      ${!soloLectura && existente.estado !== 'CERRADO' ? `<button id="cj-f-cerrar" class="btn btn-primary btn-sm">🔒 Cerrar Caja</button>` : ''}
    </div>`;

  openModal(`🧾 Cierre de Caja — ${esc(existente.fecha)} (${esc(existente.turno || 'Único')})`, html, null, { medium: true });

  cjDenomListener('cierre', 'PEN');
  cjDenomListener('cierre', 'USD');

  // El conteo físico no distingue Medio de Pago/Tip; se reparte proporcional a lo declarado en Efectivo arriba
  function splitProporcional(totalPEN, totalUSD, cobranzas) {
    const ef = cobranzas.efectivo || {};
    const totDeclPEN = (ef.ventaPEN || 0) + (ef.propinaPEN || 0);
    const totDeclUSD = (ef.ventaUSD || 0) + (ef.propinaUSD || 0);
    const ventaPEN = totDeclPEN > 0 ? Math.round(totalPEN * (ef.ventaPEN / totDeclPEN) * 100) / 100 : totalPEN;
    const ventaUSD = totDeclUSD > 0 ? Math.round(totalUSD * (ef.ventaUSD / totDeclUSD) * 100) / 100 : totalUSD;
    return {
      ventaPEN, propinaPEN: Math.round((totalPEN - ventaPEN) * 100) / 100,
      ventaUSD, propinaUSD: Math.round((totalUSD - ventaUSD) * 100) / 100,
    };
  }

  function leerForm() {
    const cobranzas = {};
    CJ_MEDIOS.forEach(([medio]) => {
      cobranzas[medio] = {};
      CJ_COMBOS.forEach(([combo]) => {
        cobranzas[medio][combo] = Number(document.querySelector(`.cj-cob-input[data-medio="${medio}"][data-combo="${combo}"]`)?.value) || 0;
      });
    });
    const contadoPEN = cjDenomTotal('cierre', 'PEN');
    const contadoUSD = cjDenomTotal('cierre', 'USD');
    const enviadoPEN = Number(document.getElementById('cj-f-enviado-PEN')?.value) || 0;
    const enviadoUSD = Number(document.getElementById('cj-f-enviado-USD')?.value) || 0;
    const efectivoContado = splitProporcional(contadoPEN, contadoUSD, cobranzas);
    const enviadoOficina = splitProporcional(enviadoPEN, enviadoUSD, cobranzas);
    const conteoCierre = { PEN: cjDenomValores('cierre', 'PEN'), USD: cjDenomValores('cierre', 'USD') };
    return {
      cobranzas, efectivoContado, enviadoOficina, conteoCierre,
      comentarios: document.getElementById('cj-f-comentarios').value,
    };
  }

  if (!soloLectura) {
    document.getElementById('cj-f-guardar')?.addEventListener('click', async () => {
      try {
        await PUT(`/caja/cierres/${existente.id}`, leerForm());
        toast('Cierre guardado', 'success');
        closeModal();
        window.cjBuscarCierres();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.getElementById('cj-f-cerrar')?.addEventListener('click', async () => {
      if (!confirm('¿Cerrar este día de caja? No se podrá editar después (salvo administrador).')) return;
      try {
        await PUT(`/caja/cierres/${existente.id}`, { ...leerForm(), estado: 'CERRADO' });
        toast('Caja cerrada', 'success');
        closeModal();
        window.cjBuscarCierres();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
};

// ── Tab: Envío a Oficina ──────────────────────────────────────────
async function cjRenderOficina(content) {
  content.innerHTML = `${cjFilterBarHtml('cj-o')}<div id="cj-o-tabla"></div>`;
  document.getElementById('cj-o-acciones').innerHTML = `<button id="cj-o-nuevo" class="btn btn-primary btn-sm">+ Nuevo Envío</button>`;
  document.getElementById('cj-o-nuevo').addEventListener('click', () => window.cjAbrirFormEnvio(document.getElementById('cj-o-op').value));
  document.getElementById('cj-o-buscar').addEventListener('click', window.cjBuscarEnvios);
  await window.cjBuscarEnvios();
}

window.cjBuscarEnvios = async function() {
  const tabla = document.getElementById('cj-o-tabla');
  const op = document.getElementById('cj-o-op')?.value;
  if (!op) { tabla.innerHTML = `<div class="empty-state"><p>No hay operaciones disponibles.</p></div>`; return; }
  tabla.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  try { _cjEnvios = await GET(`/caja/envios?operacion=${encodeURIComponent(op)}`); }
  catch (err) { tabla.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  cjRenderTablaEnvios();
};

function cjRenderTablaEnvios() {
  const tabla = document.getElementById('cj-o-tabla');
  if (!_cjEnvios.length) { tabla.innerHTML = `<div class="empty-state"><p>Sin envíos registrados.</p></div>`; return; }
  tabla.innerHTML = `
    <div class="card" style="overflow:hidden;overflow-x:auto">
      <table class="data-table" style="font-size:12px;white-space:nowrap">
        <thead><tr>
          <th style="text-align:center">Fecha</th><th style="text-align:center">Estado</th><th style="text-align:center">Cierres incluidos</th>
          <th style="text-align:center">Medio de Pago S/</th><th style="text-align:center">Medio de Pago US$</th>
          <th style="text-align:center">Tip S/</th><th style="text-align:center">Tip US$</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_cjEnvios.map(e => `<tr>
            <td>${esc(e.fecha)}</td>
            <td>${CJ_ESTADO_BADGE[e.estado] || e.estado}</td>
            <td>${(e.cierres || []).length}</td>
            <td style="text-align:right">${cjFmt(e.montos?.ventaPEN)}</td>
            <td style="text-align:right">${cjFmt(e.montos?.ventaUSD)}</td>
            <td style="text-align:right">${cjFmt(e.montos?.propinaPEN)}</td>
            <td style="text-align:right">${cjFmt(e.montos?.propinaUSD)}</td>
            <td>${e.estado === 'ENVIADO' ? `<button class="btn btn-sm btn-outline" onclick="cjAbrirRecibirEnvio('${e.id}')">✅ Recibir</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

window.cjAbrirFormEnvio = async function(operacion) {
  if (!operacion) return toast('Selecciona una operación', 'error');
  let disponibles = [];
  try { disponibles = await GET(`/caja/disponible-envio?operacion=${encodeURIComponent(operacion)}`); }
  catch (e) { toast(e.message, 'error'); return; }
  if (!disponibles.length) { toast('No hay efectivo pendiente de enviar en esta operación', 'warning'); return; }
  _cjEnvioDisponibles = disponibles;

  const html = `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Selecciona los cierres cuyo efectivo se envía a oficina:</div>
    <div style="border:1px solid var(--border);border-radius:6px;max-height:340px;overflow-y:auto;margin-bottom:14px">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th style="width:28px"></th><th style="text-align:center">Fecha</th>
          <th style="text-align:center">Medio de Pago S/</th><th style="text-align:center">Medio de Pago US$</th>
          <th style="text-align:center">Tip S/</th><th style="text-align:center">Tip US$</th>
        </tr></thead>
        <tbody>
          ${disponibles.map(c => `<tr>
            <td style="text-align:center"><input type="checkbox" class="cj-envio-chk" data-id="${c.id}" checked></td>
            <td>${esc(c.fecha)}</td>
            <td style="text-align:right">${c.estadoEfectivo.ventaPEN === 'PENDIENTE' ? cjFmt(c.efectivoContado.ventaPEN) : '—'}</td>
            <td style="text-align:right">${c.estadoEfectivo.ventaUSD === 'PENDIENTE' ? cjFmt(c.efectivoContado.ventaUSD) : '—'}</td>
            <td style="text-align:right">${c.estadoEfectivo.propinaPEN === 'PENDIENTE' ? cjFmt(c.efectivoContado.propinaPEN) : '—'}</td>
            <td style="text-align:right">${c.estadoEfectivo.propinaUSD === 'PENDIENTE' ? cjFmt(c.efectivoContado.propinaUSD) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div><label class="form-label">Fecha de envío</label><input type="date" id="cj-e-fecha" class="form-control" value="${today()}" style="width:160px"></div>
    <div style="margin-top:10px"><label class="form-label">Comentarios</label><textarea id="cj-e-comentarios" class="form-control" rows="2"></textarea></div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      <button id="cj-e-enviar" class="btn btn-primary btn-sm">📤 Registrar Envío</button>
    </div>`;
  openModal(`🏢 Nuevo Envío a Oficina — ${esc(operacion)}`, html, null, { wide: true });

  document.getElementById('cj-e-enviar').addEventListener('click', async () => {
    const cierreIds = Array.from(document.querySelectorAll('.cj-envio-chk:checked')).map(el => el.dataset.id);
    if (!cierreIds.length) return toast('Selecciona al menos un cierre', 'error');
    try {
      await POST('/caja/envios', {
        operacion,
        fecha: document.getElementById('cj-e-fecha').value,
        cierreIds,
        comentarios: document.getElementById('cj-e-comentarios').value,
      });
      toast('Envío registrado', 'success');
      closeModal();
      window.cjBuscarEnvios();
    } catch (e) { toast(e.message, 'error'); }
  });
};

window.cjAbrirRecibirEnvio = function(id) {
  const e = _cjEnvios.find(x => x.id === id);
  if (!e) return;
  const html = `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Confirma el monto recibido en oficina (por defecto, igual al enviado):</div>
    <div style="overflow-x:auto;margin-bottom:14px">
      <table class="data-table" style="font-size:12px">
        <thead><tr>${CJ_COMBOS.map(([, l]) => `<th style="text-align:center">${l}</th>`).join('')}</tr></thead>
        <tbody><tr>${CJ_COMBOS.map(([k]) => `<td><input type="number" step="0.01" id="cj-r-${k}" class="form-control" value="${cjN(e.montos[k])}" style="width:100px;text-align:right"></td>`).join('')}</tr></tbody>
      </table>
    </div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      <button id="cj-r-confirmar" class="btn btn-primary btn-sm">✅ Confirmar Recepción</button>
    </div>`;
  openModal(`✅ Recibir Envío — ${esc(e.fecha)}`, html, null);

  document.getElementById('cj-r-confirmar').addEventListener('click', async () => {
    const montosRecibidos = {};
    CJ_COMBOS.forEach(([k]) => { montosRecibidos[k] = Number(document.getElementById(`cj-r-${k}`)?.value) || 0; });
    try {
      await PUT(`/caja/envios/${id}/recibir`, { montosRecibidos });
      toast('Envío recibido', 'success');
      closeModal();
      window.cjBuscarEnvios();
    } catch (err) { toast(err.message, 'error'); }
  });
};

// ── Tab: Depósito Bancario ─────────────────────────────────────────
async function cjRenderDepositos(content) {
  content.innerHTML = `${cjFilterBarHtml('cj-d')}<div id="cj-d-tabla"></div>`;
  document.getElementById('cj-d-acciones').innerHTML = `<button id="cj-d-nuevo" class="btn btn-primary btn-sm">+ Nuevo Depósito</button>`;
  document.getElementById('cj-d-nuevo').addEventListener('click', () => window.cjAbrirFormDeposito(document.getElementById('cj-d-op').value));
  document.getElementById('cj-d-buscar').addEventListener('click', window.cjBuscarDepositos);
  await window.cjBuscarDepositos();
}

window.cjBuscarDepositos = async function() {
  const tabla = document.getElementById('cj-d-tabla');
  const op = document.getElementById('cj-d-op')?.value;
  const desde = document.getElementById('cj-d-desde')?.value;
  const hasta = document.getElementById('cj-d-hasta')?.value;
  if (!op) { tabla.innerHTML = `<div class="empty-state"><p>No hay operaciones disponibles.</p></div>`; return; }
  tabla.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  const q = new URLSearchParams({ operacion: op });
  if (desde) q.set('desde', desde);
  if (hasta) q.set('hasta', hasta);
  try { _cjDepositos = await GET(`/caja/depositos?${q}`); }
  catch (err) { tabla.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  cjRenderTablaDepositos();
};

function cjRenderTablaDepositos() {
  const tabla = document.getElementById('cj-d-tabla');
  if (!_cjDepositos.length) { tabla.innerHTML = `<div class="empty-state"><p>Sin depósitos registrados.</p></div>`; return; }
  tabla.innerHTML = `
    <div class="card" style="overflow:hidden;overflow-x:auto">
      <table class="data-table" style="font-size:12px;white-space:nowrap">
        <thead><tr>
          <th style="text-align:center">Fecha</th><th style="text-align:center">Moneda</th><th style="text-align:center">Tipo</th><th style="text-align:center">Monto</th>
          <th style="text-align:center">Banco</th><th style="text-align:center">N° Operación</th><th style="text-align:center">Días incluidos</th>
        </tr></thead>
        <tbody>
          ${_cjDepositos.map(d => `<tr>
            <td>${esc(d.fecha)}</td>
            <td>${d.moneda === 'USD' ? 'US$' : 'S/'}</td>
            <td>${d.tipo === 'VENTA' ? 'Medio de Pago' : 'Tip'}</td>
            <td style="text-align:right">${cjFmt(d.monto)}</td>
            <td>${esc(d.banco || '—')}</td>
            <td>${esc(d.numeroOperacion || '—')}</td>
            <td>${(d.origenes || []).map(o => esc(o.fecha)).join(', ')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

window.cjAbrirFormDeposito = function(operacion) {
  if (!operacion) return toast('Selecciona una operación', 'error');
  const html = `
    <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
      <div><label class="form-label">Moneda</label>
        <select id="cj-dep-moneda" class="form-control" style="width:110px">
          <option value="PEN">Soles (S/)</option><option value="USD">Dólares (US$)</option>
        </select>
      </div>
      <div><label class="form-label">Tipo</label>
        <select id="cj-dep-tipo" class="form-control" style="width:120px">
          <option value="VENTA">Medio de Pago</option><option value="PROPINA">Tip</option>
        </select>
      </div>
      <div><label class="form-label">Fecha de depósito</label><input type="date" id="cj-dep-fecha" class="form-control" value="${today()}" style="width:160px"></div>
    </div>
    <div id="cj-dep-origenes"></div>
    <div style="display:flex;gap:14px;margin-top:14px;flex-wrap:wrap">
      <div><label class="form-label">Banco</label><input type="text" id="cj-dep-banco" class="form-control" style="width:160px"></div>
      <div><label class="form-label">N° Operación</label><input type="text" id="cj-dep-numop" class="form-control" style="width:160px"></div>
    </div>
    <div style="margin-top:10px"><label class="form-label">Comentarios</label><textarea id="cj-dep-comentarios" class="form-control" rows="2"></textarea></div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Cancelar</button>
      <button id="cj-dep-guardar" class="btn btn-primary btn-sm">🏦 Registrar Depósito</button>
    </div>`;
  openModal(`🏦 Nuevo Depósito Bancario — ${esc(operacion)}`, html, null, { wide: true });

  async function actualizarTotal() {
    const total = Array.from(document.querySelectorAll('.cj-dep-chk:checked')).reduce((s, el) => s + Number(el.dataset.monto), 0);
    const el = document.getElementById('cj-dep-total');
    if (el) el.textContent = `Total a depositar: ${cjFmt(total)}`;
  }

  async function cargarOrigenes() {
    const moneda = document.getElementById('cj-dep-moneda').value;
    const tipo = document.getElementById('cj-dep-tipo').value;
    const cont = document.getElementById('cj-dep-origenes');
    cont.innerHTML = `<div style="padding:12px;color:var(--text-muted);font-size:12px">Cargando disponibles...</div>`;
    try {
      const data = await GET(`/caja/disponible-deposito?operacion=${encodeURIComponent(operacion)}&moneda=${moneda}&tipo=${tipo}`);
      _cjDepositoDisponibles = data.items || [];
      if (!_cjDepositoDisponibles.length) {
        cont.innerHTML = `<div style="padding:12px;color:var(--text-muted);font-size:12px">No hay efectivo pendiente de depositar para esta combinación.</div>`;
        return;
      }
      cont.innerHTML = `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Origen: ${data.origenTipo === 'ENVIO' ? 'Envíos a Oficina recibidos' : 'Cierres de Caja'}. Selecciona los días completos a depositar:</div>
        <div style="border:1px solid var(--border);border-radius:6px;max-height:240px;overflow-y:auto">
          <table class="data-table" style="font-size:12px">
            <thead><tr><th style="width:28px"></th><th style="text-align:center">Fecha</th><th style="text-align:center">Monto</th></tr></thead>
            <tbody>
              ${_cjDepositoDisponibles.map(o => `<tr>
                <td style="text-align:center"><input type="checkbox" class="cj-dep-chk" data-id="${o.id}" data-monto="${o.monto}" checked></td>
                <td>${esc(o.fecha)}</td>
                <td style="text-align:right">${cjFmt(o.monto)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div id="cj-dep-total" style="margin-top:8px;font-weight:600;font-size:13px;text-align:right"></div>`;
      cont.querySelectorAll('.cj-dep-chk').forEach(el => el.addEventListener('change', actualizarTotal));
      actualizarTotal();
    } catch (e) {
      cont.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`;
    }
  }
  document.getElementById('cj-dep-moneda').addEventListener('change', cargarOrigenes);
  document.getElementById('cj-dep-tipo').addEventListener('change', cargarOrigenes);
  cargarOrigenes();

  document.getElementById('cj-dep-guardar').addEventListener('click', async () => {
    const origenIds = Array.from(document.querySelectorAll('.cj-dep-chk:checked')).map(el => el.dataset.id);
    if (!origenIds.length) return toast('Selecciona al menos un origen', 'error');
    try {
      await POST('/caja/depositos', {
        operacion,
        fecha: document.getElementById('cj-dep-fecha').value,
        moneda: document.getElementById('cj-dep-moneda').value,
        tipo: document.getElementById('cj-dep-tipo').value,
        origenIds,
        banco: document.getElementById('cj-dep-banco').value,
        numeroOperacion: document.getElementById('cj-dep-numop').value,
        comentarios: document.getElementById('cj-dep-comentarios').value,
      });
      toast('Depósito registrado', 'success');
      closeModal();
      window.cjBuscarDepositos();
    } catch (e) { toast(e.message, 'error'); }
  });
};

// ─── Admin: Mapeo Empresas EBC ─────────────────────────────────────
async function renderAdminEBCCompanias(container) {
  async function reload() {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
    let docs = [];
    try { docs = await GET('/obligaciones-ebc/mapa-companias'); } catch (e) { container.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`; return; }

    container.innerHTML = `
      <div style="max-width:540px;padding:16px">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          Mapea los códigos de compañía del archivo EBC OBLIGACIONES.csv a los nombres de empresa usados en Gestión de Pagos.
        </p>
        <div class="card" style="padding:16px;margin-bottom:20px">
          <label style="font-weight:600;font-size:13px;display:block;margin-bottom:8px">Agregar / Actualizar mapeo</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="text" id="ebc-new-codigo" placeholder="Código (ej. 000001)" style="width:160px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
            <input type="text" id="ebc-new-compania" placeholder="Empresa (ej. ERSAC)" style="flex:1;min-width:140px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px">
            <button class="btn btn-primary btn-sm" id="ebc-add-btn">➕ Agregar</button>
          </div>
        </div>
        <div class="card" style="overflow:hidden">
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Código</th><th>Empresa</th><th style="width:60px"></th></tr></thead>
            <tbody>
              ${docs.length === 0
                ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px">Sin mapeos configurados</td></tr>`
                : docs.map(d => `<tr>
                    <td><code>${esc(d.codigo)}</code></td>
                    <td>${esc(d.compania)}</td>
                    <td><button class="btn btn-outline btn-sm" style="color:var(--danger);padding:2px 8px" onclick="ebcDelCodigo('${esc(d.codigo)}')">🗑️</button></td>
                  </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('ebc-add-btn').addEventListener('click', async () => {
      const codigo   = document.getElementById('ebc-new-codigo').value.trim();
      const compania = document.getElementById('ebc-new-compania').value.trim();
      if (!codigo || !compania) { toast('Completa ambos campos', 'error'); return; }
      try {
        await POST('/obligaciones-ebc/mapa-companias', { codigo, compania });
        toast('Guardado', 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  window.ebcDelCodigo = async (codigo) => {
    if (!confirm(`¿Eliminar mapeo para código ${codigo}?`)) return;
    try {
      await DEL(`/obligaciones-ebc/mapa-companias/${encodeURIComponent(codigo)}`);
      toast('Eliminado', 'success');
      renderAdminEBCCompanias(container);
    } catch (e) { toast(e.message, 'error'); }
  };

  reload();
}

// ─── Admin: Tiendas Proyección ────────────────────────────────────
async function renderAdminProyTiendas(container) {
  let _admProyCompania = ALL_SOCS_COMPRA[0] || '';
  let _admProyTiendas  = [];
  let _admProyCanales  = []; // canales en edición

  const pct = v => (Number(v) * 100).toFixed(2).replace(/\.?0+$/, '');

  async function reload() {
    if (!_admProyCompania) return;
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
    try {
      _admProyTiendas = await GET(`/proyeccion/tiendas?compania=${encodeURIComponent(_admProyCompania)}`);
      render();
    } catch (e) { container.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`; }
  }

  function canalesHtml(tienda) {
    return (tienda.canales || []).map(c => {
      const lbl = c.tipo === 'efectivo' ? 'Efectivo' : (c.nombre || c.tipo);
      const extra = c.tipo !== 'efectivo' ? ` · com ${pct(c.comisionRate)}% · IGV com ${pct(c.igvComisionRate)}%` : '';
      return `${lbl} ${pct(c.pct)}%${extra}`;
    }).join('<br>');
  }

  function render() {
    container.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <select id="admpt-compania" class="form-control" style="width:180px">
          ${ALL_SOCS_COMPRA.map(s => `<option value="${esc(s)}" ${s===_admProyCompania?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="admProyNueva()">+ Nueva Tienda</button>
      </div>
      ${_admProyTiendas.length ? `
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>Nombre</th><th>Moneda</th><th>IGV</th><th>RC</th><th>TIP</th>
            <th>Canales</th><th>Activa</th><th></th>
          </tr></thead>
          <tbody>
            ${_admProyTiendas.map(t => `<tr>
              <td>${esc(t.nombre)}</td>
              <td>${esc(t.moneda)}</td>
              <td>${pct(t.igvRate)}%</td>
              <td>${pct(t.rcRate)}%</td>
              <td>${pct(t.tipRate)}%</td>
              <td style="font-size:11px;line-height:1.6">${canalesHtml(t) || '<span class="text-muted">—</span>'}</td>
              <td>${t.activa ? '✅' : '❌'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-outline" style="margin-right:4px" onclick="admProyEditar('${t._id}')">✏️</button>
                <button class="btn btn-sm" style="color:#dc2626;border-color:#dc2626" onclick="admProyEliminar('${t._id}','${esc(t.nombre)}')">🗑</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p class="text-muted">No hay tiendas configuradas para esta sociedad.</p>'}`;

    document.getElementById('admpt-compania').addEventListener('change', e => {
      _admProyCompania = e.target.value; reload();
    });
  }

  function canalEditorHtml() {
    return `
      <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:8px" id="admpt-canales-tbl">
        <thead><tr style="color:var(--text-muted)">
          <th style="padding:4px 8px;text-align:center">Tipo</th>
          <th style="padding:4px 8px;text-align:center">Nombre</th>
          <th style="padding:4px 8px;text-align:center">%</th>
          <th style="padding:4px 8px;text-align:center">Com%</th>
          <th style="padding:4px 8px;text-align:center">IGV Com%</th>
          <th></th>
        </tr></thead>
        <tbody id="admpt-canales-body">
          ${_admProyCanales.map((c, i) => canalRowHtml(c, i)).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm btn-outline" onclick="admProyAddCanal('efectivo')">+ Efectivo</button>
        <button type="button" class="btn btn-sm btn-outline" onclick="admProyAddCanal('TC')">+ TC</button>
        <button type="button" class="btn btn-sm btn-outline" onclick="admProyAddCanal('delivery')">+ Delivery</button>
      </div>`;
  }

  function canalRowHtml(c, i) {
    const isEf = c.tipo === 'efectivo';
    return `<tr id="admpt-canal-${i}">
      <td style="padding:3px 8px;text-align:center">${esc(c.tipo)}</td>
      <td style="padding:3px 8px;text-align:center"><input type="text" value="${esc(c.nombre||'')}" placeholder="${isEf?'—':'Nombre'}" ${isEf?'disabled':''} style="width:90px;font-size:12px;text-align:center;border:1px solid var(--border);padding:2px 4px;border-radius:3px;background:var(--bg)" onchange="admProyCanalField(${i},'nombre',this.value)"></td>
      <td style="padding:3px 8px;text-align:center"><input type="number" value="${pct(c.pct)}" min="0" max="100" step="0.1" style="width:65px;font-size:12px;text-align:center;border:1px solid var(--border);padding:2px 4px;border-radius:3px;background:var(--bg)" onchange="admProyCanalField(${i},'pct',this.value/100)"></td>
      <td style="padding:3px 8px;text-align:center"><input type="number" value="${pct(c.comisionRate)}" min="0" max="100" step="0.01" ${isEf?'disabled':''} style="width:65px;font-size:12px;text-align:center;border:1px solid var(--border);padding:2px 4px;border-radius:3px;background:var(--bg)" onchange="admProyCanalField(${i},'comisionRate',this.value/100)"></td>
      <td style="padding:3px 8px;text-align:center"><input type="number" value="${pct(c.igvComisionRate)}" min="0" max="100" step="0.01" ${isEf?'disabled':''} style="width:65px;font-size:12px;text-align:center;border:1px solid var(--border);padding:2px 4px;border-radius:3px;background:var(--bg)" onchange="admProyCanalField(${i},'igvComisionRate',this.value/100)"></td>
      <td style="padding:3px 6px"><button type="button" class="btn btn-sm" style="color:#dc2626;border-color:#dc2626;padding:1px 6px" onclick="admProyRemoveCanal(${i})">✕</button></td>
    </tr>`;
  }

  async function admProyGuardar(tienda) {
    const nombre = document.getElementById('admpt-nombre').value.trim();
    if (!nombre) { toast('El nombre es obligatorio', 'warning'); return; }
    const payload = {
      compania: _admProyCompania,
      nombre,
      moneda:  document.getElementById('admpt-moneda').value,
      igvRate: Number(document.getElementById('admpt-igv').value) / 100,
      rcRate:  Number(document.getElementById('admpt-rc').value)  / 100,
      tipRate: Number(document.getElementById('admpt-tip').value) / 100,
      canales: _admProyCanales,
    };
    const activaEl = document.getElementById('admpt-activa');
    if (activaEl) payload.activa = activaEl.checked;
    try {
      if (tienda) await PUT(`/proyeccion/tiendas/${tienda._id}`, payload);
      else        await POST('/proyeccion/tiendas', payload);
      toast(tienda ? 'Tienda actualizada' : 'Tienda creada', 'success');
      document.getElementById('modal').classList.add('hidden');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  function openTiendaModal(tienda) {
    _admProyCanales = tienda ? JSON.parse(JSON.stringify(tienda.canales || [])) : [];
    const isEdit = !!tienda;
    const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px">Nombre *</label>
          <input id="admpt-nombre" class="form-control" value="${esc(tienda?.nombre||'')}" placeholder="Tienda Centro">
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px">Moneda</label>
          <select id="admpt-moneda" class="form-control">
            <option value="PEN" ${tienda?.moneda!=='USD'?'selected':''}>PEN (Soles)</option>
            <option value="USD" ${tienda?.moneda==='USD'?'selected':''}>USD (Dólares)</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px">Tasa IGV %</label>
          <input id="admpt-igv" type="number" class="form-control" value="${pct(tienda?.igvRate ?? 0.18)}" min="0" max="100" step="0.1">
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px">Tasa RC %</label>
          <input id="admpt-rc" type="number" class="form-control" value="${pct(tienda?.rcRate ?? 0.10)}" min="0" max="100" step="0.1">
        </div>
        <div>
          <label style="font-size:12px;display:block;margin-bottom:4px">Tasa TIP %</label>
          <input id="admpt-tip" type="number" class="form-control" value="${pct(tienda?.tipRate ?? 0.10)}" min="0" max="100" step="0.1">
        </div>
        ${isEdit ? `<div><label style="font-size:12px;display:block;margin-bottom:4px">Activa</label>
          <input type="checkbox" id="admpt-activa" ${tienda.activa!==false?'checked':''} style="width:18px;height:18px;margin-top:8px"></div>` : ''}
      </div>
      <label style="font-size:12px;display:block;margin-bottom:6px;font-weight:600">Canales de cobro</label>
      <div id="admpt-canales-wrap">${canalEditorHtml()}</div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn btn-primary" onclick="admProyGuardarModal(${isEdit ? `'${tienda._id}'` : 'null'})">
          ${isEdit ? 'Guardar cambios' : 'Crear tienda'}
        </button>
      </div>`;

    openModal(isEdit ? `Editar — ${esc(tienda.nombre)}` : 'Nueva Tienda', html, null, { medium: true });
  }

  window.admProyNueva  = () => openTiendaModal(null);
  window.admProyEditar = id => openTiendaModal(_admProyTiendas.find(t => t._id === id));
  window.admProyGuardarModal = id => admProyGuardar(id ? _admProyTiendas.find(t => t._id === id) : null);
  window.admProyEliminar = async (id, nombre) => {
    if (!confirm(`¿Eliminar la tienda "${nombre}" y todos sus supuestos?`)) return;
    try { await DEL(`/proyeccion/tiendas/${id}`); toast('Tienda eliminada', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  window.admProyAddCanal = tipo => {
    _admProyCanales.push({ tipo, nombre: tipo === 'TC' ? 'TC' : '', pct: 0, comisionRate: 0, igvComisionRate: tipo !== 'efectivo' ? 0.18 : 0 });
    document.getElementById('admpt-canales-wrap').innerHTML = canalEditorHtml();
  };
  window.admProyRemoveCanal = i => {
    _admProyCanales.splice(i, 1);
    document.getElementById('admpt-canales-wrap').innerHTML = canalEditorHtml();
  };
  window.admProyCanalField = (i, field, val) => { _admProyCanales[i][field] = field === 'nombre' ? val : Number(val); };

  reload();
}

// ─── View: Autorizaciones de Pago ──────────────────────────────────

let _ebcCompanias     = [];
let _ebcObligaciones  = [];
let _ebcCompaniaActual = '';

async function viewAutorizacionesPago(container) {
  const rolP = S.user.rolPago || (S.user.role === 'ADMIN' ? 'admin' : '');
  const rolO = S.user.rolObligaciones || '';
  const isAdmin  = S.user.role === 'ADMIN';
  const isProg   = isAdmin || rolP === 'programador' || rolP === 'admin';
  const canView  = isAdmin || !!rolO || !!rolP;

  if (!canView) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Sin acceso a esta sección</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">📋 Incluir Pagos</div>
    </div>
    <div class="page-body">

      <div class="card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label style="font-size:13px;font-weight:600">Empresa:</label>
          <select id="ebc-compania-sel" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;min-width:160px">
            <option value="">— Seleccionar —</option>
          </select>
          <button class="btn btn-outline btn-sm" id="ebc-refresh-btn">🔄 Actualizar</button>
        </div>
      </div>

      <div id="ebc-tabla-wrap"></div>
    </div>`;

  // Cargar mapa de compañías para el dropdown
  try {
    _ebcCompanias = await GET('/obligaciones-ebc/mapa-companias');
  } catch(e) { _ebcCompanias = []; }

  const sel = document.getElementById('ebc-compania-sel');
  const sociedades = S.user.sociedadesPago || [];
  const companiasFiltradas = (isAdmin || !sociedades.length)
    ? _ebcCompanias
    : _ebcCompanias.filter(c => sociedades.includes(c.compania));
  companiasFiltradas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.compania;
    opt.textContent = c.compania;
    sel.appendChild(opt);
  });

  if (_ebcCompaniaActual) sel.value = _ebcCompaniaActual;

  sel.addEventListener('change', () => {
    _ebcCompaniaActual = sel.value;
    ebcCargarTabla();
  });

  document.getElementById('ebc-refresh-btn').addEventListener('click', () => ebcCargarTabla());

  // Auto-cargar si ya hay compañía seleccionada
  if (_ebcCompaniaActual) ebcCargarTabla();
}

async function ebcCargarTabla() {
  const wrap = document.getElementById('ebc-tabla-wrap');
  if (!wrap) return;
  const compania = document.getElementById('ebc-compania-sel')?.value || '';
  if (!compania) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:32px;font-size:13px">Selecciona una empresa para ver sus obligaciones</div>`;
    return;
  }
  wrap.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:32px">Cargando...</div>`;
  try {
    _ebcObligaciones = await GET(`/obligaciones-ebc?compania=${encodeURIComponent(compania)}`);
    ebcRenderTabla();
  } catch(e) {
    wrap.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`;
  }
}

function ebcRenderTabla() {
  const wrap = document.getElementById('ebc-tabla-wrap');
  if (!wrap) return;
  const obs = _ebcObligaciones;

  if (!obs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin obligaciones AP/PP para esta empresa</p></div>`;
    return;
  }

  const fmtD = d => d ? new Date(d).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
  const fmtM = n => n == null ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  wrap.innerHTML = `
    <div class="card" style="overflow:hidden">
      <div style="padding:8px 14px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
        ${obs.length} obligaciones · ${obs.filter(o=>o.seleccionadoPor).length} autorizadas
      </div>
      <div style="overflow-x:auto;max-height:calc(100vh - 360px);overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="width:32px"></th>
            <th>Proveedor</th>
            <th>N° Doc</th>
            <th>Tipo</th>
            <th>Venc.</th>
            <th>Mon.</th>
            <th class="text-right">Monto</th>
            <th>Estado Doc</th>
            <th>Comentario</th>
            <th>Autorización</th>
          </tr></thead>
          <tbody>
            ${obs.map(o => {
              const seleccionado = !!o.seleccionadoPor;
              const estadoBadge = o.estadoDoc === 'AP'
                ? `<span style="font-size:10px;background:#dcfce7;color:#166534;border-radius:3px;padding:1px 5px;font-weight:600">AP</span>`
                : `<span style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-weight:600">PP</span>`;
              const authBadge = seleccionado
                ? `<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 5px;font-weight:600">✅ ${esc(o.seleccionadoPor)}</span>`
                : `<span style="font-size:10px;color:var(--text-muted)">Pendiente</span>`;
              return `<tr style="${seleccionado ? 'background:#f0fdf4;' : ''}">
                <td class="text-center">
                  <input type="checkbox" ${seleccionado ? 'checked' : ''}
                    style="width:14px;height:14px;accent-color:var(--primary);cursor:pointer"
                    onchange="ebcToggleObl('${o._id}', this.checked, this)">
                </td>
                <td style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="${esc(o.proveedor)}">${esc(o.proveedor)}</td>
                <td style="white-space:nowrap">${esc(o.numeroDocumento)}</td>
                <td><span class="badge badge-outline" style="font-size:10px">${esc(o.tipoDocumento)}</span></td>
                <td style="white-space:nowrap">${fmtD(o.fechaVencimiento)}</td>
                <td>${esc(o.moneda)}</td>
                <td class="text-right fw-semibold" style="${o.monto < 0 ? 'color:#ef4444' : ''}">${fmtM(o.monto)}</td>
                <td>${estadoBadge}</td>
                <td><input type="text" value="${esc(o.comentario||'')}" placeholder="Comentario…"
                      style="width:160px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:transparent"
                      onblur="ebcGuardarComentario('${o._id}', this.value)"></td>
                <td>${authBadge}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

window.ebcToggleObl = async function(id, checked, cbEl) {
  cbEl.disabled = true;
  try {
    const endpoint = checked ? `/obligaciones-ebc/${id}/seleccionar` : `/obligaciones-ebc/${id}/deseleccionar`;
    await PUT(endpoint, {});
    const ob = _ebcObligaciones.find(o => o._id === id);
    if (ob) {
      ob.seleccionadoPor = checked ? S.user.username : null;
      ob.pendienteNextProg = false;
    }
    toast(checked ? '✅ Obligación incluida' : 'Obligación desmarcada', checked ? 'success' : 'info');
    ebcRenderTabla();
  } catch(e) {
    toast(e.message, 'error');
    cbEl.checked = !checked;
    cbEl.disabled = false;
  }
};

window.ebcGuardarComentario = async function(id, comentario) {
  try {
    await PUT(`/obligaciones-ebc/${id}/comentario`, { comentario });
    const ob = _ebcObligaciones.find(o => o._id === id);
    if (ob) ob.comentario = comentario;
  } catch(e) {
    toast(e.message, 'error');
  }
};

// ─── PL — Estado de Resultados ───────────────────────────────────────────────

const PL_ESTRUCTURA = [
  { type:'header', label:'VENTA NETA' },
  { type:'item',   grupo:'VENTA NETA A&B' },
  { type:'item',   grupo:'VENTA NETA EVENTOS' },
  { type:'item',   grupo:'AUSPICIOS' },
  { type:'item',   grupo:'REDENCION PROMOCIONAL' },
  { type:'item',   grupo:'OTROS INGRESOS' },
  { type:'subtotal', key:'VENTA_NETA', label:'VENTA NETA',
    grupos:['VENTA NETA A&B','VENTA NETA EVENTOS','AUSPICIOS','REDENCION PROMOCIONAL','OTROS INGRESOS'] },

  { type:'item', grupo:'COSTO DE VENTA' },

  { type:'computed', key:'MARGEN', label:'MARGEN DE CONTRIBUCIÓN', bold:true,
    fn: t => (t['VENTA_NETA']||0) + (t['COSTO DE VENTA']||0) },

  { type:'header', label:'PLANILLA' },
  { type:'item', grupo:'SUELDOS' },
  { type:'item', grupo:'ASIGNACION FAMILIAR' },
  { type:'item', grupo:'FERIADOS' },
  { type:'item', grupo:'GRATIFICACIONES' },
  { type:'item', grupo:'CTS' },
  { type:'item', grupo:'ESSALUD' },
  { type:'item', grupo:'EPS' },
  { type:'item', grupo:'VACACIONES' },
  { type:'item', grupo:'ATENCION AL PERSONAL' },
  { type:'item', grupo:'BONIFICACIONES' },
  { type:'item', grupo:'CANASTAS Y BONOS' },
  { type:'item', grupo:'CAPACITACION' },
  { type:'item', grupo:'INDEMNIZACIONES' },
  { type:'item', grupo:'SEGURO DE VIDA' },
  { type:'subtotal', key:'PLANILLA', label:'TOTAL PLANILLA',
    grupos:['SUELDOS','ASIGNACION FAMILIAR','FERIADOS','GRATIFICACIONES','CTS','ESSALUD','EPS','VACACIONES','ATENCION AL PERSONAL','BONIFICACIONES','CANASTAS Y BONOS','CAPACITACION','INDEMNIZACIONES','SEGURO DE VIDA'] },

  { type:'header', label:'GASTOS DE OCUPACIÓN' },
  { type:'item', grupo:'ALQUILERES' },
  { type:'item', grupo:'ARBITRIOS' },
  { type:'item', grupo:'VALET PARKING' },
  { type:'item', grupo:'VIGILANCIA' },
  { type:'subtotal', key:'GASTOS_OCUPACION', label:'TOTAL GASTOS DE OCUPACIÓN',
    grupos:['ALQUILERES','ARBITRIOS','VALET PARKING','VIGILANCIA'] },

  { type:'header', label:'SSPP' },
  { type:'item', grupo:'ELECTRICIDAD' },
  { type:'item', grupo:'AGUA' },
  { type:'item', grupo:'GAS' },
  { type:'item', grupo:'INTERNET' },
  { type:'item', grupo:'TELEFONO' },
  { type:'subtotal', key:'SSPP', label:'TOTAL SSPP',
    grupos:['ELECTRICIDAD','AGUA','GAS','INTERNET','TELEFONO'] },

  { type:'header', label:'ASESORÍAS' },
  { type:'item', grupo:'ASESORIA ADMINISTRATIVA' },
  { type:'item', grupo:'ASESORIA CONTABLE' },
  { type:'item', grupo:'ASESORIA LEGAL' },
  { type:'subtotal', key:'ASESORIAS', label:'TOTAL ASESORÍAS',
    grupos:['ASESORIA ADMINISTRATIVA','ASESORIA CONTABLE','ASESORIA LEGAL'] },

  { type:'header', label:'COMISIÓN OPERADORAS' },
  { type:'item', grupo:'COMISION TARJETA DE CREDITO' },
  { type:'item', grupo:'COMISION DELIVERY' },
  { type:'subtotal', key:'COMISIONES_OP', label:'TOTAL COMISIÓN OPERADORAS',
    grupos:['COMISION TARJETA DE CREDITO','COMISION DELIVERY'] },

  { type:'header', label:'MANTENIMIENTO' },
  { type:'item', grupo:'MANTENIMIENTO' },
  { type:'item', grupo:'FUMIGACION' },
  { type:'item', grupo:'JARDINERIA' },
  { type:'subtotal', key:'MANTENIMIENTO', label:'TOTAL MANTENIMIENTO',
    grupos:['MANTENIMIENTO','FUMIGACION','JARDINERIA'] },

  { type:'header', label:'SERVICIOS DE TERCEROS' },
  { type:'item', grupo:'TRANSPORTE' },
  { type:'item', grupo:'PASAJES AEREOS' },
  { type:'item', grupo:'PUBLICIDAD' },
  { type:'item', grupo:'GESTION REDES SOCIALES' },
  { type:'item', grupo:'MOVILIDAD' },
  { type:'item', grupo:'ESTACIONAMIENTO Y PEAJES' },
  { type:'item', grupo:'OTROS ALQUILERES' },
  { type:'item', grupo:'LAVANDERIA' },
  { type:'item', grupo:'COMISIONES' },
  { type:'item', grupo:'I+D' },
  { type:'item', grupo:'HONORARIOS' },
  { type:'item', grupo:'ALQUILERES ARTICULOS DE RESTAURANTE' },
  { type:'item', grupo:'ALQUILERES OTROS' },
  { type:'item', grupo:'OTROS SERVICIOS DE TERCEROS' },
  { type:'subtotal', key:'SERV_TERCEROS', label:'TOTAL SERVICIOS DE TERCEROS',
    grupos:['TRANSPORTE','PASAJES AEREOS','PUBLICIDAD','GESTION REDES SOCIALES','MOVILIDAD','ESTACIONAMIENTO Y PEAJES','OTROS ALQUILERES','LAVANDERIA','COMISIONES','I+D','HONORARIOS','ALQUILERES ARTICULOS DE RESTAURANTE','ALQUILERES OTROS','OTROS SERVICIOS DE TERCEROS'] },

  { type:'header', label:'OTROS GASTOS' },
  { type:'item', grupo:'ECONOMATO' },
  { type:'item', grupo:'GASTOS BANCARIOS' },
  { type:'item', grupo:'GASTOS DE IMPRENTA' },
  { type:'item', grupo:'GASTOS DE LABORATORIO' },
  { type:'item', grupo:'GASTOS DE REPRESENTACION' },
  { type:'item', grupo:'GASTOS NOTARIALES' },
  { type:'item', grupo:'GASTOS REPARABLES' },
  { type:'item', grupo:'GASTOS VARIOS' },
  { type:'item', grupo:'IGV' },
  { type:'item', grupo:'ITF' },
  { type:'item', grupo:'MATERIALES DE LIMPIEZA' },
  { type:'item', grupo:'MEMBRESIAS' },
  { type:'item', grupo:'SANCIONES' },
  { type:'item', grupo:'SEGURO VEHICULAR' },
  { type:'item', grupo:'SEGUROS MULTIRIESGO' },
  { type:'item', grupo:'ACCESORIOS' },
  { type:'item', grupo:'SUMINISTROS PARA RESTAURANTE' },
  { type:'item', grupo:'ACTIVOS MENORES' },
  { type:'item', grupo:'COMBUSTIBLES' },
  { type:'item', grupo:'ARTICULOS DE FERRETERIA' },
  { type:'item', grupo:'SUSCRIPCIONES' },
  { type:'item', grupo:'TASAS Y DERECHOS' },
  { type:'item', grupo:'COSTO DE ENAJENACION' },
  { type:'item', grupo:'REDONDEOS' },
  { type:'item', grupo:'REGALIAS' },
  { type:'subtotal', key:'OTROS_GASTOS', label:'TOTAL OTROS GASTOS',
    grupos:['ECONOMATO','GASTOS BANCARIOS','GASTOS DE IMPRENTA','GASTOS DE LABORATORIO','GASTOS DE REPRESENTACION','GASTOS NOTARIALES','GASTOS REPARABLES','GASTOS VARIOS','IGV','ITF','MATERIALES DE LIMPIEZA','MEMBRESIAS','SANCIONES','SEGURO VEHICULAR','SEGUROS MULTIRIESGO','ACCESORIOS','SUMINISTROS PARA RESTAURANTE','ACTIVOS MENORES','COMBUSTIBLES','ARTICULOS DE FERRETERIA','SUSCRIPCIONES','TASAS Y DERECHOS','COSTO DE ENAJENACION','REDONDEOS','REGALIAS'] },

  { type:'computed', key:'EBITDA', label:'EBITDA', bold:true,
    fn: t => (t['MARGEN']||0) + (t['PLANILLA']||0) + (t['GASTOS_OCUPACION']||0) + (t['SSPP']||0) + (t['ASESORIAS']||0) + (t['COMISIONES_OP']||0) + (t['MANTENIMIENTO']||0) + (t['SERV_TERCEROS']||0) + (t['OTROS_GASTOS']||0) },

  { type:'header', label:'PROVISIONES' },
  { type:'item', grupo:'DEPRECIACION' },
  { type:'item', grupo:'MUEBLES Y ENSERES' },
  { type:'item', grupo:'AMORTIZACION' },
  { type:'subtotal', key:'PROVISIONES', label:'TOTAL PROVISIONES',
    grupos:['DEPRECIACION','MUEBLES Y ENSERES','AMORTIZACION'] },

  { type:'computed', key:'UTIL_OPERATIVA', label:'UTILIDAD OPERATIVA', bold:true,
    fn: t => (t['EBITDA']||0) + (t['PROVISIONES']||0) },

  { type:'header', label:'FINANCIEROS' },
  { type:'item', grupo:'INGRESOS FINANCIEROS' },
  { type:'item', grupo:'INTERESES' },
  { type:'item', grupo:'DIFERENCIA DE CAMBIO NETA' },
  { type:'subtotal', key:'FINANCIEROS', label:'TOTAL FINANCIEROS',
    grupos:['INGRESOS FINANCIEROS','INTERESES','DIFERENCIA DE CAMBIO NETA'] },

  { type:'computed', key:'UTIL_NETA', label:'UTILIDAD NETA', bold:true,
    fn: t => (t['UTIL_OPERATIVA']||0) + (t['FINANCIEROS']||0) },

  { type:'item', grupo:'PARTICIPACION DE LOS TRABAJADORES' },
  { type:'item', grupo:'IMPUESTO A LA RENTA' },

  { type:'computed', key:'UTIL_NETA_DI', label:'UTILIDAD NETA DESPUES DE IMPUESTOS', bold:true,
    fn: t => (t['UTIL_NETA']||0) + (t['PARTICIPACION DE LOS TRABAJADORES']||0) + (t['IMPUESTO A LA RENTA']||0) },
];

async function viewPL(container) {
  const isAdmin = S.user.role === 'ADMIN';
  // Usar el campo operations existente (mismas operaciones que el resto de la app)
  const opAuth = isAdmin ? [] : (S.user.operations || []);

  // Admin: cargar unidades desde la BD (puede estar vacía si aún no se importaron datos)
  let unidadesDisp = isAdmin ? [] : opAuth;
  if (isAdmin) {
    try { unidadesDisp = await GET('/eerr/unidades'); } catch {}
  }

  // Periodo defaults: año actual, enero → mes actual
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  const renderOpsSection = (lista) => {
    if (!lista.length) return `<div style="margin-top:12px;color:var(--text-muted);font-size:13px">${isAdmin ? '⚠️ Base de datos EERR vacía — ejecutar <code>node scripts/importEerr.js</code> en el servidor' : ''}</div>`;
    const mkChk = u => `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;border:1px solid var(--border);border-radius:6px;padding:4px 10px;background:var(--bg-card)">
              <input type="checkbox" name="pl-unidad" value="${esc(u)}" ${lista.includes(u)?'checked':''}
                style="width:13px;height:13px;accent-color:var(--primary)">
              ${esc(u)}</label>`;
    const row1 = ALL_OPS_ROW1.filter(u => lista.includes(u));
    const row2 = ALL_OPS_ROW2.filter(u => lista.includes(u));
    const extra = lista.filter(u => !ALL_OPS_ROW1.includes(u) && !ALL_OPS_ROW2.includes(u));
    return `<div style="margin-top:12px" id="pl-ops-wrap">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <label class="form-label" style="margin-bottom:0">Sedes</label>
          <button type="button" onclick="document.querySelectorAll('input[name=\\'pl-unidad\\']').forEach(c=>c.checked=false)"
            style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-page);color:var(--text-muted);cursor:pointer">Borrar selección</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${row1.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${row1.map(mkChk).join('')}</div>` : ''}
          ${row2.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${row2.map(mkChk).join('')}</div>` : ''}
          ${extra.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${extra.map(mkChk).join('')}</div>` : ''}
        </div>
      </div>`;
  };

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">📊 Estado de Resultados — PL</h1>
    </div>
    <div class="card mb-16" style="padding:16px">
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div>
            <label class="form-label">Año desde</label>
            <select id="pl-anio-desde" class="form-control" style="width:90px">
              ${[anioActual-4,anioActual-3,anioActual-2,anioActual-1,anioActual,anioActual+1].map(y=>`<option value="${y}"${y===anioActual?' selected':''}>${y}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Mes desde</label>
            <select id="pl-mes-desde" class="form-control" style="width:110px">
              ${['01 Ene','02 Feb','03 Mar','04 Abr','05 May','06 Jun','07 Jul','08 Ago','09 Set','10 Oct','11 Nov','12 Dic'].map((m,i)=>{const v=String(i+1).padStart(2,'0');return`<option value="${v}"${v==='01'?' selected':''}>${m}</option>`;}).join('')}
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div>
            <label class="form-label">Año hasta</label>
            <select id="pl-anio-hasta" class="form-control" style="width:90px">
              ${[anioActual-4,anioActual-3,anioActual-2,anioActual-1,anioActual,anioActual+1].map(y=>`<option value="${y}"${y===anioActual?' selected':''}>${y}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Mes hasta</label>
            <select id="pl-mes-hasta" class="form-control" style="width:110px">
              ${['01 Ene','02 Feb','03 Mar','04 Abr','05 May','06 Jun','07 Jul','08 Ago','09 Set','10 Oct','11 Nov','12 Dic'].map((m,i)=>{const v=String(i+1).padStart(2,'0');return`<option value="${v}"${v===String(mesActual).padStart(2,'0')?' selected':''}>${m}</option>`;}).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="form-label">Columnas</label>
          <select id="pl-cols" class="form-control" style="width:180px">
            <option value="operacion">Operaciones</option>
            <option value="anio">Años</option>
            <option value="mes">Meses (seriado)</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="plConsultar()">🔍 Consultar</button>
        <button class="btn btn-outline" id="pl-export-btn" style="display:none" onclick="plExportarExcel()">📥 Exportar a Excel</button>
      </div>
      ${renderOpsSection(unidadesDisp)}
    </div>
    <div id="pl-resultado"></div>`;

  // Admin: si BD estaba vacía al cargar, hacer un segundo intento después de renderizar
  // (por si el import acaba de terminar en background)
  if (isAdmin && !unidadesDisp.length) {
    setTimeout(async () => {
      try {
        const lista = await GET('/eerr/unidades');
        if (lista.length) {
          const existing = document.getElementById('pl-ops-wrap');
          const wrap = document.querySelector('.card.mb-16');
          if (existing) existing.outerHTML = renderOpsSection(lista);
          else if (wrap) wrap.insertAdjacentHTML('beforeend', renderOpsSection(lista));
        }
      } catch {}
    }, 3000);
  }

  window.plConsultar = async function() {
    const wrap = document.getElementById('pl-resultado');
    wrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Consultando...</div>';
    try {
      const anioDesde = document.getElementById('pl-anio-desde').value;
      const mesDesde  = document.getElementById('pl-mes-desde').value;
      const anioHasta = document.getElementById('pl-anio-hasta').value;
      const mesHasta  = document.getElementById('pl-mes-hasta').value;
      const periodoDesde = anioDesde + mesDesde;  // YYYYMM (6 dígitos)
      const periodoHasta = anioHasta + mesHasta;
      const cols = document.getElementById('pl-cols').value;
      const unidades = [...document.querySelectorAll('input[name="pl-unidad"]:checked')].map(c => c.value);
      // Admin sin unidades seleccionadas = consultar todas
      if (!isAdmin && !unidades.length) { toast('Selecciona al menos una operación', 'warning'); wrap.innerHTML=''; return; }

      const qs = new URLSearchParams({ periodoDesde, periodoHasta, cols });
      if (unidades.length) qs.set('unidades', unidades.join(','));
      const data = await GET(`/eerr/resumen?${qs}`);

      // Build lookup: grupo -> { col: amount }
      const lookup = {};
      data.datos.forEach(r => { lookup[r.grupo] = r; });

      // Raw total of ALL soles before sign flip (used for balance check)
      const rawTotal = data.datos.reduce((s, r) =>
        s + data.columnas.reduce((s2, col) => s2 + (r[col] || 0), 0), 0);

      // Raw total per column (for per-column balance check)
      const rawTotalByCol = {};
      data.columnas.forEach(col => {
        rawTotalByCol[col] = data.datos.reduce((s, r) => s + (r[col] || 0), 0);
      });

      // Flip sign for income items (stored negative in DB, display positive)
      PL_ESTRUCTURA.forEach(row => {
        if (row.type === 'item' && row.flipSign && lookup[row.grupo]) {
          data.columnas.forEach(col => {
            if (lookup[row.grupo][col] !== undefined) {
              lookup[row.grupo][col] = -lookup[row.grupo][col];
            }
          });
        }
      });

      // Compute totals per column using the structure
      function colVal(col, row) {
        if (row.type === 'item')     return lookup[row.grupo]?.[col] || 0;
        if (row.type === 'subtotal') return row.grupos.reduce((s, g) => s + (lookup[g]?.[col] || 0), 0);
        if (row.type === 'computed') {
          // Build temp totals object for this column
          const t = {};
          PL_ESTRUCTURA.forEach(r => {
            if (r.type === 'item')     t[r.grupo] = lookup[r.grupo]?.[col] || 0;
            if (r.type === 'subtotal') t[r.key]   = r.grupos.reduce((s, g) => s + (lookup[g]?.[col] || 0), 0);
          });
          // Resolve computed chain in order
          PL_ESTRUCTURA.forEach(r => {
            if (r.type === 'computed') t[r.key] = r.fn(t);
          });
          return t[row.key] || 0;
        }
        return null;
      }

      // Extra columns when multiple sedes selected in operacion mode
      const multiSede = cols === 'operacion' && data.columnas.length > 1;

      const MESES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
      const fmtCol = c => {
        if (cols === 'mes' && /^\d{6}$/.test(String(c))) {
          const s = String(c);
          const mIdx = parseInt(s.slice(4,6), 10) - 1;
          return `${MESES_ABR[mIdx] || s.slice(4,6)} ${s.slice(0,4)}`;
        }
        return String(c);
      };

      // Grand total column
      const totalCol = '__TOTAL__';
      const allCols = [...data.columnas, totalCol];

      const fmtN = v => {
        if (v === null || v === undefined) return '';
        const abs = Math.abs(v);
        const s = abs >= 1000 ? abs.toLocaleString('es-PE', {minimumFractionDigits:0, maximumFractionDigits:0})
                               : abs.toFixed(0);
        return v < 0 ? `(${s})` : s;
      };
      const fmtPct = (v, base) => (!base ? '' : ((v/base)*100).toFixed(1)+'%');

      // The last column of data is total; we compute separately
      const colsData = data.columnas;

      const headerCols = colsData.map(c => `<th style="text-align:right;padding:6px 10px;white-space:nowrap">${esc(String(c))}</th>`).join('')
        + `<th style="text-align:right;padding:6px 10px;font-weight:700">TOTAL</th>`;

      let rowsHtml = '';
      // Compute all values per row per col (including total)
      const cache = {};  // key -> { col: val }
      function getVal(row, col) {
        const ckey = (row.key || row.grupo || row.label) + '||' + col;
        if (cache[ckey] !== undefined) return cache[ckey];
        let v;
        if (row.type === 'item') {
          v = lookup[row.grupo]?.[col] || 0;
        } else if (row.type === 'subtotal') {
          v = row.grupos.reduce((s, g) => {
            const gkey = g + '||' + col;
            if (cache[gkey] !== undefined) return s + cache[gkey];
            const gv = lookup[g]?.[col] || 0;
            cache[gkey] = gv;
            return s + gv;
          }, 0);
        } else if (row.type === 'computed') {
          // Build t for this col
          const t = {};
          PL_ESTRUCTURA.forEach(r => {
            if (r.type === 'item')     t[r.grupo] = lookup[r.grupo]?.[col] || 0;
            if (r.type === 'subtotal') t[r.key]   = r.grupos.reduce((s, g) => s + (lookup[g]?.[col] || 0), 0);
          });
          PL_ESTRUCTURA.forEach(r => {
            if (r.type === 'computed') t[r.key] = r.fn(t);
          });
          v = t[row.key] || 0;
        } else { v = null; }
        cache[ckey] = v;
        return v;
      }

      // Compute total col
      function getTotal(row) {
        if (row.type === 'header') return null;
        return colsData.reduce((s, c) => s + (getVal(row, c) || 0), 0);
      }

      // Get VENTA_NETA total for % base
      const ventaNetaRow = PL_ESTRUCTURA.find(r => r.key === 'VENTA_NETA');
      function getVentaNeta(col) {
        if (!ventaNetaRow) return 0;
        return col === totalCol
          ? colsData.reduce((s, c) => s + (getVal(ventaNetaRow, c) || 0), 0)
          : getVal(ventaNetaRow, col);
      }

      // Summary view: only subtotals, computed, and standalone items (not in any subtotal)
      const gruposEnSubtotal = new Set(
        PL_ESTRUCTURA.filter(r => r.type === 'subtotal').flatMap(r => r.grupos)
      );
      const rowsToRender = PL_ESTRUCTURA.filter(r => {
        if (r.type === 'header') return false;
        if (r.type === 'item') return !gruposEnSubtotal.has(r.grupo);
        return true;
      }).filter(r => {
        // Subtotales y calculados siempre se muestran; items standalone solo si tienen datos,
        // salvo PARTICIPACION DE LOS TRABAJADORES e IMPUESTO A LA RENTA que siempre se muestran
        if (r.type !== 'item') return true;
        const alwaysShow = new Set(['PARTICIPACION DE LOS TRABAJADORES', 'IMPUESTO A LA RENTA']);
        if (alwaysShow.has(r.grupo || '')) return true;
        const total = colsData.reduce((s, c) => s + Math.abs(getVal(r, c) || 0), 0);
        return total !== 0;
      });

      const totalCols = allCols.length * 2 + 1 + (multiSede ? 2 : 0);

      // Rows that get green+bold highlight
      const keyRows = new Set(['VENTA_NETA','MARGEN','EBITDA','UTIL_OPERATIVA','UTIL_NETA','UTIL_NETA_DI']);
      const keyItems = new Set(['COSTO DE VENTA']); // standalone items also highlighted
      // Rows with font size +1
      const bigRows = new Set(['VENTA_NETA','EBITDA']);
      const bigItems = new Set(['COSTO DE VENTA']);

      const exportRows = [];

      rowsToRender.forEach(row => {
        const rawLabel = row.type === 'item' ? row.grupo : row.label;
        // Strip leading "TOTAL " from labels
        const label = rawLabel.replace(/^TOTAL\s+/i, '');

        const rowKey = row.key || row.grupo || '';
        const isKey = keyRows.has(rowKey) || keyItems.has(row.grupo || '');
        const isBig = bigRows.has(rowKey) || bigItems.has(row.grupo || '');

        // Only subtotals and standalone items are drillable (not computed)
        const isDrillable = row.type === 'item' || row.type === 'subtotal';
        const drillId = row.type === 'item'
          ? 'pl-drill-' + (row.grupo||'').replace(/[^A-Z0-9]/gi,'_')
          : 'pl-drill-' + rowKey;
        // For subtotals pass all grupos; for items pass single grupo
        const drillGrupos = row.type === 'subtotal'
          ? row.grupos.join(',')
          : (row.grupo || '');

        const bg = isKey ? '#bbf7d0' : 'var(--bg-hover)';
        const textColor = isKey ? 'color:#000' : '';
        const bgStyle = `background:${bg}`;
        const fsize = isBig ? '14px' : '13px';
        const psize = isBig ? '12px' : '11px';

        const dataOnClick = isDrillable
          ? `onclick="plDrilldown('${drillId}','${drillGrupos.replace(/'/g,"\\'")}',this)"` : '';

        let rowCells = colsData.map(col => {
          const v = getVal(row, col);
          const vn = getVentaNeta(col);
          const pct = fmtPct(v, vn);
          const numColor = v < 0 ? 'color:#dc2626' : '';
          return `<td style="text-align:right;padding:6px 8px;font-size:${fsize};min-width:90px;${bgStyle};${textColor};${numColor}">${fmtN(v)}</td>
                  <td style="text-align:right;padding:6px 6px;font-size:${psize};min-width:52px;${bgStyle};${isKey?textColor:'color:var(--text-muted)'}">${pct}</td>`;
        }).join('');
        const tot = getTotal(row);
        const totVN = getVentaNeta(totalCol);
        const totColor = tot < 0 ? 'color:#dc2626' : '';
        rowCells += `<td style="text-align:right;padding:6px 8px;font-size:${fsize};font-weight:700;min-width:90px;${bgStyle};${textColor};${totColor}">${fmtN(tot)}</td>`;
        if (multiSede) {
          const elim = 0;
          const neto = tot - elim;
          const netoColor = neto < 0 ? 'color:#dc2626' : '';
          rowCells += `<td style="text-align:right;padding:6px 8px;font-size:${fsize};min-width:90px;${bgStyle};${textColor}">${fmtN(elim)}</td>`;
          rowCells += `<td style="text-align:right;padding:6px 8px;font-size:${fsize};font-weight:700;min-width:90px;${bgStyle};${textColor};${netoColor}">${fmtN(neto)}</td>`;
        }

        rowsHtml += `<tr ${dataOnClick} style="${isDrillable?'cursor:pointer':''}">
          <td style="padding:6px 8px;font-weight:700;font-size:${fsize};white-space:nowrap;min-width:220px;max-width:280px;${bgStyle};${textColor}">${esc(label)}</td>
          ${rowCells}
        </tr>`;

        const exportRow = { concepto: label };
        colsData.forEach(col => { exportRow[fmtCol(col)] = getVal(row, col); });
        exportRow['TOTAL'] = tot;
        if (multiSede) { exportRow['ELIMINACION'] = 0; exportRow['TOTAL NETO'] = tot; }
        exportRows.push(exportRow);

        if (isDrillable) {
          rowsHtml += `<tr id="${drillId}" style="display:none"><td colspan="${totalCols}" style="padding:0 8px 8px 16px;background:var(--bg-page)"></td></tr>`;
        }
      });

      // Balance check por columna: rawTotalByCol debe coincidir con UTIL_NETA_DI calculado por columna
      const utilNetaDIRow = PL_ESTRUCTURA.find(r => r.key === 'UTIL_NETA_DI');
      if (utilNetaDIRow) {
        let allOk = true;
        const balCells = colsData.map(col => {
          const diff = (rawTotalByCol[col] || 0) - getVal(utilNetaDIRow, col);
          const ok = Math.abs(diff) < 1;
          if (!ok) allOk = false;
          const bgCell = ok ? '#16a34a' : '#dc2626';
          const title = ok ? 'Balance cuadra' : `Diferencia: ${fmtN(diff)}`;
          return `<td colspan="2" style="padding:6px 8px;text-align:center;color:#fff;background:${bgCell};font-weight:700" title="${esc(title)}">${ok ? '✓ OK' : '⚠ ERROR'}</td>`;
        }).join('');
        const diffTot = rawTotal - getTotal(utilNetaDIRow);
        const okTot = Math.abs(diffTot) < 1;
        const bgTot = okTot ? '#16a34a' : '#dc2626';
        const extraBalCells = multiSede
          ? `<td style="background:${bgTot};color:#fff"></td><td style="background:${bgTot};color:#fff"></td>`
          : '';
        rowsHtml += `<tr>
          <td style="padding:6px 8px;font-weight:700;font-size:13px;background:var(--bg-hover)">BALANCE</td>
          ${balCells}
          <td style="padding:6px 8px;text-align:center;color:#fff;background:${bgTot};font-weight:700" title="${esc(okTot?'Balance cuadra':'Diferencia: '+fmtN(diffTot))}">${okTot ? '✓ OK' : '⚠ ERROR'}</td>
          ${extraBalCells}
        </tr>`;
      }

      // Double-header for each column (value + %)
      const extraHeaders = multiSede
        ? `<th style="text-align:center;padding:6px 8px;border-left:1px solid var(--border);white-space:nowrap">ELIMINACIÓN</th>
           <th style="text-align:center;padding:6px 8px;border-left:1px solid var(--border);font-weight:700;white-space:nowrap">TOTAL NETO</th>`
        : '';
      const extraSubHeaders = multiSede
        ? `<th style="text-align:right;padding:2px 8px;border-left:1px solid var(--border)">S/</th>
           <th style="text-align:right;padding:2px 8px;border-left:1px solid var(--border)">S/</th>`
        : '';
      const headerHtml = `<thead style="position:sticky;top:0;z-index:10;background:var(--bg-card)">
        <tr>
          <th style="text-align:left;padding:6px 8px;min-width:220px;max-width:220px;white-space:nowrap">Concepto</th>
          ${colsData.map(c => `<th colspan="2" style="text-align:center;padding:6px 8px;white-space:nowrap;border-left:1px solid var(--border)">${esc(fmtCol(c))}</th>`).join('')}
          <th style="text-align:center;padding:6px 8px;border-left:1px solid var(--border);font-weight:700">TOTAL</th>
          ${extraHeaders}
        </tr>
        <tr style="font-size:11px;color:var(--text-muted)">
          <th></th>
          ${colsData.map(() => `<th style="text-align:right;padding:2px 8px;border-left:1px solid var(--border)">S/</th><th style="text-align:right;padding:2px 6px">%</th>`).join('')}
          <th style="text-align:right;padding:2px 8px;border-left:1px solid var(--border)">S/</th>
          ${extraSubHeaders}
        </tr>
      </thead>`;

      wrap.innerHTML = `
        <div style="overflow-x:auto;overflow-y:auto;max-height:calc(100vh - 340px)">
          <table style="width:auto;border-collapse:collapse;font-size:13px;table-layout:auto">
            ${headerHtml}
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;

      // Store context for drill-down (lookup needed for level-2 item expansion)
      window._plContext = { periodoDesde, periodoHasta, cols, unidades, lookup, colsData, multiSede, exportRows };

      const exportBtn = document.getElementById('pl-export-btn');
      if (exportBtn) exportBtn.style.display = '';

    } catch(e) { wrap.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`; }
  };

  window.plExportarExcel = function() {
    const { exportRows } = window._plContext || {};
    if (!exportRows || !exportRows.length) { toast('No hay datos para exportar', 'warning'); return; }
    const headers = Object.keys(exportRows[0]);
    const escCsv = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    };
    const lines = [headers.map(escCsv).join(';')];
    exportRows.forEach(r => {
      lines.push(headers.map(h => escCsv(typeof r[h] === 'number' ? r[h].toFixed(2) : r[h])).join(';'));
    });
    const csv = '﻿' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PL_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const _plFmtN = v => {
    if (v === null || v === undefined || v === 0) return '';
    const abs = Math.abs(v);
    const s = abs >= 1000 ? abs.toLocaleString('es-PE',{minimumFractionDigits:0,maximumFractionDigits:0}) : abs.toFixed(0);
    return v < 0 ? `(${s})` : s;
  };

  // Render a persona table into a container element (shared by level-1 items and level-2 items)
  async function _plRenderPersonas(container, grupo) {
    const { periodoDesde, periodoHasta, cols, unidades } = window._plContext || {};
    container.innerHTML = '<div style="padding:6px;color:var(--text-muted);font-size:12px">⏳ Cargando...</div>';
    try {
      const qs = new URLSearchParams({ grupo, periodoDesde, periodoHasta, cols, unidades: (unidades||[]).join(',') });
      const data = await GET(`/eerr/detalle?${qs}`);
      if (!data.datos.length) { container.innerHTML = '<div style="padding:6px 8px;color:var(--text-muted);font-size:12px">Sin detalle</div>'; return; }
      const colsD = data.columnas;
      container.innerHTML = `<table style="width:auto;border-collapse:collapse;font-size:12px;margin:2px 0 6px 0">
        <thead><tr style="background:var(--bg-page)">
          <th style="text-align:left;padding:3px 10px 3px 20px;color:var(--text-muted);white-space:nowrap;min-width:200px">Proveedor / Persona</th>
          ${colsD.map(c=>`<th style="text-align:right;padding:3px 8px;color:var(--text-muted);min-width:80px">${esc(String(c))}</th>`).join('')}
          <th style="text-align:right;padding:3px 8px;color:var(--text-muted);font-weight:700;min-width:80px">TOTAL</th>
        </tr></thead>
        <tbody>${data.datos.slice(0,100).map(r => {
          const tot = colsD.reduce((s,c)=>s+(r[c]||0),0);
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:3px 10px 3px 20px;white-space:nowrap">${esc(r.persona||'(sin proveedor)')}</td>
            ${colsD.map(c=>`<td style="text-align:right;padding:3px 8px">${_plFmtN(r[c])}</td>`).join('')}
            <td style="text-align:right;padding:3px 8px;font-weight:600">${_plFmtN(tot)}</td>
          </tr>`;
        }).join('')}
        ${data.datos.length>100?`<tr><td colspan="${colsD.length+2}" style="padding:3px 16px;color:var(--text-muted);font-style:italic;font-size:11px">... y ${data.datos.length-100} más</td></tr>`:''}
        </tbody></table>`;
    } catch(e) { container.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`; }
  }

  // Level 2→3: persona breakdown from a level-2 item row (called via onclick in innerHTML)
  window.plDrilldownPersona = function(rowId, grupo, rowEl) {
    const detailRow = document.getElementById(rowId);
    if (!detailRow) return;
    if (detailRow.style.display !== 'none') { detailRow.style.display = 'none'; return; }
    detailRow.style.display = '';
    _plRenderPersonas(detailRow.querySelector('td'), grupo);
  };

  // Level 1→2 (subtotal) or Level 1→3 (standalone item)
  window.plDrilldown = function(rowId, gruposStr, rowEl) {
    const detailRow = document.getElementById(rowId);
    if (!detailRow) return;
    const tbody = detailRow.parentElement;

    // Toggle if already expanded: remove child rows
    const existing = tbody.querySelectorAll(`tr[data-drill-parent="${rowId}"]`);
    if (existing.length) {
      existing.forEach(r => r.remove());
      detailRow.style.display = 'none';
      return;
    }

    const { lookup, colsData, multiSede: ms } = window._plContext || {};
    const grupos = gruposStr.split(',').map(g => g.trim()).filter(Boolean);
    const cd = colsData || [];

    if (grupos.length === 1) {
      // Standalone item → persona level directly in placeholder row
      if (detailRow.style.display !== 'none') { detailRow.style.display = 'none'; return; }
      detailRow.style.display = '';
      _plRenderPersonas(detailRow.querySelector('td'), grupos[0]);
      return;
    }

    // Subtotal → inject real <tr> rows into parent <tbody> for perfect column alignment
    const colSpan = 1 + cd.length * 2 + 1 + (ms ? 2 : 0);
    const border = 'border-bottom:1px solid var(--border)';
    let insertAfter = detailRow;

    grupos.forEach(grupo => {
      const absTotal = cd.reduce((s,c) => s + Math.abs(lookup?.[grupo]?.[c]||0), 0);
      if (absTotal === 0) return; // no mostrar grupos sin datos

      const drillId2 = 'pl-d2-' + rowId + '_' + grupo.replace(/[^A-Z0-9]/gi,'_');
      const valCells = cd.map(col => {
        const v = lookup?.[grupo]?.[col] || 0;
        return `<td style="text-align:right;padding:5px 8px;font-size:12px;min-width:90px;${border}">${_plFmtN(v)}</td>
                <td style="min-width:52px;${border}"></td>`;
      }).join('');
      const tot = cd.reduce((s,c)=>s+(lookup?.[grupo]?.[c]||0),0);
      const extraCells = ms
        ? `<td style="min-width:90px;${border}"></td><td style="min-width:90px;${border}"></td>`
        : '';

      const itemRow = document.createElement('tr');
      itemRow.setAttribute('data-drill-parent', rowId);
      itemRow.style.cursor = 'pointer';
      itemRow.innerHTML = `
        <td style="padding:5px 8px 5px 32px;white-space:nowrap;font-size:12px;min-width:220px;${border}">${esc(grupo)}</td>
        ${valCells}
        <td style="text-align:right;padding:5px 8px;font-size:12px;font-weight:600;min-width:90px;${border}">${_plFmtN(tot)}</td>
        ${extraCells}
      `;
      itemRow.addEventListener('click', () => plDrilldownPersona(drillId2, grupo, itemRow));

      const personaRow = document.createElement('tr');
      personaRow.id = drillId2;
      personaRow.setAttribute('data-drill-parent', rowId);
      personaRow.style.display = 'none';
      personaRow.innerHTML = `<td colspan="${colSpan}" style="padding:0 0 4px 32px;background:var(--bg-page)"></td>`;

      insertAfter.after(itemRow);
      itemRow.after(personaRow);
      insertAfter = personaRow;
    });
  };
}

async function viewConciliacion(container) {
  const isAdmin = S.user.role === 'ADMIN';
  let sociedades = [];
  try { sociedades = await GET('/conciliacion/sociedades'); } catch (e) { /* sin config aun */ }

  const hoy = new Date();
  const hace30 = new Date(hoy.getTime() - 30 * 86400000);
  const iso = d => d.toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">🏦 Conciliación de Cobranzas</h1>
    </div>
    <div class="card mb-16" style="padding:16px">
      ${!sociedades.length ? `<div class="text-muted" style="margin-bottom:12px">
          ${isAdmin ? '⚠️ No hay sociedades configuradas — ir a Admin → Conciliación de Cobranzas para definir las rutas de archivos.' : '⚠️ No tiene sociedades autorizadas para conciliación.'}
        </div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
        <div>
          <label class="form-label">Sociedad</label>
          <select id="cc-sociedad" class="form-control" style="width:160px">
            ${sociedades.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Fecha desde</label>
          <input type="date" id="cc-desde" class="form-control" value="${iso(hace30)}">
        </div>
        <div>
          <label class="form-label">Fecha hasta</label>
          <input type="date" id="cc-hasta" class="form-control" value="${iso(hoy)}">
        </div>
        <button class="btn btn-primary" onclick="ccConsultar()" ${!sociedades.length ? 'disabled' : ''}>🔍 Consultar</button>
      </div>
    </div>
    <div id="cc-resultado"></div>`;

  window.ccConsultar = async function() {
    const wrap = document.getElementById('cc-resultado');
    wrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Consultando...</div>';
    try {
      const sociedad = document.getElementById('cc-sociedad').value;
      const fechaDesde = document.getElementById('cc-desde').value;
      const fechaHasta = document.getElementById('cc-hasta').value;
      const qs = new URLSearchParams({ sociedad, fechaDesde, fechaHasta });

      const [c1, c2, c3] = await Promise.all([
        GET(`/conciliacion/check1?${qs}`),
        GET(`/conciliacion/check2?${qs}`),
        GET(`/conciliacion/check3?${qs}`),
      ]);

      const fmt = v => (v === null || v === undefined) ? '' :
        Math.abs(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtSigned = v => (v === null || v === undefined) ? '' :
        (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const tdSigned = v => `<td style="${cw};text-align:right;${v < 0 ? 'color:#dc2626' : ''}">${fmtSigned(v)}</td>`;
      const badge = ok => ok
        ? `<span style="color:#16a34a;font-weight:700">✓</span>`
        : `<span style="color:#dc2626;font-weight:700">⚠</span>`;

      // ── Sección 1: ERP Efectivo vs CAJA ──
      const cw = 'padding:4px 6px;font-size:11px;width:70px'; // columna angosta

      // Agrupa días contiguos con diferencia (separados por un día "ok") y suma el bloque.
      // Si la suma del bloque da ~0, es un desfase de días (no un error real).
      function agruparContiguos(dias, difField, okField) {
        const grupos = new Array(dias.length).fill(null);
        let i = 0;
        while (i < dias.length) {
          if (dias[i][okField]) { grupos[i] = { rowspan: 1, sum: 0, ok: true, dias: 1 }; i++; continue; }
          let j = i, sum = 0;
          while (j < dias.length && !dias[j][okField]) { sum += dias[j][difField]; j++; }
          grupos[i] = { rowspan: j - i, sum, ok: Math.abs(sum) < 1, dias: j - i };
          for (let k = i + 1; k < j; k++) grupos[k] = 'skip';
          i = j;
        }
        return grupos;
      }
      const gruposSol = agruparContiguos(c1.dias, 'difSol', 'okSol');
      const gruposUsd = agruparContiguos(c1.dias, 'difUsd', 'okUsd');
      const tdGrupo = g => {
        if (g === 'skip') return '';
        if (g.dias === 1) return `<td rowspan="1" style="padding:4px 4px;text-align:center;width:26px">—</td>`;
        const color = g.ok ? '#16a34a' : '#dc2626';
        return `<td rowspan="${g.rowspan}" style="padding:4px 6px;text-align:center;font-size:11px;font-weight:700;color:${color};background:var(--bg-secondary);vertical-align:middle"
                    title="${g.dias} días contiguos, suma=${g.sum.toFixed(2)}">${g.ok ? '✓' : fmtSigned(g.sum)}</td>`;
      };

      const s1rows = c1.dias.map((d, idx) => `
        <tr style="${(!d.okSol || !d.okUsd) ? 'background:#fef2f2' : ''}">
          <td style="padding:4px 8px;font-size:11px;white-space:nowrap">${esc(d.fecha)}</td>
          <td style="${cw};text-align:right">${fmt(d.cajaSol)}</td>
          <td style="${cw};text-align:right">${fmt(d.erpSol)}</td>
          ${tdSigned(d.difSol)}
          <td style="padding:4px 4px;text-align:center;width:22px">${badge(d.okSol)}</td>
          ${tdGrupo(gruposSol[idx])}
          <td style="${cw};text-align:right;border-left:1px solid var(--border)">${fmt(d.cajaUsd)}</td>
          <td style="${cw};text-align:right">${fmt(d.erpUsd)}</td>
          <td style="${cw};text-align:right">${d.vueltoUsd ? fmt(d.vueltoUsd) : ''}</td>
          ${tdSigned(d.difUsd)}
          <td style="padding:4px 4px;text-align:center;width:22px">${badge(d.okUsd)}</td>
          ${tdGrupo(gruposUsd[idx])}
        </tr>`).join('');
      const s1errores = c1.dias.filter(d => !d.okSol || !d.okUsd).length;

      // ── Sección 2: Depósito vs suma de días ──
      function tablaDep2(arr) {
        if (!arr.length) return '<p class="text-muted" style="padding:8px 14px;font-size:12px">Sin depósitos en el rango.</p>';
        return `<table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f8fafc;color:var(--text-muted)">
            <th style="padding:5px 10px;text-align:left;font-size:11px">Fecha Depósito</th>
            <th style="padding:5px 10px;text-align:right;font-size:11px">Monto</th>
            <th style="padding:5px 10px;text-align:left;font-size:11px">Días incluidos</th>
            <th style="padding:5px 10px;text-align:right;font-size:11px">Suma Días</th>
            <th style="padding:5px 10px;text-align:center;font-size:11px">Estado</th>
          </tr></thead>
          <tbody>${arr.map(d => `
            <tr style="${!d.ok ? 'background:#fef2f2' : ''}">
              <td style="padding:5px 10px;font-size:12px">${esc(d.fecha)}</td>
              <td style="padding:5px 10px;text-align:right;font-size:12px">${fmt(d.deposito)}</td>
              <td style="padding:5px 10px;font-size:11px;color:var(--text-muted)">${d.dias ? d.dias.join(', ') : '—'}</td>
              <td style="padding:5px 10px;text-align:right;font-size:12px">${d.sumaDias!=null ? fmt(d.sumaDias) : '—'}</td>
              <td style="padding:5px 10px;text-align:center">${badge(d.ok)}</td>
            </tr>`).join('')}
          </tbody></table>`;
      }
      const s2errores = c2.pen.filter(d=>!d.ok).length + c2.usd.filter(d=>!d.ok).length;

      // ── Sección 3: Depósito vs Banco (EECC) ──
      function tablaDep3(arr) {
        if (!arr.length) return '<p class="text-muted" style="padding:8px 14px;font-size:12px">Sin depósitos en el rango.</p>';
        return `<table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f8fafc;color:var(--text-muted)">
            <th style="padding:5px 10px;text-align:left;font-size:11px">Fecha Depósito</th>
            <th style="padding:5px 10px;text-align:right;font-size:11px">Monto</th>
            <th style="padding:5px 10px;text-align:left;font-size:11px">Banco</th>
            <th style="padding:5px 10px;text-align:left;font-size:11px">Fecha Banco</th>
            <th style="padding:5px 10px;text-align:right;font-size:11px">Importe Banco</th>
            <th style="padding:5px 10px;text-align:center;font-size:11px">Estado</th>
          </tr></thead>
          <tbody>${arr.map(d => `
            <tr style="${!d.okBanco ? 'background:#fef2f2' : ''}">
              <td style="padding:5px 10px;font-size:12px">${esc(d.fecha)}</td>
              <td style="padding:5px 10px;text-align:right;font-size:12px">${fmt(d.deposito)}</td>
              <td style="padding:5px 10px;font-size:12px">${d.banco ? esc(d.banco.banco) : '—'}</td>
              <td style="padding:5px 10px;font-size:12px">${d.banco ? esc(d.banco.fecha) : '—'}</td>
              <td style="padding:5px 10px;text-align:right;font-size:12px">${d.banco ? fmt(d.banco.importe) : '—'}</td>
              <td style="padding:5px 10px;text-align:center">${badge(d.okBanco)}</td>
            </tr>`).join('')}
          </tbody></table>`;
      }
      const s3errores = c3.pen.filter(d=>!d.okBanco).length + c3.usd.filter(d=>!d.okBanco).length;

      wrap.innerHTML = `
        <div class="card mb-16" style="padding:0;overflow:hidden">
          <div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
            <strong style="font-size:13px">1️⃣ Cobranza Efectivo — COBRANZA ERP vs CAJA</strong>
            <span style="font-size:11px;color:${s1errores?'#dc2626':'#16a34a'}">${s1errores ? `⚠ ${s1errores} día(s) con diferencia` : '✓ Todo cuadra'}</span>
          </div>
          <div style="overflow-x:auto;max-height:360px;overflow-y:auto">
            <table style="width:auto;border-collapse:collapse">
              <thead style="position:sticky;top:0;background:var(--bg-card)"><tr style="color:var(--text-muted)">
                <th style="padding:4px 8px;text-align:left;font-size:11px">Fecha</th>
                <th colspan="5" style="padding:4px 6px;text-align:center;font-size:11px">Soles</th>
                <th colspan="6" style="padding:4px 6px;text-align:center;font-size:11px;border-left:1px solid var(--border)">Dólares</th>
              </tr>
              <tr style="color:var(--text-muted);font-size:10px">
                <th></th>
                <th style="padding:2px 6px;text-align:right">CAJA</th><th style="padding:2px 6px;text-align:right">ERP</th>
                <th style="padding:2px 6px;text-align:right">Dif.</th><th></th><th title="Suma de días contiguos con diferencia">Grupo</th>
                <th style="padding:2px 6px;text-align:right;border-left:1px solid var(--border)">CAJA</th><th style="padding:2px 6px;text-align:right">ERP</th>
                <th style="padding:2px 6px;text-align:right">Vuelto</th>
                <th style="padding:2px 6px;text-align:right">Dif.</th><th></th><th title="Suma de días contiguos con diferencia">Grupo</th>
              </tr></thead>
              <tbody>${s1rows || '<tr><td colspan="12" class="text-muted text-center" style="padding:16px">Sin datos en el rango</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <div class="card mb-16" style="padding:0;overflow:hidden">
          <div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
            <strong style="font-size:13px">2️⃣ Depósito CAJA vs Suma de Días (Efectivo + Tip − Vuelto)</strong>
            <span style="font-size:11px;color:${s2errores?'#dc2626':'#16a34a'}">${s2errores ? `⚠ ${s2errores} depósito(s) sin cuadrar` : '✓ Todo cuadra'}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
            <div style="border-right:1px solid var(--border)">
              <div style="padding:6px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">SOLES (DEPOSITO PEN)</div>
              ${tablaDep2(c2.pen)}
            </div>
            <div>
              <div style="padding:6px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">DÓLARES (DEPOSITO USD)</div>
              ${tablaDep2(c2.usd)}
            </div>
          </div>
        </div>

        <div class="card mb-16" style="padding:0;overflow:hidden">
          <div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
            <strong style="font-size:13px">3️⃣ Depósito CAJA vs Movimiento Bancario (EECC)</strong>
            <span style="font-size:11px;color:${s3errores?'#dc2626':'#16a34a'}">${s3errores ? `⚠ ${s3errores} depósito(s) sin ubicar en banco` : '✓ Todo cuadra'}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
            <div style="border-right:1px solid var(--border)">
              <div style="padding:6px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">SOLES</div>
              ${tablaDep3(c3.pen)}
            </div>
            <div>
              <div style="padding:6px 10px;font-size:11px;font-weight:700;color:var(--text-muted)">DÓLARES</div>
              ${tablaDep3(c3.usd)}
            </div>
          </div>
        </div>`;
    } catch (e) { wrap.innerHTML = `<div class="msg-error">${esc(e.message)}</div>`; }
  };

  if (sociedades.length) window.ccConsultar();
}

async function viewAdmin(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">⚙️ Administración</div>
      <button class="btn btn-outline btn-sm" onclick="showHelp('admin')">❓ Ayuda</button>
    </div>
    <div class="page-body">
      <div class="tabs">
        <button class="tab-btn active" data-tab="usuarios">👥 Usuarios</button>
        <button class="tab-btn" data-tab="items">📦 Maestro Items</button>
        <button class="tab-btn" data-tab="archivos">📁 Archivos Excel</button>
        <button class="tab-btn" data-tab="pedidos-admin">📋 Todos los Pedidos</button>
        <button class="tab-btn" data-tab="database">🗄️ Base de Datos</button>
        <button class="tab-btn" data-tab="config">⚙️ Configuración</button>
        <button class="tab-btn" data-tab="grupos-pago">💳 Grupos de Pago</button>
        <button class="tab-btn" data-tab="bancos-pago">🏦 Bancos</button>
        <button class="tab-btn" data-tab="personas">👤 Personas</button>
        <button class="tab-btn" data-tab="cc-correo">📧 CC Correo</button>
        <button class="tab-btn" data-tab="flujo-caja">💵 Flujo de Caja</button>
        <button class="tab-btn" data-tab="cierre-caja">🧾 Cierre de Caja</button>
        <button class="tab-btn" data-tab="ebc-companias">🏢 Mapeo Empresas EBC</button>
        <button class="tab-btn" data-tab="proy-tiendas">🏪 Tiendas Proy.</button>
        <button class="tab-btn" data-tab="conciliacion">🏦 Conciliación Cobranzas</button>
      </div>
      <div id="tab-usuarios" class="tab-panel active"></div>
      <div id="tab-items" class="tab-panel"></div>
      <div id="tab-archivos" class="tab-panel"></div>
      <div id="tab-pedidos-admin" class="tab-panel"></div>
      <div id="tab-database" class="tab-panel"></div>
      <div id="tab-config" class="tab-panel"></div>
      <div id="tab-grupos-pago" class="tab-panel"></div>
      <div id="tab-bancos-pago" class="tab-panel"></div>
      <div id="tab-personas" class="tab-panel"></div>
      <div id="tab-cc-correo" class="tab-panel"></div>
      <div id="tab-flujo-caja" class="tab-panel"></div>
      <div id="tab-cierre-caja" class="tab-panel"></div>
      <div id="tab-ebc-companias" class="tab-panel"></div>
      <div id="tab-proy-tiendas" class="tab-panel"></div>
      <div id="tab-conciliacion" class="tab-panel"></div>
    </div>`;

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  renderAdminUsuarios(document.getElementById('tab-usuarios'));
  renderAdminItems(document.getElementById('tab-items'));
  renderAdminArchivos(document.getElementById('tab-archivos'));
  renderAdminPedidos(document.getElementById('tab-pedidos-admin'));
  renderAdminDatabase(document.getElementById('tab-database'));
  renderAdminConfig(document.getElementById('tab-config'));
  renderAdminGruposPago(document.getElementById('tab-grupos-pago'));
  renderAdminBancos(document.getElementById('tab-bancos-pago'));
  renderAdminPersonas(document.getElementById('tab-personas'));
  renderAdminCCCorreo(document.getElementById('tab-cc-correo'));
  renderAdminFlujoCaja(document.getElementById('tab-flujo-caja'));
  renderAdminCierreCaja(document.getElementById('tab-cierre-caja'));
  renderAdminEBCCompanias(document.getElementById('tab-ebc-companias'));
  renderAdminProyTiendas(document.getElementById('tab-proy-tiendas'));
  renderAdminConciliacion(document.getElementById('tab-conciliacion'));
}

// ─── Admin: Conciliación de Cobranzas — rutas de archivos por sociedad ──
async function renderAdminConciliacion(container) {
  container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  let configs = [];
  try { configs = await GET('/conciliacion/config'); } catch (err) { container.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }

  const bySoc = {};
  configs.forEach(c => { bySoc[c.sociedad] = c; });

  container.innerHTML = `
    <p class="mb-8 text-muted" style="font-size:13px">
      Define, para cada sociedad, la ruta local de los archivos usados en la conciliación de cobranzas.
      El EECC de Bancos incluye todas las hojas por banco y moneda; el archivo de Cobranza incluye las
      hojas "COBRANZA ERP" y "CAJA"; el reporte de TC se usará más adelante para conciliar tarjetas.
    </p>
    <div class="card" style="overflow:hidden">
      <table class="data-table" style="font-size:13px">
        <thead><tr><th style="width:100px">Sociedad</th><th>Ruta EECC Bancos</th><th>Ruta Cobranza</th><th>Ruta Reporte TC</th></tr></thead>
        <tbody>
          ${ALL_SOCS_COMPRA.map(s => {
            const c = bySoc[s] || {};
            return `<tr>
              <td style="font-weight:600">${esc(s)}</td>
              <td><input type="text" class="form-control acc-eecc" data-soc="${esc(s)}" value="${esc(c.rutaEECC||'')}" placeholder="C:\\...\\Q EECC BANCOS.xlsx"></td>
              <td><input type="text" class="form-control acc-cobranza" data-soc="${esc(s)}" value="${esc(c.rutaCobranza||'')}" placeholder="C:\\...\\Q COBRANZA.xlsx"></td>
              <td><input type="text" class="form-control acc-tc" data-soc="${esc(s)}" value="${esc(c.rutaTC||'')}" placeholder="C:\\...\\Q TC.xlsx"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  async function guardar(soc, body) {
    try {
      await PUT(`/conciliacion/config/${encodeURIComponent(soc)}`, body);
      toast(`Configuración de ${soc} actualizada`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
  container.querySelectorAll('.acc-eecc').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.soc, { rutaEECC: el.value.trim() }));
  });
  container.querySelectorAll('.acc-cobranza').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.soc, { rutaCobranza: el.value.trim() }));
  });
  container.querySelectorAll('.acc-tc').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.soc, { rutaTC: el.value.trim() }));
  });
}

// ─── Admin: Configuración de Cierre de Caja por operación ─────────
async function renderAdminCierreCaja(container) {
  container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  let configs = [];
  try { configs = await GET('/caja/config'); } catch (err) { container.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }

  container.innerHTML = `
    <p class="mb-8 text-muted" style="font-size:13px">
      Define por operación si es un negocio tipo Restaurante (mesas/mozos) o Mostrador, si el efectivo
      pasa por una oficina antes de depositarse en el banco, o se deposita directamente desde caja, y los
      turnos disponibles para abrir caja (separados por coma). En un mismo día se pueden abrir varias cajas,
      una por turno, pero nunca simultáneas: la siguiente solo se habilita cuando la anterior queda cerrada.
    </p>
    <div class="card" style="overflow:hidden">
      <table class="data-table" style="font-size:13px">
        <thead><tr><th>Operación</th><th style="width:180px">Tipo de Negocio</th><th style="width:120px">Tiene Oficina</th><th style="width:260px">Turnos</th></tr></thead>
        <tbody>
          ${configs.map(c => `<tr>
            <td style="font-weight:600">${esc(c.operacion)}</td>
            <td>
              <select class="form-control cac-tipo" data-op="${esc(c.operacion)}" style="width:160px">
                <option value="MOSTRADOR" ${c.tipoNegocio === 'MOSTRADOR' ? 'selected' : ''}>Mostrador</option>
                <option value="RESTAURANTE" ${c.tipoNegocio === 'RESTAURANTE' ? 'selected' : ''}>Restaurante</option>
              </select>
            </td>
            <td style="text-align:center">
              <input type="checkbox" class="cac-oficina" data-op="${esc(c.operacion)}" ${c.tieneOficina ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary)">
            </td>
            <td>
              <input type="text" class="form-control cac-turnos" data-op="${esc(c.operacion)}" value="${esc((c.turnos || ['Único']).join(', '))}" style="width:240px" placeholder="Mañana, Tarde, Noche">
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  async function guardar(op, body) {
    try {
      await PUT(`/caja/config/${encodeURIComponent(op)}`, body);
      toast(`Configuración de ${op} actualizada`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
  container.querySelectorAll('.cac-tipo').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.op, { tipoNegocio: el.value }));
  });
  container.querySelectorAll('.cac-oficina').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.op, { tieneOficina: el.checked }));
  });
  container.querySelectorAll('.cac-turnos').forEach(el => {
    el.addEventListener('change', () => guardar(el.dataset.op, { turnos: el.value.split(',').map(t => t.trim()).filter(Boolean) }));
  });
}

// ─── Admin: Personas ─────────────────────────────────────────────
async function renderAdminPersonas(container) {
  const COMPANIAS = ALL_SOCS_COMPRA;

  async function load(comp) {
    const personas = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`));
    container.querySelector('#adm-pers-tabla').innerHTML = personas.length
      ? `<table class="data-table" style="font-size:13px">
          <thead><tr>
            <th>Nombre</th><th>Teléfono</th><th>Correos</th>
            <th class="text-center" style="width:80px">Acciones</th>
          </tr></thead>
          <tbody>${personas.map(p => `
            <tr id="adm-pers-row-${p._id}">
              <td>${esc(p.nombre)}</td>
              <td>${esc(p.telefono||'—')}</td>
              <td style="font-size:12px">${(p.correos||[]).join(', ') || '<span style="color:#94a3b8">sin correo</span>'}</td>
              <td class="text-center" style="white-space:nowrap">
                <button class="btn btn-xs btn-outline" onclick="admEditPersona('${p._id}')">✏️</button>
                <button class="btn btn-xs btn-danger"  onclick="admDelPersona('${p._id}','${esc(p.nombre)}')">✕</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : '<p style="padding:16px;color:var(--text-muted)">Sin personas registradas para esta sociedad.</p>';
  }

  const compSel = COMPANIAS[0];
  container.innerHTML = `
    <div style="padding:16px;max-width:900px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <strong style="font-size:14px">👤 Personas / Beneficiarios</strong>
        <select id="adm-pers-comp" class="form-control" style="width:140px">
          ${COMPANIAS.map(c=>`<option value="${c}"${c===compSel?' selected':''}>${c}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="admNuevaPersona()">+ Nueva persona</button>
      </div>
      <div id="adm-pers-tabla"></div>

      <!-- Form nueva/edición -->
      <div id="adm-pers-form" style="display:none;margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;max-width:500px">
        <h4 style="margin:0 0 12px;font-size:14px" id="adm-pers-form-title">Nueva persona</h4>
        <input type="hidden" id="adm-pers-id">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:600">Nombre *</label>
            <input id="adm-pers-nombre" class="form-control" style="margin-top:3px" placeholder="Nombre del beneficiario">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Teléfono</label>
            <input id="adm-pers-telefono" class="form-control" style="margin-top:3px" placeholder="Teléfono opcional">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Correos (uno por línea)</label>
            <textarea id="adm-pers-correos" class="form-control" rows="3" style="margin-top:3px;font-size:12px"
                      placeholder="correo1@ejemplo.com&#10;correo2@ejemplo.com"></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="admGuardarPersona()">💾 Guardar</button>
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('adm-pers-form').style.display='none'">Cancelar</button>
          </div>
        </div>
      </div>
    </div>`;

  const sel = container.querySelector('#adm-pers-comp');
  sel.addEventListener('change', () => load(sel.value));
  load(compSel);

  window.admNuevaPersona = function() {
    document.getElementById('adm-pers-id').value = '';
    document.getElementById('adm-pers-nombre').value = '';
    document.getElementById('adm-pers-telefono').value = '';
    document.getElementById('adm-pers-correos').value = '';
    document.getElementById('adm-pers-form-title').textContent = 'Nueva persona';
    document.getElementById('adm-pers-form').style.display = '';
  };

  window.admEditPersona = async function(id) {
    try {
      const comp = document.getElementById('adm-pers-comp').value;
      const personas = arr(await GET(`/personas?compania=${encodeURIComponent(comp)}`));
      const p = personas.find(x => x._id === id);
      if (!p) return;
      document.getElementById('adm-pers-id').value = id;
      document.getElementById('adm-pers-nombre').value = p.nombre;
      document.getElementById('adm-pers-telefono').value = p.telefono || '';
      document.getElementById('adm-pers-correos').value = (p.correos||[]).join('\n');
      document.getElementById('adm-pers-form-title').textContent = `Editar: ${p.nombre}`;
      document.getElementById('adm-pers-form').style.display = '';
    } catch(e) { toast(e.message, 'error'); }
  };

  window.admGuardarPersona = async function() {
    const id      = document.getElementById('adm-pers-id').value;
    const nombre  = document.getElementById('adm-pers-nombre').value.trim();
    const tel     = document.getElementById('adm-pers-telefono').value.trim();
    const correos = document.getElementById('adm-pers-correos').value
                    .split('\n').map(s=>s.trim()).filter(Boolean);
    const comp    = document.getElementById('adm-pers-comp').value;
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    try {
      if (id) {
        await PUT(`/personas/${id}`, { nombre, telefono: tel, correos });
      } else {
        await POST('/personas', { nombre, telefono: tel, correos, compania: comp });
      }
      document.getElementById('adm-pers-form').style.display = 'none';
      toast('Guardado', 'success');
      load(comp);
    } catch(e) { toast(e.message, 'error'); }
  };

  window.admDelPersona = async function(id, nombre) {
    if (!confirm(`¿Eliminar a "${nombre}"?`)) return;
    try {
      await DEL(`/personas/${id}`);
      toast('Eliminada', 'success');
      load(document.getElementById('adm-pers-comp').value);
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ─── Admin: CC Correo por sociedad ────────────────────────────────
async function renderAdminCCCorreo(container) {
  const COMPANIAS = ALL_SOCS_COMPRA;

  async function load(comp) {
    const lista = await GET(`/personas/copias-correo?compania=${encodeURIComponent(comp)}`);
    const doc   = lista.find(d => d.compania === comp);
    container.querySelector('#adm-cc-correos').value = (doc?.correos||[]).join('\n');
  }

  container.innerHTML = `
    <div style="padding:16px;max-width:600px">
      <strong style="font-size:14px">📧 Correos en Copia (CC) por Sociedad</strong>
      <p style="font-size:12px;color:var(--text-muted);margin:4px 0 16px">
        Estos correos recibirán copia en cada notificación de pago enviada para la sociedad seleccionada.
      </p>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:600">Sociedad:</label>
        <select id="adm-cc-comp" class="form-control" style="width:140px">
          ${COMPANIAS.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <label style="font-size:12px;font-weight:600">Correos CC (uno por línea)</label>
      <textarea id="adm-cc-correos" class="form-control" rows="5" style="margin-top:4px;font-size:13px"
                placeholder="jefe@empresa.com&#10;contabilidad@empresa.com"></textarea>
      <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="admGuardarCC()">💾 Guardar CC</button>
    </div>`;

  const sel = container.querySelector('#adm-cc-comp');
  sel.addEventListener('change', () => load(sel.value));
  load(COMPANIAS[0]);

  window.admGuardarCC = async function() {
    const comp    = document.getElementById('adm-cc-comp').value;
    const correos = document.getElementById('adm-cc-correos').value
                    .split('\n').map(s=>s.trim()).filter(Boolean);
    try {
      await PUT(`/personas/copias-correo/${encodeURIComponent(comp)}`, { correos });
      toast('CC guardado', 'success');
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ─── Admin: Flujo de Caja ─────────────────────────────────────────
async function renderAdminFlujoCaja(container) {
  const SECCIONES = [
    ['SALDO_INICIAL',   '1. Saldo Inicial'],
    ['INGRESOS',        '2. Ingresos'],
    ['EGRESOS',         '3. Egresos'],
    ['OTROS',           '4. Otros'],
    ['POR_IDENTIFICAR', '5. Por Identificar'],
    ['SALDO_FINAL',     '6. Saldo Final'],
  ];
  // Color identificador por sección (RGB base; se aplica con distinta opacidad
  // para encabezados de sección vs. filas de detalle, y se reutiliza en ambas
  // estructuras — Base y por Sociedad — para que sea fácil ubicar cada sección).
  const SECCION_RGB = {
    SALDO_INICIAL:   '59,130,246',   // azul
    INGRESOS:        '34,197,94',    // verde
    EGRESOS:         '239,68,68',    // rojo
    OTROS:           '234,179,8',    // ámbar
    POR_IDENTIFICAR: '168,85,247',   // morado
    SALDO_FINAL:     '20,184,166',   // verde azulado
  };
  const seccionBg = (sk, alpha) => `rgba(${SECCION_RGB[sk] || '107,114,128'},${alpha})`;
  const TIPOS_ACTIVIDAD = [
    ['OPERACION',      'Operación'],
    ['FINANCIAMIENTO', 'Financiamiento'],
    ['INVERSION',      'Inversión'],
  ];
  const tipoActLabel = (k) => (TIPOS_ACTIVIDAD.find(t=>t[0]===k)||[,k])[1] || '—';
  const tipoActSelectHtml = (cls, id, current) => `
    <select class="form-control ${cls}" data-id="${id}" style="font-size:12px">
      ${TIPOS_ACTIVIDAD.map(([tk,tl])=>`<option value="${tk}" ${current===tk?'selected':''}>${esc(tl)}</option>`).join('')}
    </select>`;
  const SUBTABS = [
    ['sociedad',  '🏢 Estructura por Sociedad'],
    ['cuentas',   '🏦 Cuentas Bancarias'],
    ['movb',      '💳 Mapeo Mov. Bancario'],
    ['provs',     '🧾 Mapeo Proveedores'],
    ['opers',     '📄 Mapeo Operaciones'],
    ['tc',        '💱 Tipo de Cambio'],
  ];

  container.innerHTML = `
    <div style="padding:8px">
      <div class="tabs" style="flex-wrap:wrap">
        ${SUBTABS.map(([k,l],i) => `<button class="tab-btn fc-adm-tab ${i===0?'active':''}" data-sub="${k}">${l}</button>`).join('')}
      </div>
      ${SUBTABS.map(([k],i) => `<div id="fc-adm-${k}" class="tab-panel ${i===0?'active':''}"></div>`).join('')}
    </div>`;

  container.querySelectorAll('.fc-adm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.fc-adm-tab').forEach(b=>b.classList.remove('active'));
      container.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`fc-adm-${btn.dataset.sub}`).classList.add('active');
    });
  });

  const socSelectorHtml = (selectId) => `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
      <label style="font-size:13px;font-weight:600">Sociedad:</label>
      <select id="${selectId}" class="form-control" style="width:160px">
        ${ALL_SOCS_COMPRA.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
    </div>`;

  // ── 1) Estructura por Sociedad ───────────────────────────────────
  async function renderSociedad() {
    const el = document.getElementById('fc-adm-sociedad');
    el.innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
        Cada sociedad hereda las líneas de la estructura base (puedes renombrarlas, reordenarlas
        o desactivarlas) y puede agregar líneas adicionales propias, siempre enlazadas a una línea base.
      </p>
      ${socSelectorHtml('fc-soc-comp')}
      <div id="fc-soc-cont"></div>`;

    async function load() {
      const comp = document.getElementById('fc-soc-comp').value;
      const lineas = await GET(`/flujo-caja/lineas?compania=${encodeURIComponent(comp)}`);
      const cont = document.getElementById('fc-soc-cont');
      cont.innerHTML = `
        <div class="card" style="overflow:hidden;max-width:840px;margin-bottom:16px">
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Sección</th><th>Línea</th><th style="width:160px">Tipo de Actividad</th><th style="width:70px">Orden</th><th style="width:90px">Activa</th><th style="width:100px">Manual</th><th style="width:80px">Acciones</th></tr></thead>
            <tbody>
              ${lineas.length ? SECCIONES.map(([sk,sl]) => {
                const filas = lineas.filter(l => l.seccion === sk).sort((a,b) => (a.orden||0) - (b.orden||0));
                const headerRow = `<tr><td colspan="7" style="background:${seccionBg(sk,0.28)};font-weight:700;font-size:11px;padding:6px 10px">${esc(sl)}</td></tr>`;
                if (!filas.length) return headerRow;
                return headerRow + filas.map(l => `
                <tr style="background:${l.esManual ? 'rgba(234,179,8,0.08)' : seccionBg(sk,0.07)}">
                  <td class="text-muted" style="font-size:11px">${esc(sl)}${l.esManual ? ' <span style="color:#b45309;font-size:10px">⚑</span>' : ''}</td>
                  <td><input class="form-control fc-soc-nombre" data-id="${l._id}" value="${esc(l.nombre)}" style="font-size:12px"></td>
                  <td>${l.esManual ? '<span style="font-size:11px;color:#b45309">— no aplica —</span>' : tipoActSelectHtml('fc-soc-tipo', l._id, l.tipoActividad || 'OPERACION')}</td>
                  <td><input type="number" class="form-control fc-soc-orden" data-id="${l._id}" value="${l.orden||0}" style="font-size:12px;width:60px"></td>
                  <td class="text-center"><input type="checkbox" class="fc-soc-activa" data-id="${l._id}" ${l.activa!==false?'checked':''}></td>
                  <td class="text-center" title="Si está marcada, este marcador no aparece en la grilla del flujo"><input type="checkbox" class="fc-soc-manual" data-id="${l._id}" ${l.esManual?'checked':''}></td>
                  <td class="text-center" style="white-space:nowrap">
                    <button class="btn btn-xs btn-primary" onclick="fcSocGuardar('${l._id}')" title="Guardar">💾</button>
                    <button class="btn btn-xs btn-danger" onclick="fcSocEliminar('${l._id}')" title="Eliminar">✕</button>
                  </td>
                </tr>`).join('');
              }).join('') : '<tr><td colspan="7" class="text-muted text-center py-8">Sin líneas para esta sociedad. Agrega la primera abajo.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:14px;max-width:840px">
          <strong style="font-size:13px">+ Nueva línea de ${esc(comp)}</strong>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Sección</label>
              <select id="fc-soc-new-seccion" class="form-control" style="width:170px;font-size:12px">
                ${SECCIONES.map(([sk,sl])=>`<option value="${sk}">${esc(sl)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Nombre de la línea</label>
              <input id="fc-soc-new-nombre" class="form-control" style="width:240px;font-size:12px" placeholder="Ej: Cobranza Clientes">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Tipo de Actividad</label>
              <select id="fc-soc-new-tipo" class="form-control" style="width:160px;font-size:12px">
                ${TIPOS_ACTIVIDAD.map(([tk,tl])=>`<option value="${tk}">${esc(tl)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Orden</label>
              <input id="fc-soc-new-orden" type="number" class="form-control" style="width:70px;font-size:12px" value="0">
            </div>
            <div style="align-self:flex-end;padding-bottom:4px">
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer" title="Marcador para identificar movimientos que requieren asignación caso a caso; no aparece en la grilla del flujo">
                <input type="checkbox" id="fc-soc-new-manual" style="cursor:pointer">
                <span style="color:#b45309">⚑ Asignación manual</span>
              </label>
            </div>
            <button class="btn btn-primary btn-sm" onclick="fcSocAgregar()">+ Agregar</button>
          </div>
        </div>`;
    }

    document.getElementById('fc-soc-comp').addEventListener('change', load);
    await load();

    window.fcSocAgregar = async () => {
      const comp    = document.getElementById('fc-soc-comp').value;
      const seccion = document.getElementById('fc-soc-new-seccion').value;
      const nombre  = document.getElementById('fc-soc-new-nombre').value.trim();
      const tipoActividad = document.getElementById('fc-soc-new-tipo').value;
      const orden   = document.getElementById('fc-soc-new-orden').value;
      const esManual = document.getElementById('fc-soc-new-manual').checked;
      if (!nombre) { toast('Ingresa el nombre de la línea', 'warning'); return; }
      try {
        await POST('/flujo-caja/lineas', { compania: comp, seccion, nombre, tipoActividad, orden, esManual });
        toast('✅ Línea agregada', 'success');
        await load();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.fcSocGuardar = async (id) => {
      const nombre   = container.querySelector(`.fc-soc-nombre[data-id="${id}"]`)?.value.trim();
      const tipoActividad = container.querySelector(`.fc-soc-tipo[data-id="${id}"]`)?.value;
      const orden    = container.querySelector(`.fc-soc-orden[data-id="${id}"]`)?.value;
      const activa   = container.querySelector(`.fc-soc-activa[data-id="${id}"]`)?.checked;
      const esManual = container.querySelector(`.fc-soc-manual[data-id="${id}"]`)?.checked;
      try { await PUT(`/flujo-caja/lineas/${id}`, { nombre, tipoActividad, orden, activa, esManual }); toast('Guardado', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
    window.fcSocEliminar = async (id) => {
      if (!confirm('¿Eliminar esta línea?')) return;
      try { await DEL(`/flujo-caja/lineas/${id}`); toast('Eliminada', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
  }

  // ── 3) Cuentas Bancarias ─────────────────────────────────────────
  async function renderCuentas() {
    const el = document.getElementById('fc-adm-cuentas');
    el.innerHTML = `${socSelectorHtml('fc-cta-comp')}<div id="fc-cta-cont"></div>`;

    async function load() {
      const comp    = document.getElementById('fc-cta-comp').value;
      const cuentas = await GET(`/flujo-caja/cuentas?compania=${encodeURIComponent(comp)}`);
      const cont = document.getElementById('fc-cta-cont');
      cont.innerHTML = `
        <div class="card" style="overflow:hidden;max-width:920px;margin-bottom:16px">
          <table class="data-table" style="font-size:12px">
            <thead><tr><th>Banco</th><th style="width:80px">Moneda</th><th>N° Cuenta</th><th>Alias</th><th style="width:120px">Saldo Inicial</th><th style="width:130px">Fecha Saldo</th><th style="width:80px">Activa</th><th style="width:80px">Acciones</th></tr></thead>
            <tbody>
              ${cuentas.map(c => `
              <tr>
                <td><input class="form-control fc-cta-banco" data-id="${c._id}" value="${esc(c.banco)}" style="font-size:12px;width:90px"></td>
                <td>
                  <select class="form-control fc-cta-moneda" data-id="${c._id}" style="font-size:12px">
                    <option value="SOL" ${c.moneda==='SOL'?'selected':''}>SOL</option>
                    <option value="USD" ${c.moneda==='USD'?'selected':''}>USD</option>
                  </select>
                </td>
                <td><input class="form-control fc-cta-numero" data-id="${c._id}" value="${esc(c.numeroCuenta||'')}" style="font-size:12px"></td>
                <td><input class="form-control fc-cta-alias" data-id="${c._id}" value="${esc(c.alias||'')}" style="font-size:12px"></td>
                <td><input type="number" step="0.01" class="form-control fc-cta-saldo" data-id="${c._id}" value="${c.saldoInicial||0}" style="font-size:12px;text-align:right"></td>
                <td><input type="date" class="form-control fc-cta-fecha" data-id="${c._id}" value="${c.fechaSaldoInicial ? new Date(c.fechaSaldoInicial).toISOString().slice(0,10) : ''}" style="font-size:11px"></td>
                <td class="text-center"><input type="checkbox" class="fc-cta-activa" data-id="${c._id}" ${c.activa!==false?'checked':''}></td>
                <td class="text-center" style="white-space:nowrap">
                  <button class="btn btn-xs btn-primary" onclick="fcCtaGuardar('${c._id}')" title="Guardar">💾</button>
                  <button class="btn btn-xs btn-danger" onclick="fcCtaEliminar('${c._id}')" title="Eliminar">✕</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="8" class="text-muted text-center py-8">Sin cuentas registradas</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:14px;max-width:920px">
          <strong style="font-size:13px">+ Nueva cuenta bancaria</strong>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Banco</label>
              <input id="fc-cta-new-banco" class="form-control" style="width:110px;font-size:12px" placeholder="BCP"></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Moneda</label>
              <select id="fc-cta-new-moneda" class="form-control" style="width:90px;font-size:12px">
                <option value="SOL">SOL</option><option value="USD">USD</option>
              </select></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">N° Cuenta</label>
              <input id="fc-cta-new-numero" class="form-control" style="width:160px;font-size:12px"></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Alias</label>
              <input id="fc-cta-new-alias" class="form-control" style="width:140px;font-size:12px"></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Saldo Inicial</label>
              <input id="fc-cta-new-saldo" type="number" step="0.01" class="form-control" style="width:110px;font-size:12px" value="0"></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Fecha Saldo</label>
              <input id="fc-cta-new-fecha" type="date" class="form-control" style="font-size:12px"></div>
            <button class="btn btn-primary btn-sm" onclick="fcCtaAgregar()">+ Agregar</button>
          </div>
        </div>`;
    }

    document.getElementById('fc-cta-comp').addEventListener('change', load);
    await load();

    window.fcCtaAgregar = async () => {
      const compania = document.getElementById('fc-cta-comp').value;
      const banco    = document.getElementById('fc-cta-new-banco').value.trim();
      const moneda   = document.getElementById('fc-cta-new-moneda').value;
      const numeroCuenta = document.getElementById('fc-cta-new-numero').value.trim();
      const alias    = document.getElementById('fc-cta-new-alias').value.trim();
      const saldoInicial = document.getElementById('fc-cta-new-saldo').value;
      const fechaSaldoInicial = document.getElementById('fc-cta-new-fecha').value;
      if (!banco) { toast('Ingresa el banco', 'warning'); return; }
      try {
        await POST('/flujo-caja/cuentas', { compania, banco, moneda, numeroCuenta, alias, saldoInicial, fechaSaldoInicial });
        toast('✅ Cuenta agregada', 'success');
        await load();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.fcCtaGuardar = async (id) => {
      const q = sel => container.querySelector(`${sel}[data-id="${id}"]`);
      try {
        await PUT(`/flujo-caja/cuentas/${id}`, {
          banco: q('.fc-cta-banco')?.value.trim(),
          moneda: q('.fc-cta-moneda')?.value,
          numeroCuenta: q('.fc-cta-numero')?.value.trim(),
          alias: q('.fc-cta-alias')?.value.trim(),
          saldoInicial: q('.fc-cta-saldo')?.value,
          fechaSaldoInicial: q('.fc-cta-fecha')?.value || null,
          activa: q('.fc-cta-activa')?.checked,
        });
        toast('Guardado', 'success');
        await load();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.fcCtaEliminar = async (id) => {
      if (!confirm('¿Eliminar esta cuenta?')) return;
      try { await DEL(`/flujo-caja/cuentas/${id}`); toast('Eliminada', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
  }

  // ── 4/5/6) Tablas de mapeo (genérico: clave → línea) ─────────────
  // cfg = { tabKey, endpoint, titulo, campos: [{id,label,placeholder}], buildClaveCols(row), needsCuenta }
  async function renderMapeoGenerico(cfg) {
    const el = document.getElementById(`fc-adm-${cfg.tabKey}`);
    el.innerHTML = `${socSelectorHtml(`fc-${cfg.tabKey}-comp`)}<div id="fc-${cfg.tabKey}-cont"></div>`;

    async function load() {
      const comp = document.getElementById(`fc-${cfg.tabKey}-comp`).value;
      const [rows, lineas, cuentas] = await Promise.all([
        GET(`/flujo-caja/${cfg.endpoint}?compania=${encodeURIComponent(comp)}`),
        GET(`/flujo-caja/lineas?compania=${encodeURIComponent(comp)}`),
        cfg.needsCuenta ? GET(`/flujo-caja/cuentas?compania=${encodeURIComponent(comp)}`) : Promise.resolve([]),
      ]);
      const cuentaLabel = c => `${c.banco} ${c.moneda}${c.numeroCuenta?` — ${c.numeroCuenta}`:''}${c.alias?` (${c.alias})`:''}`;
      const cont = document.getElementById(`fc-${cfg.tabKey}-cont`);

      const colHeaders = cfg.campos.map(c => `<th>${esc(c.label)}</th>`).join('');
      const lineasSorted = [...lineas].sort((a,b)=>{
        if (!!a.esManual !== !!b.esManual) return a.esManual ? 1 : -1;
        const si=SECCIONES.findIndex(s=>s[0]===a.seccion),sj=SECCIONES.findIndex(s=>s[0]===b.seccion);
        return si!==sj?si-sj:(a.orden||0)-(b.orden||0)||a.nombre.localeCompare(b.nombre,'es');
      });
      const lineaOptionHtml = (l, selectedId) => {
        const label = l.esManual ? `⚑ ${esc(l.nombre)}` : `${esc((SECCIONES.find(s=>s[0]===l.seccion)||[,l.seccion])[1])} — ${esc(l.nombre)}`;
        return `<option value="${l._id}"${selectedId===String(l._id)?' selected':''}>${label}</option>`;
      };
      const sinAsignar = rows.filter(r => !r.lineaId).length;

      cont.innerHTML = `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${esc(cfg.descripcion)}</p>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none">
            <input type="checkbox" id="fc-${cfg.tabKey}-filtro-sin" onchange="fcMapFiltrarSin('${cfg.tabKey}',this.checked)" style="cursor:pointer">
            Solo sin asignar <span style="font-size:11px;color:var(--text-muted)">(${sinAsignar} de ${rows.length})</span>
          </label>
        </div>
        <div class="card" style="overflow:hidden;max-width:920px;margin-bottom:16px">
          <table class="data-table" id="fc-${cfg.tabKey}-tabla" style="font-size:12px">
            <thead><tr>${colHeaders}<th>Línea del Flujo</th><th style="width:60px">Acciones</th></tr></thead>
            <tbody>
              ${rows.map(r => {
                const lineaActualId = r.lineaId?._id ? String(r.lineaId._id) : (r.lineaId ? String(r.lineaId) : '');
                const sinLinea = !lineaActualId ? '1' : '0';
                const lineaSel = `<select style="font-size:11px;padding:2px 4px;max-width:260px"
                  onchange="fcMapActualizarLinea('${cfg.endpoint}','${r._id}',this.value)">
                  <option value="">— Sin asignar —</option>
                  ${lineasSorted.map(l=>lineaOptionHtml(l, lineaActualId)).join('')}
                </select>`;
                return `<tr data-sin-linea="${sinLinea}">
                  ${cfg.buildClaveCols(r, cuentas, cuentaLabel)}
                  <td style="padding:4px 8px">${lineaSel}</td>
                  <td class="text-center"><button class="btn btn-xs btn-danger" onclick="fcMapEliminar('${cfg.endpoint}','${cfg.tabKey}','${r._id}')" title="Eliminar">✕</button></td>
                </tr>`;
              }).join('') || `<tr><td colspan="${cfg.campos.length+2}" class="text-muted text-center py-8">Sin registros</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:14px;max-width:920px">
          <strong style="font-size:13px">+ Nuevo mapeo</strong>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
            ${cfg.campos.map(c => `<div><label style="font-size:11px;color:var(--text-muted);display:block">${esc(c.label)}</label>${
              c.id === 'cuentaId'
                ? `<select id="fc-${cfg.tabKey}-new-${c.id}" class="form-control" style="font-size:12px;width:200px">${cuentas.map(ct=>`<option value="${ct._id}">${esc(cuentaLabel(ct))}</option>`).join('') || '<option value="">— Sin cuentas —</option>'}</select>`
                : `<input id="fc-${cfg.tabKey}-new-${c.id}" class="form-control" style="font-size:12px;width:200px" placeholder="${esc(c.placeholder||'')}">`
            }</div>`).join('')}
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Línea del flujo</label>
              <select id="fc-${cfg.tabKey}-new-linea" class="form-control" style="font-size:12px;width:240px">
                ${lineasSorted.map(l=>lineaOptionHtml(l, '')).join('') || '<option value="">— Sin líneas —</option>'}
              </select>
            </div>
            <button class="btn btn-primary btn-sm" onclick="fcMapAgregar('${cfg.endpoint}','${cfg.tabKey}',${JSON.stringify(cfg.campos.map(c=>c.id))})">+ Agregar</button>
          </div>
        </div>`;
    }

    document.getElementById(`fc-${cfg.tabKey}-comp`).addEventListener('change', load);
    await load();

    window.fcMapAgregar = async (endpoint, tabKey, camposIds) => {
      const compania = document.getElementById(`fc-${tabKey}-comp`).value;
      const lineaId  = document.getElementById(`fc-${tabKey}-new-linea`).value;
      if (!lineaId) { toast('Selecciona la línea del flujo', 'warning'); return; }
      const body = { compania, lineaId };
      for (const id of camposIds) {
        const v = document.getElementById(`fc-${tabKey}-new-${id}`)?.value?.trim?.() ?? document.getElementById(`fc-${tabKey}-new-${id}`)?.value;
        if (!v) { toast('Completa todos los campos', 'warning'); return; }
        body[id] = v;
      }
      try {
        await POST(`/flujo-caja/${endpoint}`, body);
        toast('✅ Agregado', 'success');
        await load();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.fcMapFiltrarSin = (tabKey, soloSin) => {
      document.querySelectorAll(`#fc-${tabKey}-tabla tbody tr`).forEach(tr => {
        tr.style.display = soloSin && tr.dataset.sinLinea !== '1' ? 'none' : '';
      });
    };
    window.fcMapEliminar = async (endpoint, tabKey, id) => {
      if (!confirm('¿Eliminar este registro?')) return;
      try { await DEL(`/flujo-caja/${endpoint}/${id}`); toast('Eliminado', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
    window.fcMapActualizarLinea = async (endpoint, id, lineaId) => {
      try {
        await PUT(`/flujo-caja/${endpoint}/${id}`, { lineaId: lineaId || null });
        toast('✅ Línea actualizada', 'success');
      } catch(e) { toast(e.message, 'error'); }
    };
  }

  // ── 7) Tipo de Cambio (global) ───────────────────────────────────
  async function renderTipoCambio() {
    const el = document.getElementById('fc-adm-tc');
    async function load() {
      const rows = await GET('/flujo-caja/tipo-cambio');
      el.innerHTML = `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          Tabla manual de tipo de cambio (soles por dólar), usada para combinar el flujo de
          caja de varias monedas en la vista "Combinado en Soles".
        </p>
        <div class="card" style="overflow:hidden;max-width:480px;margin-bottom:16px">
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Fecha</th><th>Tipo de Cambio (S/ x US$)</th><th style="width:60px">Eliminar</th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td>${new Date(r.fecha).toLocaleDateString('es-PE',{timeZone:'UTC'})}</td>
                <td>${(r.valor||0).toFixed(4)}</td>
                <td class="text-center"><button class="btn btn-xs btn-danger" onclick="fcTcEliminar('${r._id}')">✕</button></td>
              </tr>`).join('') || '<tr><td colspan="3" class="text-muted text-center py-8">Sin registros</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:14px;max-width:480px">
          <strong style="font-size:13px">+ Nuevo / actualizar tipo de cambio</strong>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:flex-end">
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Fecha</label>
              <input id="fc-tc-new-fecha" type="date" class="form-control" style="font-size:12px"></div>
            <div><label style="font-size:11px;color:var(--text-muted);display:block">Valor</label>
              <input id="fc-tc-new-valor" type="number" step="0.0001" class="form-control" style="font-size:12px;width:110px" placeholder="3.7500"></div>
            <button class="btn btn-primary btn-sm" onclick="fcTcAgregar()">💾 Guardar</button>
          </div>
        </div>`;
    }
    await load();
    window.fcTcAgregar = async () => {
      const fecha = document.getElementById('fc-tc-new-fecha').value;
      const valor = document.getElementById('fc-tc-new-valor').value;
      if (!fecha || !valor) { toast('Completa fecha y valor', 'warning'); return; }
      try { await POST('/flujo-caja/tipo-cambio', { fecha, valor }); toast('✅ Guardado', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
    window.fcTcEliminar = async (id) => {
      if (!confirm('¿Eliminar este tipo de cambio?')) return;
      try { await DEL(`/flujo-caja/tipo-cambio/${id}`); toast('Eliminado', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
    };
  }

  // ── Init ─────────────────────────────────────────────────────────
  await renderSociedad();
  await renderCuentas();
  await renderMapeoGenerico({
    tabKey: 'movb', endpoint: 'mov-bancario',
    descripcion: 'Identifica la línea del flujo según la cuenta bancaria y el número de operación del movimiento (1er criterio de conciliación).',
    campos: [
      { id: 'cuentaId', label: 'Cuenta Bancaria' },
      { id: 'numeroOperacion', label: 'N° Operación', placeholder: 'Ej: 00123456' },
    ],
    needsCuenta: true,
    buildClaveCols: (r, cuentas, cuentaLabel) => {
      const cta = cuentas.find(c => c._id === (r.cuentaId?._id || r.cuentaId));
      return `<td class="text-muted" style="font-size:11px">${esc(cta ? cuentaLabel(cta) : '—')}</td><td>${esc(r.numeroOperacion)}</td>`;
    },
  });
  await renderMapeoGenerico({
    tabKey: 'provs', endpoint: 'proveedores',
    descripcion: 'Identifica la línea del flujo según el nombre del proveedor/beneficiario que recibió el pago (2do criterio, usado al conciliar por cuadre de totales).',
    campos: [{ id: 'nombreProveedor', label: 'Nombre del Proveedor', placeholder: 'Ej: ACME S.A.C.' }],
    needsCuenta: false,
    buildClaveCols: (r) => `<td>${esc(r.nombreProveedor)}</td>`,
  });
  await renderMapeoGenerico({
    tabKey: 'opers', endpoint: 'operaciones',
    descripcion: 'Identifica la línea del flujo según la descripción de la operación bancaria (3er criterio de conciliación).',
    campos: [{ id: 'descripcion', label: 'Descripción de la Operación', placeholder: 'Ej: COMISION MANTENIMIENTO' }],
    needsCuenta: false,
    buildClaveCols: (r) => `<td>${esc(r.descripcion)}</td>`,
  });
  await renderTipoCambio();
}

// ─── Admin: Grupos de Pago ────────────────────────────────────────
async function renderAdminGruposPago(container) {
  async function load() {
    const [grupos, detalles] = await Promise.all([
      GET('/pagos/grupos'), GET('/pagos/detalles'),
    ]);
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:8px">

        <!-- Grupo Proveedor -->
        <div class="card" style="overflow:hidden">
          <div style="padding:12px 16px;font-weight:600;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span>💳 Grupo Proveedor</span>
            <div style="display:flex;gap:6px">
              <input id="new-grupo" class="form-control" style="width:160px;font-size:12px" placeholder="Nuevo grupo...">
              <button class="btn btn-primary btn-sm" onclick="pgAddGrupo()">+ Agregar</button>
            </div>
          </div>
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Nombre</th><th class="text-center" style="width:60px">Eliminar</th></tr></thead>
            <tbody>
              ${grupos.map(g => `<tr>
                <td>${esc(g.nombre)}</td>
                <td class="text-center">
                  <button class="btn btn-xs btn-danger" onclick="pgDelGrupo('${g._id}')">✕</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="2" class="text-muted text-center py-8">Sin grupos</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- Detalle Grupo Proveedor -->
        <div class="card" style="overflow:hidden">
          <div style="padding:12px 16px;font-weight:600;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span>📋 Detalle Grupo</span>
            <div style="display:flex;gap:6px">
              <select id="new-det-grupo" class="form-control" style="width:130px;font-size:12px">
                <option value="">— Grupo —</option>
                ${grupos.map(g => `<option value="${g.nombre}">${g.nombre}</option>`).join('')}
              </select>
              <input id="new-detalle" class="form-control" style="width:130px;font-size:12px" placeholder="Detalle...">
              <button class="btn btn-primary btn-sm" onclick="pgAddDetalle()">+ Agregar</button>
            </div>
          </div>
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Grupo</th><th>Detalle</th><th class="text-center" style="width:60px">Eliminar</th></tr></thead>
            <tbody>
              ${detalles.map(d => `<tr>
                <td class="text-muted">${esc(d.grupoProveedor)}</td>
                <td>${esc(d.nombre)}</td>
                <td class="text-center">
                  <button class="btn btn-xs btn-danger" onclick="pgDelDetalle('${d._id}')">✕</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="3" class="text-muted text-center py-8">Sin detalles</td></tr>'}
            </tbody>
          </table>
        </div>

      </div>`;
  }

  window.pgAddGrupo = async () => {
    const nombre = document.getElementById('new-grupo')?.value.trim();
    if (!nombre) return;
    try { await POST('/pagos/grupos', { nombre }); await load(); }
    catch(e) { toast(e.message, 'error'); }
  };
  window.pgDelGrupo = async (id) => {
    if (!confirm('¿Eliminar este grupo?')) return;
    try { await DEL(`/pagos/grupos/${id}`); await load(); }
    catch(e) { toast(e.message, 'error'); }
  };
  window.pgAddDetalle = async () => {
    const grupoProveedor = document.getElementById('new-det-grupo')?.value;
    const nombre         = document.getElementById('new-detalle')?.value.trim();
    if (!grupoProveedor || !nombre) { toast('Selecciona un grupo e ingresa el detalle', 'error'); return; }
    try { await POST('/pagos/detalles', { nombre, grupoProveedor }); await load(); }
    catch(e) { toast(e.message, 'error'); }
  };
  window.pgDelDetalle = async (id) => {
    if (!confirm('¿Eliminar?')) return;
    try { await DEL(`/pagos/detalles/${id}`); await load(); }
    catch(e) { toast(e.message, 'error'); }
  };

  await load();
}

// ─── Admin: Bancos de Pago ────────────────────────────────────────
async function renderAdminBancos(container) {
  async function load() {
    const bancos = await GET('/pagos/bancos');
    container.innerHTML = `
      <div style="padding:8px">
        <div class="card" style="overflow:hidden;max-width:600px">
          <div style="padding:12px 16px;font-weight:600;border-bottom:1px solid var(--border);
                      display:flex;justify-content:space-between;align-items:center">
            <span>🏦 Bancos Válidos para Pagos</span>
          </div>
          <table class="data-table" style="font-size:13px">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th class="text-center">Activo</th>
                <th class="text-center" style="width:70px">Eliminar</th>
              </tr>
            </thead>
            <tbody id="admin-bancos-tbody">
              ${bancos.map(b => `
                <tr data-id="${b._id}">
                  <td style="font-weight:600">${esc(b.nombre)}</td>
                  <td style="color:var(--text-muted)">${esc(b.codigo||'—')}</td>
                  <td class="text-center">
                    <input type="checkbox" ${b.activo ? 'checked' : ''}
                           style="width:14px;height:14px;accent-color:var(--primary)"
                           onchange="adminBancoToggle('${b._id}',this.checked)">
                  </td>
                  <td class="text-center">
                    <button class="btn btn-xs btn-danger" onclick="adminBancoEliminar('${b._id}')">✕</button>
                  </td>
                </tr>`).join('') ||
              '<tr><td colspan="4" class="text-muted text-center" style="padding:16px">Sin bancos registrados</td></tr>'}
            </tbody>
          </table>
          <!-- Formulario de alta -->
          <div style="padding:12px 16px;border-top:1px solid var(--border);
                      display:flex;gap:8px;align-items:flex-end;background:#f8fafc">
            <div style="flex:1">
              <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Nombre del banco *</label>
              <input id="admin-banco-nombre" class="form-control" style="font-size:13px" placeholder="Ej: BBVA">
            </div>
            <div style="width:110px">
              <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Código</label>
              <input id="admin-banco-codigo" class="form-control" style="font-size:13px" placeholder="Ej: 011">
            </div>
            <button class="btn btn-primary btn-sm" onclick="adminBancoAgregar()">＋ Agregar</button>
          </div>
        </div>
      </div>`;
  }

  window.adminBancoAgregar = async function() {
    const nombre = document.getElementById('admin-banco-nombre').value.trim();
    const codigo = document.getElementById('admin-banco-codigo').value.trim();
    if (!nombre) { toast('Ingresa el nombre del banco', 'error'); return; }
    try {
      await POST('/pagos/bancos', { nombre, codigo });
      toast('Banco agregado', 'success');
      await load();
    } catch(e) { toast(e.message, 'error'); }
  };

  window.adminBancoToggle = async function(id, activo) {
    try {
      await PUT(`/pagos/bancos/${id}`, { activo });
    } catch(e) { toast(e.message, 'error'); await load(); }
  };

  window.adminBancoEliminar = async function(id) {
    if (!confirm('¿Eliminar este banco? No podrá deshacerse.')) return;
    try {
      await DEL(`/pagos/bancos/${id}`);
      toast('Banco eliminado', 'success');
      await load();
    } catch(e) { toast(e.message, 'error'); }
  };

  await load();
}

// ─── Admin: Configuración ─────────────────────────────────────────
async function renderAdminConfig(container) {
  container.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let cfg = {};
  try { cfg = await GET('/config'); } catch (err) { toast(err.message, 'error'); }

  const smtpEnabled = cfg.smtpEnabled === 'true' || cfg.smtpEnabled === true;

  container.innerHTML = `
    <div class="section-title mb-16">Parámetros del sistema</div>

    <div class="card" style="max-width:520px;margin-bottom:20px">
      <div class="card-body">
        <h3 style="margin:0 0 14px;font-size:15px">⚙️ Auto-aprobación</h3>
        <div class="form-group">
          <label>Máxima variación permitida para auto-aprobación (%)</label>
          <input type="number" id="cfg-maxvar" class="form-control" value="${cfg.maxVariacion ?? 10}" min="0" max="100" step="1" style="width:120px">
          <p class="text-muted" style="font-size:12px;margin-top:4px">
            Si la cantidad solicitada ≤ sugerido × (1 + este %), la línea se auto-aprueba.
          </p>
        </div>
        <button class="btn btn-primary" id="cfg-save">💾 Guardar</button>
        <span id="cfg-status" style="margin-left:12px;font-size:13px"></span>
      </div>
    </div>

    <div class="card" style="max-width:520px">
      <div class="card-body">
        <h3 style="margin:0 0 4px;font-size:15px">📧 Correo (SMTP — Outlook)</h3>
        <p class="text-muted" style="font-size:12px;margin:0 0 14px">
          Los correos se envían a los mismos destinatarios que las notificaciones push.
        </p>
        <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <label style="margin:0;font-weight:600">Habilitado</label>
          <input type="checkbox" id="cfg-smtp-enabled" ${smtpEnabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)">
        </div>
        <div class="form-group">
          <label>Servidor SMTP (ej: smtp.office365.com)</label>
          <input type="text" id="cfg-smtp-host" class="form-control" value="${esc(cfg.smtpHost || '')}" placeholder="smtp.office365.com">
        </div>
        <div class="form-group">
          <label>Puerto (587 para TLS, 465 para SSL)</label>
          <input type="number" id="cfg-smtp-port" class="form-control" value="${cfg.smtpPort || 587}" style="width:100px">
        </div>
        <div class="form-group">
          <label>Usuario (correo de Outlook)</label>
          <input type="text" id="cfg-smtp-user" class="form-control" value="${esc(cfg.smtpUser || '')}" placeholder="usuario@empresa.com">
        </div>
        <div class="form-group">
          <label>Contraseña</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="password" id="cfg-smtp-pass" class="form-control" value="${esc(cfg.smtpPass || '')}" placeholder="••••••••" style="flex:1">
            <button type="button" id="btn-toggle-pass" title="Mostrar/ocultar contraseña"
              style="padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer;font-size:12px;font-weight:600;color:#475569;flex-shrink:0;white-space:nowrap"
              onclick="(function(){const i=document.getElementById('cfg-smtp-pass');const b=document.getElementById('btn-toggle-pass');if(i.type==='password'){i.type='text';b.textContent='Ocultar';}else{i.type='password';b.textContent='Ver';}})()">Ver</button>
          </div>
        </div>
        <div class="form-group">
          <label>Remitente (From)</label>
          <input type="text" id="cfg-smtp-from" class="form-control" value="${esc(cfg.smtpFrom || '')}" placeholder="Pedidos Adicionales &lt;usuario@empresa.com&gt;">
        </div>
        <div class="form-group">
          <label>Método de autenticación</label>
          <select id="cfg-smtp-authmethod" class="form-control" style="width:auto">
            <option value="LOGIN" ${(cfg.smtpAuthMethod||'LOGIN')==='LOGIN'?'selected':''}>LOGIN (Exchange / servidores propios)</option>
            <option value="PLAIN" ${cfg.smtpAuthMethod==='PLAIN'?'selected':''}>PLAIN (Office 365 / Gmail)</option>
          </select>
          <p class="text-muted" style="font-size:12px;margin-top:4px">Si ves error 535, cambia entre LOGIN y PLAIN.</p>
        </div>
        <button class="btn btn-primary" id="cfg-smtp-save">💾 Guardar configuración SMTP</button>
        <button class="btn btn-secondary" id="cfg-smtp-test" style="margin-left:8px">🔌 Probar conexión</button>
        <button class="btn btn-outline" id="cfg-smtp-diagnose" style="margin-left:8px">🩺 Diagnosticar</button>
        <span id="cfg-smtp-status" style="margin-left:12px;font-size:13px"></span>
      </div>
    </div>`;

  // Guardar auto-aprobación
  document.getElementById('cfg-save').addEventListener('click', async () => {
    const val = Number(document.getElementById('cfg-maxvar').value);
    const btn = document.getElementById('cfg-save');
    const status = document.getElementById('cfg-status');
    btn.disabled = true; btn.textContent = '⏳';
    try {
      await PUT('/config', { maxVariacion: val });
      status.innerHTML = `<span style="color:var(--success)">✔ Guardado</span>`;
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger)">✕ ${err.message}</span>`;
    }
    btn.disabled = false; btn.textContent = '💾 Guardar';
    setTimeout(() => { if (status) status.innerHTML = ''; }, 3000);
  });

  // Guardar SMTP
  document.getElementById('cfg-smtp-save').addEventListener('click', async () => {
    const btn    = document.getElementById('cfg-smtp-save');
    const status = document.getElementById('cfg-smtp-status');
    btn.disabled = true; btn.textContent = '⏳';
    try {
      await PUT('/config', {
        smtpEnabled:    document.getElementById('cfg-smtp-enabled').checked ? 'true' : 'false',
        smtpHost:       document.getElementById('cfg-smtp-host').value.trim(),
        smtpPort:       document.getElementById('cfg-smtp-port').value.trim(),
        smtpUser:       document.getElementById('cfg-smtp-user').value.trim(),
        smtpPass:       document.getElementById('cfg-smtp-pass').value,
        smtpFrom:       document.getElementById('cfg-smtp-from').value.trim(),
        smtpAuthMethod: document.getElementById('cfg-smtp-authmethod').value
      });
      status.innerHTML = `<span style="color:var(--success)">✔ Guardado</span>`;
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger)">✕ ${err.message}</span>`;
    }
    btn.disabled = false; btn.textContent = '💾 Guardar configuración SMTP';
    setTimeout(() => { if (status) status.innerHTML = ''; }, 3000);
  });

  // Probar conexión SMTP
  document.getElementById('cfg-smtp-test').addEventListener('click', async () => {
    const btn    = document.getElementById('cfg-smtp-test');
    const status = document.getElementById('cfg-smtp-status');
    btn.disabled = true; btn.textContent = '⏳ Probando...';
    try {
      await POST('/config/smtp-test', {
        smtpHost:       document.getElementById('cfg-smtp-host').value.trim(),
        smtpPort:       document.getElementById('cfg-smtp-port').value.trim(),
        smtpUser:       document.getElementById('cfg-smtp-user').value.trim(),
        smtpPass:       document.getElementById('cfg-smtp-pass').value,
        smtpFrom:       document.getElementById('cfg-smtp-from').value.trim(),
        smtpAuthMethod: document.getElementById('cfg-smtp-authmethod').value
      });
      status.innerHTML = `<span style="color:var(--success)">✔ Conexión exitosa</span>`;
    } catch (err) {
      status.innerHTML = `<span style="color:var(--danger)">✕ ${err.message}</span>`;
    }
    btn.disabled = false; btn.textContent = '🔌 Probar conexión';
    setTimeout(() => { if (status) status.innerHTML = ''; }, 5000);
  });

  // Diagnóstico completo de correo
  document.getElementById('cfg-smtp-diagnose').addEventListener('click', async () => {
    const emailDestino = prompt('¿A qué correo enviar el mensaje de prueba? (deja vacío para solo verificar config)') ?? '';
    const btn = document.getElementById('cfg-smtp-diagnose');
    btn.disabled = true; btn.textContent = '⏳ Diagnosticando...';
    try {
      const { pasos } = await POST('/config/smtp-diagnose', { emailDestino: emailDestino.trim() });
      const iconMap = { ok: '✅', error: '❌', warn: '⚠️' };
      const colorMap = { ok: '#166534', error: '#991b1b', warn: '#92400e' };
      const bgMap    = { ok: '#f0fdf4', error: '#fef2f2', warn: '#fffbeb' };
      const html = `
        <div style="font-size:13px">
          ${pasos.map(p => `
            <div style="display:flex;gap:10px;padding:8px 10px;border-radius:6px;margin-bottom:6px;background:${bgMap[p.estado]}">
              <span>${iconMap[p.estado]}</span>
              <div>
                <div style="font-weight:600;color:${colorMap[p.estado]}">${esc(p.msg)}</div>
                ${p.detail ? `<div style="color:#374151;margin-top:2px;font-size:12px;white-space:pre-wrap">${esc(String(p.detail))}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
      openModal('🩺 Diagnóstico de correo SMTP', html);
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    }
    btn.disabled = false; btn.textContent = '🩺 Diagnosticar';
  });
}

// ─── Admin: Maestro Items ─────────────────────────────────────────
async function renderAdminItems(container) {
  container.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let selectedOp = ALL_OPS[0];
  let items = [];

  async function load() {
    container.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
    try { items = await GET(`/items/all?operacion=${encodeURIComponent(selectedOp)}`); }
    catch (err) { toast(err.message, 'error'); items = []; }
    render();
  }

  function render() {
    container.innerHTML = `
      <div class="items-filter-bar">
        <select id="items-op-select">
          ${ALL_OPS.map(o => `<option value="${o}" ${o===selectedOp?'selected':''}>${o}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-outline" id="items-sync-btn">🔄 Sincronizar desde Excel</button>
        <button class="btn btn-sm btn-secondary" id="items-bulk-btn" title="Poner lote=1 a todos los items de esta operación">Lote = 1 a todos</button>
        <span id="items-sync-status" style="font-size:13px"></span>
        <span class="text-muted" style="font-size:12px;margin-left:auto">${items.length} items</span>
      </div>
      ${items.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📦</div><p>No hay items cargados para ${selectedOp}.<br>Usa el botón "Sincronizar" para importar desde el Excel.</p></div>`
        : `<div class="table-wrap"><table class="items-table">
          <thead><tr>
            <th>Código</th><th>Nombre</th><th>Grupo</th>
            <th>Gestión</th><th>Lote Compra</th><th>Activo</th><th>Guardar</th>
          </tr></thead>
          <tbody>
            ${items.map(it => `
              <tr data-iid="${it._id}" class="${it.activo?'':'inactive-row'}">
                <td><strong>${esc(it.item)}</strong></td>
                <td style="font-size:12px">${esc(it.nombre)}</td>
                <td style="font-size:12px">${esc(it.grupoCompra)}</td>
                <td>
                  <select class="it-gestion" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:4px;font-size:12px">
                    <option value="COMPRAS" ${it.gestion==='COMPRAS'?'selected':''}>🛒 Compras</option>
                    <option value="PLANTA"  ${it.gestion==='PLANTA' ?'selected':''}>🏭 Planta</option>
                  </select>
                </td>
                <td><input type="number" class="it-lote" value="${it.loteCompra||0}" min="0" step="1"></td>
                <td style="text-align:center">
                  <input type="checkbox" class="it-activo" ${it.activo?'checked':''} style="width:16px;height:16px">
                </td>
                <td>
                  <button class="btn btn-xs btn-outline it-save-btn">💾</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}`;

    document.getElementById('items-op-select').addEventListener('change', e => {
      selectedOp = e.target.value;
      load();
    });

    document.getElementById('items-sync-btn').addEventListener('click', async () => {
      const btn = document.getElementById('items-sync-btn');
      const status = document.getElementById('items-sync-status');
      btn.disabled = true; btn.textContent = '⏳';
      try {
        const r = await POST(`/items/sync?operacion=${encodeURIComponent(selectedOp)}`, {});
        status.innerHTML = `<span style="color:var(--success)">✔ ${r.insertados} nuevos de ${r.total} total</span>`;
        await load();
      } catch (err) {
        status.innerHTML = `<span style="color:var(--danger)">✕ ${err.message}</span>`;
        btn.disabled = false; btn.textContent = '🔄 Sincronizar desde Excel';
      }
      setTimeout(() => { if (document.getElementById('items-sync-status')) document.getElementById('items-sync-status').innerHTML = ''; }, 4000);
    });

    document.getElementById('items-bulk-btn')?.addEventListener('click', async () => {
      if (!confirm(`¿Poner lote = 1 a TODOS los items de ${selectedOp}?`)) return;
      const btn = document.getElementById('items-bulk-btn');
      const status = document.getElementById('items-sync-status');
      btn.disabled = true;
      try {
        const r = await PUT(`/items/bulk?operacion=${encodeURIComponent(selectedOp)}`, { loteCompra: 1 });
        status.innerHTML = `<span style="color:var(--success)">✔ ${r.updated} items actualizados</span>`;
        await load();
      } catch (err) {
        status.innerHTML = `<span style="color:var(--danger)">✕ ${err.message}</span>`;
      }
      btn.disabled = false;
      setTimeout(() => { if (document.getElementById('items-sync-status')) document.getElementById('items-sync-status').innerHTML = ''; }, 4000);
    });

    container.querySelectorAll('.it-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = row.dataset.iid;
        const gestion   = row.querySelector('.it-gestion').value;
        const loteCompra = Number(row.querySelector('.it-lote').value) || 0;
        const activo    = row.querySelector('.it-activo').checked;
        btn.disabled = true;
        try {
          await PUT(`/items/${id}`, { gestion, loteCompra, activo });
          toast('Item actualizado', 'success');
          row.classList.toggle('inactive-row', !activo);
        } catch (err) { toast(err.message, 'error'); }
        btn.disabled = false;
      });
    });
  }

  await load();
}

async function renderAdminUsuarios(container) {
  container.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let users = [];
  try { users = await GET('/users'); } catch (err) { toast(err.message, 'error'); }

  const allOps = [...new Set(users.flatMap(u => u.operations || []))];

  container.innerHTML = `
    <div class="flex gap-12 items-center mb-16 justify-between">
      <div class="section-title">Usuarios del sistema</div>
      <button class="btn btn-primary btn-sm" id="new-user-btn">+ Nuevo usuario</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table id="users-table">
          <thead><tr>
            <th>Usuario</th><th>Email</th><th>Rol</th><th>Operaciones</th><th class="col-actions">Acciones</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `<tr data-uid="${u.id}">
              <td><strong>${esc(u.username)}</strong></td>
              <td>${esc(u.email)}</td>
              <td><span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(ROLE_LABELS[u.role] || u.role)}</span></td>
              <td>${(u.operations||[]).map(o=>`<span class="badge" style="background:#f0fdf4;color:#166534;margin-right:4px">${esc(o)}</span>`).join('')}</td>
              <td class="col-actions">
                <div class="flex gap-8 justify-center">
                  <button class="btn btn-xs btn-outline edit-user-btn" data-uid="${u.id}">✏️</button>
                  <button class="btn btn-xs btn-danger del-user-btn" data-uid="${u.id}" ${u.id===S.user.id?'disabled':''}>✕</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('new-user-btn').addEventListener('click', () => showUserModal(null, () => renderAdminUsuarios(container)));

  container.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = users.find(u => u.id === btn.dataset.uid);
      showUserModal(u, () => renderAdminUsuarios(container));
    });
  });
  container.querySelectorAll('.del-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar usuario?')) return;
      try {
        await DEL(`/users/${btn.dataset.uid}`);
        toast('Usuario eliminado', 'success');
        renderAdminUsuarios(container);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function showUserModal(user, onSave) {
  const allRoles = [
    ['', '— Sin acceso —'],
    ...Object.entries(ROLE_LABELS).filter(([k]) => k !== 'OPERADOR_CONSULTA'),
  ];
  const body = `
    <form id="user-form">
      <div class="form-group"><label>Usuario *</label>
        <input type="text" id="um-username" required value="${esc(user?.username||'')}" placeholder="nombre_usuario">
      </div>
      <div class="form-group"><label>Email *</label>
        <input type="email" id="um-email" required value="${esc(user?.email||'')}" placeholder="email@empresa.com">
      </div>
      <div class="form-group"><label>Contraseña ${user?'(dejar vacío para no cambiar)':''} *</label>
        <input type="password" id="um-password" ${!user?'required':''} placeholder="${user?'Nueva contraseña (opcional)':'Contraseña'}">
      </div>
      <div class="form-group"><label>Rol para Pedidos Adicionales</label>
        <select id="um-role">
          ${allRoles.map(([k,v])=>`<option value="${k}" ${(user?.role||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rol para Creación de Ítems</label>
        <select id="um-items-role">
          ${ITEMS_ROLES.map(([k,v])=>`<option value="${k}" ${(user?.itemsRol||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rol para Gestión de Pagos</label>
        <select id="um-pago-role">
          ${PAGO_ROLES.map(([k,v])=>`<option value="${k}" ${(user?.rolPago||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rol para Bajas / Consumos / Transferencias</label>
        <select id="um-rol-bct">
          ${BCT_ROLES.map(([k,v])=>`<option value="${k}" ${(user?.rolBCT||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rol para 86</label>
        <select id="um-rol-86">
          ${ROL86.map(([k,v])=>`<option value="${k}" ${(user?.rol86||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Rol para Cierre de Caja</label>
        <select id="um-rol-caja">
          ${CAJA_ROLES.map(([k,v])=>`<option value="${k}" ${(user?.rolCaja||'')=== k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="um-socs-pago-section"><label>Sociedades Autorizadas</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_SOCS_COMPRA.map(s => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-soc-pago" value="${s}"
              ${((user?.sociedadesPago||[]).includes(s)||(user?.sociedadesCompra||[]).includes(s))?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            ${s}
          </label>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Define qué sociedades puede ver este usuario en Gestión de Pagos, Flujo de Caja y Precios de Compra.
        </div>
      </div>
      <div class="form-group" id="um-ops-section"><label>Operaciones Autorizadas</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
          ${[ALL_OPS_ROW1, ALL_OPS_ROW2].map(row => `
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            ${row.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
              <input type="checkbox" name="um-op" value="${op}" ${(user?.operations||[]).includes(op)?'checked':''}>
              ${op}
            </label>`).join('')}
          </div>`).join('')}
        </div>
      </div>
      <div class="form-group" id="um-transf-dest-section"><label>Operaciones Destino para Transferencias</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
          ${[ALL_OPS_ROW1, ALL_OPS_ROW2].map(row => `
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            ${row.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
              <input type="checkbox" name="um-transf-dest" value="${op}" ${(user?.transferenciaDestinos||[]).includes(op)?'checked':''}>
              ${op}
            </label>`).join('')}
          </div>`).join('')}
        </div>
      </div>
      <div id="um-permisos-extra" class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
        <label style="display:block;font-weight:600;margin-bottom:10px;color:var(--text-muted)">Módulos Autorizados</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-bajas" ${user?.accesoBajas?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>📉 <strong>Bajas</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-consumos" ${user?.accesoConsumos?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🍽️ <strong>Consumos</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-transferencias" ${user?.accesoTransferencias?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🔁 <strong>Transferencias</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-86" ${user?.acceso86?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🚫 <strong>86</strong></span>
          </label>
        </div>
        <div style="margin-bottom:10px"></div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-oficina" ${user?.accesoOficina?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🏢 <strong>Envío a Oficina</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-acc-depositos" ${user?.accesoDepositos?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🏦 <strong>Depósito Bancario</strong></span>
          </label>
        </div>
        <div style="margin-bottom:10px"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-kardex" ${user?.puedeVerKardex?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>📊 <strong>Kardex</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-precios" ${(user?.sociedadesCompra||[]).length>0?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>💰 <strong>Precios de Compra</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-comparativo" ${user?.puedeVerComparativo?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>📈 <strong>OC / Ingresos al Almacén</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-ventas" ${user?.puedeVerVentas?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🛒 <strong>Venta & TIP por Operación</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-bajas" ${user?.puedeVerBajas?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🔻 <strong>Seguimiento de Bajas</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-obligaciones" ${user?.rolObligaciones==='autorizador'?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)"
">
            <span>📋 <strong>Incluir Pago de Obligaciones</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-eerr" ${user?.accesoEERR?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>📊 <strong>PL — Estado de Resultados</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:normal;cursor:pointer">
            <input type="checkbox" id="um-conciliacion" ${user?.accesoConciliacion?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            <span>🏦 <strong>Conciliación de Cobranzas</strong></span>
          </label>
        </div>
      </div>
      <div id="um-error" class="msg-error hidden"></div>
    </form>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
      <button class="btn btn-primary" id="um-save">💾 Guardar</button>
    </div>`;

  openModal(user ? 'Editar Usuario' : 'Nuevo Usuario', body);

  // Mostrar/ocultar secciones según el rol seleccionado
  function syncRoleUI() {
    const role    = document.getElementById('um-role').value;
    const isAdmin = role === ROLES.ADMIN;
    document.getElementById('um-ops-section').style.display        = isAdmin ? 'none' : 'block';
    document.getElementById('um-transf-dest-section').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('um-socs-pago-section').style.display  = isAdmin ? 'none' : 'block';
    document.getElementById('um-permisos-extra').style.display     = isAdmin ? 'none' : 'block';
  }
  syncRoleUI();
  document.getElementById('um-role').addEventListener('change', syncRoleUI);

  document.getElementById('um-save').addEventListener('click', async () => {
    const errEl = document.getElementById('um-error');
    errEl.classList.add('hidden');
    const role = document.getElementById('um-role').value;
    const isAdmin = role === ROLES.ADMIN;
    // Lista unificada de sociedades para Pagos, Flujo de Caja y (si tiene el permiso) Precios de Compra
    const sociedadesPago   = isAdmin ? [] : [...document.querySelectorAll('input[name="um-soc-pago"]:checked')].map(cb => cb.value);
    const sociedadesCompra = (!isAdmin && document.getElementById('um-precios')?.checked) ? sociedadesPago : [];
    const sociedadesConciliacion = (!isAdmin && document.getElementById('um-conciliacion')?.checked) ? sociedadesPago : [];
    const data = {
      username: document.getElementById('um-username').value.trim(),
      email: document.getElementById('um-email').value.trim(),
      role,
      itemsRol: document.getElementById('um-items-role').value,
      rolPago:      document.getElementById('um-pago-role').value,
      rolBCT:       isAdmin ? '' : document.getElementById('um-rol-bct').value,
      rol86:        isAdmin ? '' : document.getElementById('um-rol-86').value,
      rolCaja:          isAdmin ? '' : document.getElementById('um-rol-caja').value,
      rolObligaciones:  isAdmin ? '' : (document.getElementById('um-obligaciones')?.checked ? 'autorizador' : ''),
      operations: [...document.querySelectorAll('input[name="um-op"]:checked')].map(cb => cb.value),
      transferenciaDestinos: isAdmin ? [] : [...document.querySelectorAll('input[name="um-transf-dest"]:checked')].map(cb => cb.value),
      puedeVerKardex:      !isAdmin && (document.getElementById('um-kardex')?.checked      ?? false),
      puedeVerComparativo: !isAdmin && (document.getElementById('um-comparativo')?.checked ?? false),
      puedeVerVentas:      !isAdmin && (document.getElementById('um-ventas')?.checked      ?? false),
      puedeVerBajas:       !isAdmin && (document.getElementById('um-bajas')?.checked       ?? false),
      accesoBajas:          !isAdmin && (document.getElementById('um-acc-bajas')?.checked          ?? false),
      accesoConsumos:       !isAdmin && (document.getElementById('um-acc-consumos')?.checked       ?? false),
      accesoTransferencias: !isAdmin && (document.getElementById('um-acc-transferencias')?.checked ?? false),
      acceso86:             !isAdmin && (document.getElementById('um-acc-86')?.checked              ?? false),
      accesoOficina:        !isAdmin && (document.getElementById('um-acc-oficina')?.checked         ?? false),
      accesoDepositos:      !isAdmin && (document.getElementById('um-acc-depositos')?.checked       ?? false),
      accesoEERR:           !isAdmin && (document.getElementById('um-eerr')?.checked                ?? false),
      accesoConciliacion:   !isAdmin && (document.getElementById('um-conciliacion')?.checked         ?? false),
      sociedadesCompra,
      sociedadesPago,
      sociedadesConciliacion,
    };
    const pwd = document.getElementById('um-password').value;
    if (pwd) data.password = pwd;
    if (!user && !pwd) { errEl.textContent = 'La contraseña es requerida'; errEl.classList.remove('hidden'); return; }
    try {
      if (user) await PUT(`/users/${user.id}`, data);
      else await POST('/users', data);
      toast(user ? 'Usuario actualizado' : 'Usuario creado', 'success');
      document.getElementById('modal').classList.add('hidden');
      onSave?.();
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  });
}

async function renderAdminArchivos(container) {
  let files = [];
  try { files = await GET('/datos/files'); } catch {}

  const fmtSize = s => s > 1024*1024 ? (s/1024/1024).toFixed(1)+'MB' : (s/1024).toFixed(0)+'KB';
  const adicionales = files.filter(f => f.name.includes('ADICIONALES') || f.name.includes('Adicionales'));

  container.innerHTML = `
    <div class="section-title mb-16">Archivos por Operación</div>
    <div class="card mb-16">
      <div class="card-body">
        <p class="mb-8 text-muted" style="font-size:13px">
          Nombre esperado: <strong>[OPERACION] - ADICIONALES.xlsx</strong><br>
          Ejemplo: <em>AASI - ADICIONALES.xlsx</em> &nbsp;·&nbsp;
          Hojas: <strong>Items</strong>, <strong>Kardex</strong>, <strong>Costos</strong>, <strong>Requisiciones</strong>
        </p>
        ${adicionales.length ? adicionales.map(f => `
          <div style="font-size:12px;color:var(--success);margin-bottom:6px">✔ ${esc(f.name)} (${fmtSize(f.size)}) — ${new Date(f.modified).toLocaleString('es-CL')}</div>
        `).join('') : ''}
        <label class="upload-label" for="file-adicionales">📂 Subir archivo ADICIONALES</label>
        <input type="file" id="file-adicionales" accept=".xlsx,.xlsm">
        <div class="upload-status" id="us-adicionales"></div>
      </div>
    </div>

    <div class="section-title mb-16">Archivos subidos</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Archivo</th><th>Tamaño</th><th>Modificado</th></tr></thead>
          <tbody>
            ${files.length ? files.map(f => `<tr>
              <td>${esc(f.name)}</td>
              <td>${fmtSize(f.size)}</td>
              <td>${new Date(f.modified).toLocaleString('es-CL')}</td>
            </tr>`).join('') : '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:20px">No hay archivos subidos</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('file-adicionales').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const statusEl = document.getElementById('us-adicionales');
    statusEl.textContent = '⏳ Subiendo...';
    statusEl.className = 'upload-status';
    try {
      const result = await upload(file, null);
      statusEl.textContent = `✔ Subido: ${result.filename}`;
      statusEl.className = 'upload-status ok';
      S.items = [];
      setTimeout(() => renderAdminArchivos(container), 1000);
    } catch (err) {
      statusEl.textContent = '✕ Error: ' + err.message;
      statusEl.className = 'upload-status err';
    }
    this.value = '';
  });
}

async function renderAdminPedidos(container) {
  container.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); return; }

  // Filtros
  const ops    = ['', ...ALL_OPS];
  const estados = ['', 'SOLICITADO', 'APROBADO', 'RECHAZADO', 'REVISAR', 'ATENDIDO'];

  function render(list) {
    container.innerHTML = `
      <div class="section-title mb-16">Gestión de pedidos (${list.length} pedido${list.length !== 1 ? 's' : ''})</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
        <select id="ap-fil-op" class="form-control" style="width:140px">
          ${ops.map(o => `<option value="${o}">${o || 'Todas las ops.'}</option>`)}
        </select>
        <select id="ap-fil-est" class="form-control" style="width:160px">
          ${estados.map(e => `<option value="${e}">${e || 'Todos los estados'}</option>`)}
        </select>
        <input id="ap-fil-q" type="text" class="form-control" placeholder="Buscar solicitante…" style="width:200px">
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr>
            <th>Operación</th><th>Fecha</th><th>Solicitante</th>
            <th>Estado</th><th>Líneas</th><th style="width:60px"></th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(p => `
              <tr>
                <td><span class="badge-op">${esc(p.operacion)}</span></td>
                <td>${fmtDate(p.fecha)}</td>
                <td>${esc(p.solicitadoPorNombre || p.solicitadoPorId || '—')}</td>
                <td><span class="badge badge-${(p.estado||'').toLowerCase()}">${p.estado || '—'}</span></td>
                <td>${(p.lineas||[]).length}</td>
                <td>
                  <button class="btn btn-sm btn-danger ap-del-btn" data-id="${esc(p.id)}"
                    title="Eliminar pedido">🗑️</button>
                </td>
              </tr>`).join('') : `<tr><td colspan="6" class="text-muted text-center">No hay pedidos</td></tr>`}
          </tbody>
        </table>
      </div>`;

    // Filtros reactivos
    function applyFilters() {
      const op  = document.getElementById('ap-fil-op').value;
      const est = document.getElementById('ap-fil-est').value;
      const q   = document.getElementById('ap-fil-q').value.toLowerCase();
      const filtered = pedidos.filter(p =>
        (!op  || p.operacion === op) &&
        (!est || p.estado === est) &&
        (!q   || (p.solicitadoPorNombre || '').toLowerCase().includes(q) || (p.solicitadoPorId || '').toLowerCase().includes(q))
      );
      render(filtered);
      // restaurar valores
      document.getElementById('ap-fil-op').value  = op;
      document.getElementById('ap-fil-est').value = est;
      document.getElementById('ap-fil-q').value   = q;
    }
    document.getElementById('ap-fil-op').addEventListener('change', applyFilters);
    document.getElementById('ap-fil-est').addEventListener('change', applyFilters);
    document.getElementById('ap-fil-q').addEventListener('input', applyFilters);

    // Borrar pedido
    container.querySelectorAll('.ap-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const p  = pedidos.find(x => x.id === id);
        const label = p ? `${p.operacion} ${fmtDate(p.fecha)} — ${p.solicitadoPorNombre || id}` : id;
        if (!confirm(`¿Eliminar el pedido "${label}"?\nEsta acción no se puede deshacer.`)) return;
        try {
          await DEL(`/pedidos/${id}`);
          pedidos = pedidos.filter(x => x.id !== id);
          toast('Pedido eliminado', 'success');
          render(pedidos);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  render(pedidos);
}

// ─── Admin: Base de Datos ─────────────────────────────────────────
function renderAdminDatabase(container) {
  container.innerHTML = `
    <div class="section-title mb-16">Copia de seguridad y restauración</div>
    <div class="card mb-16">
      <div class="card-body">
        <p class="text-muted mb-16" style="font-size:13px">
          La copia incluye todos los usuarios y pedidos de la base de datos en un archivo JSON.
          Úsala para hacer respaldos periódicos o para migrar datos.
        </p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-backup">⬇️ Descargar copia de seguridad</button>
          <span class="text-muted" style="font-size:13px">Descarga un archivo .json con todos los datos</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <p class="text-muted mb-8" style="font-size:13px">
          ⚠️ <strong>Restaurar reemplaza TODOS los datos actuales</strong> con los del archivo seleccionado. Esta acción no se puede deshacer.
        </p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <label class="btn btn-outline" style="cursor:pointer;margin:0">
            📂 Seleccionar archivo de restauración
            <input type="file" id="file-restore" accept=".json" style="display:none">
          </label>
          <span id="restore-filename" class="text-muted" style="font-size:13px">Ningún archivo seleccionado</span>
        </div>
        <button class="btn btn-danger mt-12" id="btn-restore" disabled style="margin-top:12px">🔄 Restaurar base de datos</button>
        <div id="restore-status" style="margin-top:10px;font-size:13px"></div>
      </div>
    </div>`;

  // Backup
  document.getElementById('btn-backup').addEventListener('click', async () => {
    const btn = document.getElementById('btn-backup');
    btn.disabled = true; btn.textContent = '⏳ Descargando...';
    try {
      const res = await fetch(`${API}/admin/backup`, { headers: { Authorization: `Bearer ${S.token}` } });
      if (!res.ok) throw new Error('Error al generar backup');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fecha = new Date().toISOString().split('T')[0];
      a.href = url; a.download = `pedidos-backup-${fecha}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast('Copia descargada correctamente', 'success');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = '⬇️ Descargar copia de seguridad';
  });

  // Restore file select
  let restoreData = null;
  document.getElementById('file-restore').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    document.getElementById('restore-filename').textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        restoreData = JSON.parse(e.target.result);
        if (!Array.isArray(restoreData.users) || !Array.isArray(restoreData.pedidos))
          throw new Error('Formato inválido');
        document.getElementById('restore-status').innerHTML =
          `<span style="color:var(--success)">✔ Archivo válido: ${restoreData.users.length} usuarios, ${restoreData.pedidos.length} pedidos. Exportado: ${restoreData.exportedAt ? new Date(restoreData.exportedAt).toLocaleString('es-CL') : '—'}</span>`;
        document.getElementById('btn-restore').disabled = false;
      } catch {
        document.getElementById('restore-status').innerHTML = `<span style="color:var(--danger)">✕ Archivo inválido. Selecciona un backup generado por este sistema.</span>`;
        document.getElementById('btn-restore').disabled = true;
        restoreData = null;
      }
    };
    reader.readAsText(file);
  });

  // Restore
  document.getElementById('btn-restore').addEventListener('click', async () => {
    if (!restoreData) return;
    if (!confirm(`⚠️ ¿Confirmas la restauración?\n\nEsto reemplazará TODOS los datos actuales con:\n• ${restoreData.users.length} usuarios\n• ${restoreData.pedidos.length} pedidos\n\nEsta acción no se puede deshacer.`)) return;
    const btn = document.getElementById('btn-restore');
    btn.disabled = true; btn.textContent = '⏳ Restaurando...';
    try {
      const result = await POST('/admin/restore', restoreData);
      toast(`Base de datos restaurada: ${result.users} usuarios, ${result.pedidos} pedidos`, 'success');
      document.getElementById('restore-status').innerHTML = `<span style="color:var(--success)">✔ Restauración completada correctamente.</span>`;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = '🔄 Restaurar base de datos';
    }
  });
}

// ─── Ayuda contextual ─────────────────────────────────────────────
function showHelp(view) {
  const h = helpContent[view];
  if (!h) return;

  // CSS reutilizable dentro del modal
  const css = `
    <style>
      .help-section { margin-bottom:18px }
      .help-banner { padding:8px 14px; border-radius:6px; font-weight:700; font-size:13px; margin-bottom:10px }
      .help-step { display:flex; gap:10px; align-items:flex-start; margin-bottom:8px }
      .help-num { min-width:26px; height:26px; border-radius:50%; background:#4361ee; color:#fff;
                  font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center }
      .help-body { font-size:13px; color:#1f2937; line-height:1.5 }
      .help-body strong { color:#1a1f3a }
      .help-note { background:#fef3c7; border:1px solid #fbbf24; border-radius:6px;
                   padding:7px 12px; font-size:12px; color:#92400e; margin-top:6px }
      .help-tip  { background:#f0fdf4; border:1px solid #86efac; border-radius:6px;
                   padding:7px 12px; font-size:12px; color:#166534; margin-top:6px }
      .help-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px }
      .hb { padding:3px 10px; border-radius:20px; font-size:12px; font-weight:700 }
      .help-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px }
      .help-table th { background:#1a1f3a; color:#fff; padding:6px 10px; text-align:left }
      .help-table td { padding:6px 10px; border-bottom:1px solid #e5e7eb; vertical-align:top }
      .help-table tr:nth-child(even) td { background:#f8faff }
    </style>`;

  openModal(h.title, css + h.body, null, { wide: true });
}

const helpContent = {

  'solicitar': {
    title: '📝 Guía — Crear solicitud de pedido',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#eef2ff;color:#3730a3">
          Esta vista te permite crear una solicitud de pedido adicional para tu operación.
        </div>
        <div class="help-step"><div class="help-num">1</div><div class="help-body">
          <strong>Selecciona la Operación y Fecha</strong><br>
          Elige la operación y la fecha del pedido en la parte superior. La fecha determina qué semana se usa para los datos de consumo.
        </div></div>
        <div class="help-step"><div class="help-num">2</div><div class="help-body">
          <strong>Agrega líneas</strong><br>
          Haz clic en <em>"+ Agregar línea"</em> y escribe el código o nombre del ítem para buscarlo. Al seleccionarlo se cargan automáticamente los datos de consumo y costo.
        </div></div>
        <div class="help-step"><div class="help-num">3</div><div class="help-body">
          <strong>Interpreta las columnas de consumo</strong>
          <table class="help-table">
            <tr><th>Columna</th><th>Qué significa</th></tr>
            <tr><td><strong>Cons. Est.</strong></td><td>Consumo estimado de la semana (de la hoja Requisiciones)</td></tr>
            <tr><td><strong>Real Venta</strong></td><td>Consumo real por ventas registradas en el Kardex</td></tr>
            <tr><td><strong>Real Consumo</strong></td><td>Consumo real por producción/transformación en el Kardex</td></tr>
            <tr><td><strong>Variación</strong></td><td>Diferencia entre consumo real y estimado. En <span style="color:#dc2626">rojo</span> si hay exceso.</td></tr>
            <tr><td><strong>Ajuste</strong></td><td>Ajuste manual incluido en la requisición</td></tr>
            <tr><td><strong>Saldo</strong></td><td>Saldo actual del ítem en el sistema</td></tr>
          </table>
        </div></div>
        <div class="help-step"><div class="help-num">4</div><div class="help-body">
          <strong>Ingresa la cantidad solicitada</strong><br>
          Escribe la cantidad que necesitas. Si existe un lote de compra, considera pedirlo en múltiplos.
        </div></div>
        <div class="help-step"><div class="help-num">5</div><div class="help-body">
          <strong>Opciones adicionales</strong><br>
          Marca <strong>Despacho en Exceso</strong> si es una entrega que supera lo normal.<br>
          Marca <strong>Compra Oportunidad</strong> si es una compra aprovechando precio o disponibilidad.
        </div></div>
        <div class="help-step"><div class="help-num">6</div><div class="help-body">
          <strong>Guarda el pedido</strong><br>
          Haz clic en <em>"Guardar Pedido"</em>. El sistema notificará automáticamente a los aprobadores.<br>
          Si todas las líneas cumplen la regla de auto-aprobación, el pedido queda aprobado de inmediato.
        </div></div>
        <div class="help-tip">💡 Usa el botón 📊 junto al ítem para ver su Kardex completo antes de decidir la cantidad.</div>
      </div>`
  },

  'mis-pedidos': {
    title: '📋 Guía — Mis Pedidos',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#eef2ff;color:#3730a3">
          Aquí puedes ver, filtrar y descargar todos tus pedidos.
        </div>
        <div style="margin-bottom:12px">
          <strong style="font-size:13px">Estados del pedido:</strong>
          <div class="help-badges" style="margin-top:8px">
            <span class="hb" style="background:#fef9c3;color:#713f12">SOLICITADO — Esperando aprobación</span>
            <span class="hb" style="background:#dcfce7;color:#14532d">APROBADO — Listo para ser atendido</span>
            <span class="hb" style="background:#fee2e2;color:#7f1d1d">RECHAZADO — No fue aprobado</span>
            <span class="hb" style="background:#fff7ed;color:#7c2d12">REVISAR — El aprobador pide ajustes</span>
            <span class="hb" style="background:#dbeafe;color:#1e3a8a">ATENDIDO — Completamente atendido</span>
          </div>
        </div>
        <div class="help-step"><div class="help-num">✏</div><div class="help-body">
          <strong>Editar un pedido</strong><br>
          Solo puedes editar pedidos en estado <strong>SOLICITADO</strong> o <strong>REVISAR</strong>. Usa el botón <em>"✏️ Editar"</em> en la cabecera del pedido.
        </div></div>
        <div class="help-step"><div class="help-num">🔍</div><div class="help-body">
          <strong>Filtrar pedidos</strong><br>
          Usa los filtros de <strong>Estado</strong>, <strong>Operación</strong>, <strong>Desde</strong> y <strong>Hasta</strong> para encontrar pedidos por rango de fechas. El botón <em>"✕ Limpiar"</em> restablece todos los filtros.
        </div></div>
        <div class="help-step"><div class="help-num">☑</div><div class="help-body">
          <strong>Seleccionar y descargar a Excel</strong><br>
          Marca el checkbox de cada pedido que quieras exportar (o usa <em>"Seleccionar todos"</em>). Aparece el botón <strong>⬇️ Descargar Excel</strong> con el detalle completo de las líneas.
        </div></div>
        <div class="help-note">⚠ Un pedido en REVISAR aún puede ser editado y re-enviado. Las líneas ya aprobadas o rechazadas por el aprobador no se pueden modificar.</div>
      </div>`
  },

  'aprobar': {
    title: '✅ Guía — Aprobar Pedidos',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#f0fdf4;color:#14532d">
          Aquí revisas y decides el estado de cada línea de los pedidos solicitados.
        </div>
        <div class="help-step"><div class="help-num">1</div><div class="help-body">
          <strong>Revisar las líneas</strong><br>
          Cada pedido muestra sus ítems con los datos de consumo estimado vs real, variación, saldo y costo. Analiza si la cantidad solicitada es justificada.
        </div></div>
        <div class="help-step"><div class="help-num">2</div><div class="help-body">
          <strong>Asignar estado a cada línea</strong><br>
          Usa el selector de cada línea para elegir:
          <div class="help-badges" style="margin-top:6px">
            <span class="hb" style="background:#dcfce7;color:#14532d">✅ APROBADO</span>
            <span class="hb" style="background:#fee2e2;color:#7f1d1d">❌ RECHAZADO</span>
            <span class="hb" style="background:#fff7ed;color:#7c2d12">🔄 REVISAR</span>
          </div>
        </div></div>
        <div class="help-step"><div class="help-num">3</div><div class="help-body">
          <strong>Agregar comentario (opcional pero recomendado)</strong><br>
          Si rechazas o envías a revisión, escribe el motivo en el campo de comentario. El solicitante lo verá y recibirá una notificación.
        </div></div>
        <div class="help-step"><div class="help-num">4</div><div class="help-body">
          <strong>Guardar la decisión</strong><br>
          Haz clic en <em>"Guardar aprobación"</em>. El sistema notificará al solicitante y, si el pedido queda aprobado, también a Compras y/o Planta según la gestión de cada ítem.
        </div></div>
        <table class="help-table">
          <tr><th>Resultado final</th><th>Cuándo ocurre</th></tr>
          <tr><td><strong>APROBADO</strong></td><td>Todas las líneas aprobadas (incluye auto-aprobadas)</td></tr>
          <tr><td><strong>RECHAZADO</strong></td><td>Todas las líneas rechazadas</td></tr>
          <tr><td><strong>REVISAR</strong></td><td>Al menos una línea en estado REVISAR</td></tr>
        </table>
        <div class="help-note">⚠ Las líneas marcadas como <strong>🔒 Auto-aprobado</strong> no pueden ser modificadas — fueron aprobadas automáticamente por el sistema.</div>
      </div>`
  },

  'atender': {
    title: '🚚 Guía — Atender Pedidos',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#f0f9ff;color:#0c4a6e">
          Aquí ves los pedidos aprobados y marcas cada ítem de tu gestión como atendido.
        </div>
        <div class="help-step"><div class="help-num">1</div><div class="help-body">
          <strong>Ver solo tus ítems</strong><br>
          Solo ves y puedes marcar las líneas de tu gestión:<br>
          • <strong>Compras</strong> → ítems con gestión COMPRAS<br>
          • <strong>Planta</strong> → ítems con gestión PLANTA<br>
          Las líneas de la otra gestión aparecen en gris (solo lectura).
        </div></div>
        <div class="help-step"><div class="help-num">2</div><div class="help-body">
          <strong>Marcar como atendido</strong><br>
          Marca el checkbox <em>"Atendido"</em> de cada línea que hayas despachado o gestionado. Haz clic en <em>"Guardar atención"</em> al terminar.
        </div></div>
        <div class="help-step"><div class="help-num">3</div><div class="help-body">
          <strong>El pedido se cierra automáticamente</strong><br>
          Cuando todas las líneas aprobadas estén marcadas como atendidas (tanto Compras como Planta), el pedido pasa a estado <strong>ATENDIDO</strong> y el solicitante recibe una notificación.
        </div></div>
        <div class="help-note">⚠ Una línea marcada como <strong>Atendido</strong> no puede desmarcarse. Verifica antes de guardar.</div>
        <div class="help-tip">💡 Puedes atender parcialmente: guardar algunas líneas hoy y el resto después. El pedido permanece en APROBADO hasta que todas estén atendidas.</div>
      </div>`
  },

  'admin': {
    title: '⚙️ Guía — Administración',
    body: `
      <div class="help-section">
        <table class="help-table">
          <tr><th>Pestaña</th><th>Qué puedes hacer</th></tr>
          <tr><td><strong>👥 Usuarios</strong></td><td>Crear, editar y desactivar usuarios. Asignar rol y operaciones. Ingresar el correo para que reciban notificaciones por email.</td></tr>
          <tr><td><strong>📦 Maestro Items</strong></td><td>Ver y editar el lote de compra y la gestión (Compras/Planta) de cada ítem por operación. Estos datos complementan el Excel.</td></tr>
          <tr><td><strong>📁 Archivos Excel</strong></td><td>Subir los archivos <em>{OPERACION} - ADICIONALES.xlsx</em> con las hojas Items, Kardex, Costos y Requisiciones.</td></tr>
          <tr><td><strong>📋 Todos los Pedidos</strong></td><td>Ver, filtrar y eliminar cualquier pedido del sistema (solo Admin).</td></tr>
          <tr><td><strong>🗄️ Base de Datos</strong></td><td>Exportar e importar backup completo de usuarios y pedidos.</td></tr>
          <tr><td><strong>⚙️ Configuración</strong></td><td>Ajustar el % de variación para auto-aprobación y configurar el servidor SMTP para envío de correos.</td></tr>
        </table>
        <div style="margin-top:14px">
          <strong style="font-size:13px">Roles del sistema:</strong>
          <table class="help-table" style="margin-top:6px">
            <tr><th>Rol</th><th>Qué puede hacer</th></tr>
            <tr><td><strong>ADMIN</strong></td><td>Acceso total. Puede aprobar, atender y gestionar todo.</td></tr>
            <tr><td><strong>Solicitador</strong></td><td>Crea pedidos y ve solo los suyos.</td></tr>
            <tr><td><strong>Aprobador</strong></td><td>Aprueba o rechaza pedidos de sus operaciones.</td></tr>
            <tr><td><strong>Compras</strong></td><td>Atiende líneas de gestión COMPRAS.</td></tr>
            <tr><td><strong>Planta</strong></td><td>Atiende líneas de gestión PLANTA.</td></tr>
          </table>
        </div>
        <div class="help-note">⚠ El formato del Excel debe tener exactamente las hojas: <strong>Items, Kardex, Costos, Requisiciones</strong> con las columnas en el orden correcto.</div>
      </div>`
  },

  'kardex': {
    title: '📊 Guía — Kardex',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#eef2ff;color:#3730a3">
          Consulta el movimiento histórico de cualquier ítem semana a semana.
        </div>
        <div class="help-step"><div class="help-num">1</div><div class="help-body">
          <strong>Selecciona la operación</strong><br>
          Haz clic en la pestaña de la operación que quieres consultar.
        </div></div>
        <div class="help-step"><div class="help-num">2</div><div class="help-body">
          <strong>Busca el ítem</strong><br>
          Escribe el código o nombre del ítem en el buscador. Selecciónalo de la lista desplegable.
        </div></div>
        <div class="help-step"><div class="help-num">3</div><div class="help-body">
          <strong>Interpreta la tabla</strong><br>
          Cada columna es una semana (formato AAAA-SS). Las filas muestran:
          <table class="help-table" style="margin-top:6px">
            <tr><th>Fila</th><th>Significado</th></tr>
            <tr><td><strong>SALDO INICIAL</strong></td><td>Stock acumulado al inicio de esa semana</td></tr>
            <tr><td>COMPRA, PRODUCCION…</td><td>Entradas al inventario</td></tr>
            <tr><td>VENTA, CONSUMO…</td><td>Salidas del inventario</td></tr>
            <tr><td>SOBRANTE / FALTANTE</td><td>Ajustes de inventario</td></tr>
            <tr><td><strong>SALDO FINAL</strong></td><td>Stock al cierre de esa semana</td></tr>
          </table>
        </div></div>
        <div class="help-tip">💡 También puedes ver el Kardex de un ítem directamente desde la pantalla de Solicitar, haciendo clic en el botón 📊 junto a cada línea.</div>
      </div>`
  },

  'precios': {
    title: '💰 Guía — Consulta de Precios',
    body: `
      <div class="help-section">
        <div class="help-banner" style="background:#f0fdf4;color:#166534">
          Consulta el histórico de precios de compra por ítem, filtrado por grupo y análisis Pareto.
        </div>
        <div class="help-step"><div class="help-num">1</div><div class="help-body">
          <strong>Selecciona la Sociedad</strong><br>
          Elige la empresa (100, 500 o 700) para la que quieres ver precios.
        </div></div>
        <div class="help-step"><div class="help-num">2</div><div class="help-body">
          <strong>Filtra por Grupo de Compra</strong><br>
          Opcional. Muestra solo los ítems de esa categoría (ABARROTES, LIMPIEZA, etc.).
        </div></div>
        <div class="help-step"><div class="help-num">3</div><div class="help-body">
          <strong>Ajusta el % Pareto</strong><br>
          El slider define qué ítems son "clave". Por ejemplo, al 80% verás solo los ítems que representan el 80% del gasto del grupo. El resto aparece resumido como "Otros".
        </div></div>
        <div class="help-step"><div class="help-num">4</div><div class="help-body">
          <strong>Define las últimas N compras</strong><br>
          Cuántas compras históricas ver al hacer clic en un ítem (5, 10, 20, 50 o 100).
        </div></div>
        <div class="help-step"><div class="help-num">5</div><div class="help-body">
          <strong>Haz clic en un ítem</strong><br>
          Se despliega el detalle con: Fecha · Operación · Almacén · Cantidad · Importe · <strong>Precio Unitario</strong>
        </div></div>
        <div class="help-note">⚠ El Precio Unitario se calcula como <strong>Importe ÷ Cantidad</strong>. Si la cantidad es 0, el precio aparece como —.</div>
      </div>`
  }
};

// ─── View: Precios de Compra ──────────────────────────────────────
async function viewPrecios(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">💰 Precios de Compra</div>
      <button class="btn btn-outline btn-sm" onclick="showHelp('precios')">❓ Ayuda</button>
    </div>
    <div class="page-body">
      <div class="card mb-16" style="padding:16px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Operación</label>
            <select id="pr-operacion" class="form-control" style="width:160px">
              <option value="">Cargando...</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Grupo</label>
            <select id="pr-grupo-item" class="form-control" style="width:160px">
              <option value="">Todos</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Grupo Compra</label>
            <select id="pr-grupo" class="form-control" style="width:180px">
              <option value="">Todos los grupos</option>
            </select>
          </div>
          <div style="flex:1;min-width:200px">
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">
              Pareto: items que representan el <strong id="pr-pct-label">80</strong>% de las compras del grupo
            </label>
            <input type="range" id="pr-pareto" min="50" max="100" step="5" value="80"
              style="width:100%;accent-color:var(--primary)">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Últimas N semanas</label>
            <select id="pr-n" class="form-control" style="width:110px">
              <option value="4">4 sem (1 mes)</option>
              <option value="8" selected>8 sem (2 meses)</option>
              <option value="13">13 sem (3 meses)</option>
              <option value="26">26 sem (6 meses)</option>
              <option value="52">52 sem (1 año)</option>
            </select>
          </div>
        </div>
      </div>
      <div id="pr-result"></div>
    </div>`;

  // Cargar operaciones y luego grupos filtrados por la operación por omisión
  try {
    const ops = await GET('/compras/operaciones');

    // Operaciones
    const selOper = document.getElementById('pr-operacion');
    selOper.innerHTML = '<option value="">Todas las operaciones</option>';
    if (ops.length === 0) {
      selOper.innerHTML = '<option value="">Sin datos</option>';
    } else {
      ops.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = String(o);
        selOper.appendChild(opt);
      });
      selOper.selectedIndex = 1;
    }

    // Cargar grupos filtrados por la operación seleccionada por omisión
    const operDefault = selOper.value;
    const [gruposItem, gruposCompra] = await Promise.all([
      GET(operDefault ? `/compras/grupos-item?operacion=${encodeURIComponent(operDefault)}` : '/compras/grupos-item'),
      GET(operDefault ? `/compras/grupos?operacion=${encodeURIComponent(operDefault)}` : '/compras/grupos'),
    ]);
    cargarGruposItem(gruposItem);
    cargarGrupos(gruposCompra);

    // Cascada: Operación → recarga Grupo y Grupo Compra, luego busca
    selOper.addEventListener('change', async () => {
      const oper = selOper.value;
      try {
        const [gi, gc] = await Promise.all([
          GET(oper ? `/compras/grupos-item?operacion=${encodeURIComponent(oper)}` : '/compras/grupos-item'),
          GET(oper ? `/compras/grupos?operacion=${encodeURIComponent(oper)}` : '/compras/grupos'),
        ]);
        cargarGruposItem(gi);
        cargarGrupos(gc);
      } catch (_) {}
      buscarPrecios();
    });

    // Cascada: Grupo → recarga Grupo Compra, luego busca
    document.getElementById('pr-grupo-item').addEventListener('change', async () => {
      const oper = selOper.value;
      const grp  = document.getElementById('pr-grupo-item').value;
      try {
        const params = new URLSearchParams();
        if (oper) params.set('operacion', oper);
        if (grp)  params.set('grupoItem', grp);
        const gc = await GET(`/compras/grupos?${params}`);
        cargarGrupos(gc);
      } catch (_) {}
      buscarPrecios();
    });

  } catch (err) {
    document.getElementById('pr-operacion').innerHTML = '<option value="">Error al cargar</option>';
    toast('Error cargando filtros: ' + err.message, 'error');
  }

  function cargarGruposItem(lista) {
    const sel = document.getElementById('pr-grupo-item');
    sel.innerHTML = '<option value="">Todos</option>';
    lista.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
  }

  function cargarGrupos(lista) {
    const sel = document.getElementById('pr-grupo');
    sel.innerHTML = '<option value="">Todos los grupos</option>';
    lista.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
  }

  // Slider label + debounce al soltar
  let _paretoTimer = null;
  document.getElementById('pr-pareto').addEventListener('input', e => {
    document.getElementById('pr-pct-label').textContent = e.target.value;
    clearTimeout(_paretoTimer);
    _paretoTimer = setTimeout(() => buscarPrecios(), 600);
  });

  // Auto-buscar al cambiar cualquier selector
  ['pr-operacion', 'pr-grupo-item', 'pr-grupo', 'pr-n'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => buscarPrecios());
  });

  async function buscarPrecios() {
    const operacion  = document.getElementById('pr-operacion').value;
    const grupoItem  = document.getElementById('pr-grupo-item').value;
    const grupo      = document.getElementById('pr-grupo').value;
    const pareto     = document.getElementById('pr-pareto').value;
    const n          = document.getElementById('pr-n').value;
    const res        = document.getElementById('pr-result');

    res.innerHTML = `<div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span> Consultando...</div>`;

    try {
      const params = new URLSearchParams({ pareto });
      if (operacion) params.set('operacion', operacion);
      if (grupoItem) params.set('grupoItem', grupoItem);
      if (grupo)     params.set('grupo', grupo);
      const data = await GET(`/compras/items?${params}`);
      renderPreciosResult(res, data, operacion, n, pareto);
    } catch (err) {
      res.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Error: ${esc(err.message)}</p></div>`;
    }
  }

  function renderPreciosResult(container, data, operacion, n, pareto) {
    const { items, otros } = data;
    if (!items.length && !otros.count) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos para los filtros seleccionados</p></div>`;
      return;
    }

    const nSemanas = Math.max(parseInt(n) || 8, 1);
    const desdeDate = new Date(Date.now() - nSemanas * 7 * 24 * 60 * 60 * 1000);
    const desdeISO  = desdeDate.toISOString();
    const nCols  = 10;
    const pct2   = v => (v * 100).toFixed(1) + '%';
    const fmtP   = v => v == null ? '—' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Devuelve {html, code} — code: 'g','y','r','n'
    function semaforo(ultimo, ref) {
      if (ultimo == null || ref == null || ref === 0) return { html: '<span style="color:#9ca3af">—</span>', code: 'n' };
      const diff = (ultimo - ref) / ref;
      if (diff <= 0)    return { html: '<span style="font-size:18px" title="Igual o menor">🟢</span>',        code: 'g' };
      if (diff <= 0.10) return { html: '<span style="font-size:18px" title="Aumento hasta 10%">🟡</span>',    code: 'y' };
      return                   { html: '<span style="font-size:18px" title="Aumento mayor al 10%">🔴</span>', code: 'r' };
    }

    const fmtImp = v => v == null ? '—' : 'S/ ' + Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const selStyle = 'width:100%;font-size:11px;padding:2px 4px;border:1px solid #d1d5db;border-radius:3px;background:#fff';

    const filterRow = `
      <tr style="background:#f0f4ff">
        <td></td>
        <td style="padding:3px 6px">
          <input id="pr-f-txt" placeholder="Descripción…" style="${selStyle}" type="text">
        </td>
        <td></td><td></td>
        <td style="padding:3px 4px">
          <select id="pr-f-s1" style="${selStyle}">
            <option value="">🚦</option><option value="g">🟢</option>
            <option value="y">🟡</option><option value="r">🔴</option>
          </select>
        </td>
        <td style="padding:3px 4px">
          <select id="pr-f-s2" style="${selStyle}">
            <option value="">🚦</option><option value="g">🟢</option>
            <option value="y">🟡</option><option value="r">🔴</option>
          </select>
        </td>
        <td colspan="${nCols + 4}"></td>
      </tr>`;

    const priceHeaders = Array.from({ length: nCols }, (_, i) =>
      `<th style="text-align:right;min-width:85px;font-size:10px;white-space:nowrap">${i === 0 ? '★ Último' : 'P' + (i + 1)}</th>`
    ).join('');

    const rows = items.map(it => {
      const priceCells = Array.from({ length: nCols }, (_, i) =>
        `<td id="pr-p${i}-${it.item}" style="text-align:right;font-size:12px;color:#d1d5db">·</td>`
      ).join('');
      const acumVal = (it.pctGrupoAcum * 100).toFixed(1);
      return `
      <tr data-item="${it.item}" data-s1="" data-s2="" data-nombre="${esc((it.nombre||'').toLowerCase())}">
        <td style="font-family:monospace;font-size:12px;white-space:nowrap">${it.item}</td>
        <td><strong style="font-size:13px">${esc(it.nombre || '')}</strong></td>
        <td style="text-align:right;font-size:12px">${pct2(it.pctGrupo)}</td>
        <td style="text-align:right;font-size:12px">${acumVal}%</td>
        <td id="pr-s1-${it.item}" style="text-align:center">·</td>
        <td id="pr-s2-${it.item}" style="text-align:center">·</td>
        <td id="pr-tsem-${it.item}" style="text-align:right;font-size:12px;color:#d1d5db">·</td>
        <td id="pr-total-${it.item}" style="text-align:right;font-size:12px;color:#d1d5db">·</td>
        <td id="pr-prom-${it.item}" style="text-align:right;font-size:12px;color:#d1d5db">·</td>
        <td style="text-align:center">
          <button onclick="verComprasItem(${it.item},'${esc(it.nombre||'')}','${encodeURIComponent(operacion)}')"
            style="font-size:11px;padding:2px 7px;border:1px solid var(--primary);border-radius:4px;background:#fff;color:var(--primary);cursor:pointer">
            📋 Ver
          </button>
        </td>
        ${priceCells}
      </tr>`;
    }).join('');

    const otrosRow = otros.count > 0 ? `
      <tr style="background:#f9fafb;color:var(--text-muted)">
        <td colspan="4" style="font-style:italic;font-size:12px;padding:10px 12px">
          Otros (${otros.count} items — fuera del ${pareto}% Pareto)
        </td>
        <td colspan="${6 + nCols}"></td>
      </tr>` : '';

    container.innerHTML = `
      <div style="margin-bottom:8px;font-size:13px;color:var(--text-muted)">
        ${items.length} items en el ${pareto}% Pareto &nbsp;·&nbsp;
        <span style="font-size:11px">🟢 igual/menor &nbsp; 🟡 +0–10% &nbsp; 🔴 +más de 10%</span>
      </div>
      <div class="table-wrap" style="overflow-x:auto">
        <table style="min-width:1000px">
          <thead>
            <tr>
              <th style="min-width:80px">Código</th>
              <th style="min-width:200px">Descripción</th>
              <th style="text-align:right;min-width:70px">% Grupo</th>
              <th style="text-align:right;min-width:90px">% Acumulado</th>
              <th style="text-align:center;min-width:52px" title="Último precio vs precio anterior">🚦 Ant.</th>
              <th style="text-align:center;min-width:52px" title="Último precio vs promedio ponderado">🚦 Prom.</th>
              <th style="text-align:right;min-width:100px">Últ. Compra</th>
              <th style="text-align:right;min-width:110px">Total Histórico</th>
              <th style="text-align:right;min-width:100px">Prom. Pond. (${n}sem.)</th>
              <th style="min-width:60px"></th>
              ${priceHeaders}
            </tr>
            ${filterRow}
          </thead>
          <tbody>${rows}${otrosRow}</tbody>
        </table>
      </div>`;

    // Filtrado
    function applyFilters() {
      const txt = (document.getElementById('pr-f-txt')?.value || '').toLowerCase();
      const fS1 = document.getElementById('pr-f-s1')?.value || '';
      const fS2 = document.getElementById('pr-f-s2')?.value || '';
      container.querySelectorAll('tr[data-item]').forEach(row => {
        const ok = (!txt || row.dataset.nombre.includes(txt) || row.dataset.item.includes(txt))
                && (!fS1 || row.dataset.s1 === fS1)
                && (!fS2 || row.dataset.s2 === fS2);
        row.style.display = ok ? '' : 'none';
      });
    }
    document.getElementById('pr-f-txt').addEventListener('input', applyFilters);
    document.getElementById('pr-f-s1').addEventListener('change', applyFilters);
    document.getElementById('pr-f-s2').addEventListener('change', applyFilters);

    // Cargar precios en paralelo — compras de las últimas nSemanas semanas
    items.forEach(async it => {
      try {
        const operParam = encodeURIComponent(operacion);
        const [compras, totData] = await Promise.all([
          GET(`/compras/precios/${it.item}?operacion=${operParam}&desde=${encodeURIComponent(desdeISO)}`),
          GET(`/compras/total/${it.item}?operacion=${operParam}`),
        ]);

        // Columnas de precio
        for (let i = 0; i < nCols; i++) {
          const cell = document.getElementById(`pr-p${i}-${it.item}`);
          if (!cell) continue;
          const c = compras[i];
          if (c && c.precioUnitario != null) {
            cell.textContent = fmtP(c.precioUnitario);
            cell.style.color = i === 0 ? 'var(--primary)' : '';
            if (i === 0) cell.style.fontWeight = '700';
          } else { cell.textContent = '—'; cell.style.color = '#d1d5db'; }
        }

        const row      = container.querySelector(`tr[data-item="${it.item}"]`);
        const ultimo   = compras[0]?.precioUnitario ?? null;
        const anterior = compras[1]?.precioUnitario ?? null;

        // Importe de la última compra
        const ultImporte = compras[0]?.importe ?? null;
        const tSemCell = document.getElementById(`pr-tsem-${it.item}`);
        if (tSemCell) { tSemCell.textContent = ultImporte != null ? fmtImp(ultImporte) : '—'; tSemCell.style.color = ''; }

        // Total histórico
        const totalCell = document.getElementById(`pr-total-${it.item}`);
        if (totalCell) { totalCell.textContent = totData.total != null ? fmtImp(totData.total) : '—'; totalCell.style.color = ''; }

        // Promedio ponderado de las N semanas
        let totImp = 0, totCant = 0;
        compras.forEach(c => { totImp += c.importe || 0; totCant += c.cantidad || 0; });
        const promPonderado = totCant > 0 ? totImp / totCant : null;
        const promCell = document.getElementById(`pr-prom-${it.item}`);
        if (promCell) { promCell.textContent = fmtP(promPonderado); promCell.style.color = ''; }

        // Semáforos
        const s1res = semaforo(ultimo, anterior);
        const s1el  = document.getElementById(`pr-s1-${it.item}`);
        if (s1el) s1el.innerHTML = s1res.html;
        if (row)  { row.dataset.s1 = s1res.code; }

        const s2res = semaforo(ultimo, promPonderado);
        const s2el  = document.getElementById(`pr-s2-${it.item}`);
        if (s2el) s2el.innerHTML = s2res.html;
        if (row)  { row.dataset.s2 = s2res.code; applyFilters(); }

      } catch (_) {
        for (let i = 0; i < nCols; i++) {
          const cell = document.getElementById(`pr-p${i}-${it.item}`);
          if (cell) { cell.textContent = '!'; cell.style.color = 'var(--danger)'; }
        }
      }
    });
  }

  // Modal: ver todas las compras de un item
  window.verComprasItem = async function(itemId, nombre, operEnc) {
    const operacion  = decodeURIComponent(operEnc);
    // Leer N directamente del selector en la cabecera en el momento de abrir
    const nSemanas   = Math.max(parseInt(document.getElementById('pr-n')?.value) || 8, 1);
    const desdeModal = new Date(Date.now() - nSemanas * 7 * 24 * 60 * 60 * 1000).toISOString();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;width:90%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-weight:700;font-size:15px">#${itemId} — ${esc(nombre)}</div>
            <div style="font-size:12px;color:var(--text-muted)">
              ${operacion ? 'Operación: ' + esc(operacion) + ' · ' : ''}Últimas ${nSemanas} semanas
            </div>
          </div>
          <button id="pr-modal-close" style="font-size:20px;background:none;border:none;cursor:pointer;color:#6b7280">✕</button>
        </div>
        <div id="pr-modal-body" style="overflow-y:auto;padding:16px">
          <div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pr-modal-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    try {
      const compras = await GET(`/compras/precios/${itemId}?operacion=${encodeURIComponent(operacion)}&desde=${encodeURIComponent(desdeModal)}`);
      const body = overlay.querySelector('#pr-modal-body');
      const fmtP2 = v => v == null ? '—' : Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (!compras.length) { body.innerHTML = '<p style="color:var(--text-muted)">Sin compras en las últimas ' + nSemanas + ' semanas</p>'; return; }
      body.innerHTML = `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${compras.length} compras en las últimas ${nSemanas} semanas</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#e0e7ff">
            <th style="padding:6px 10px;text-align:left">Fecha</th>
            <th style="padding:6px 10px;text-align:left">Operación</th>
            <th style="padding:6px 10px;text-align:left">Almacén</th>
            <th style="padding:6px 10px;text-align:right">Cantidad</th>
            <th style="padding:6px 10px;text-align:right">Importe</th>
            <th style="padding:6px 10px;text-align:right">Precio Unit.</th>
          </tr></thead>
          <tbody>
            ${compras.map((c, i) => `
              <tr style="background:${i%2?'#f9fafb':'#fff'}">
                <td style="padding:5px 10px;white-space:nowrap">${fmtDate(c.fecha)}</td>
                <td style="padding:5px 10px">${esc(c.operacion||'')}</td>
                <td style="padding:5px 10px">${esc(c.almacen||'')}</td>
                <td style="padding:5px 10px;text-align:right">${fmtP2(c.cantidad)}</td>
                <td style="padding:5px 10px;text-align:right">S/ ${fmtP2(c.importe)}</td>
                <td style="padding:5px 10px;text-align:right;font-weight:700;color:var(--primary)">S/ ${fmtP2(c.precioUnitario)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (err) {
      overlay.querySelector('#pr-modal-body').innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message)}</p>`;
    }
  };
}

// ─── Export / Print helpers ───────────────────────────────────────

async function exportarExcel(pedidos, gestion = '') {
  if (!pedidos.length) { toast('No hay datos para exportar', 'error'); return; }
  const btn = document.getElementById('btn-export-all') || document.getElementById('btn-export');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const res = await fetch(`${API}/pedidos/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` },
      body: JSON.stringify({ ids: pedidos.map(p => p.id), gestion: gestion || undefined })
    });
    if (res.status === 401) {
      S.user = null; S.token = null;
      localStorage.removeItem('ebc_token'); localStorage.removeItem('ebc_user');
      document.getElementById('app').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      toast('Tu sesión expiró.', 'error'); return;
    }
    if (!res.ok) { const d = await res.json().catch(() => {}); throw new Error(d?.error || 'Error al exportar'); }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `pedidos-${today()}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    toast(`✅ Exportando ${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '📥 Excel'; }
}

function imprimirPedidos(pedidos, titulo = 'EBC — Pedidos Adicionales', gestion = '') {
  if (!pedidos.length) { toast('No hay datos para imprimir', 'error'); return; }

  const filas = pedidos.flatMap(p => {
    const lineas = gestion
      ? (p.lineas || []).filter(l => (l.gestion || 'COMPRAS') === gestion)
      : (p.lineas || []);
    if (!lineas.length) return [];
    return lineas.map((l, i) => `
      <tr>
        ${i === 0
          ? `<td rowspan="${lineas.length}" style="vertical-align:top;border-top:2px solid #c7d2fe">
               <strong>${esc(fmtDate(p.fechaPedido))}</strong><br>
               <span style="font-size:10px">${esc(p.operacion)}</span><br>
               <span style="font-size:10px;color:#6b7280">${esc(p.solicitadoPorNombre||'')}</span><br>
               <span class="badge">${p.estado}</span>
             </td>`
          : ''}
        <td style="font-family:monospace;font-size:10px;white-space:nowrap">${esc(l.item || '')}</td>
        <td><strong style="font-size:11px">${esc(l.itemNombre || '')}</strong></td>
        <td style="font-size:11px">${esc(l.grupoCompra || '')}</td>
        <td style="text-align:right;font-weight:600">${l.cantidadSolicitada != null ? l.cantidadSolicitada : ''}</td>
        <td style="font-size:10px">${esc(l.comentarios || '')}</td>
        <td style="font-size:10px;color:#374151">${esc(l.comentarioAprobador || '')}</td>
        <td style="font-size:10px">${l.estadoLinea ? `<span class="badge">${l.estadoLinea}</span>` : ''}</td>
      </tr>`);
  }).join('');

  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${titulo}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 16px; }
      h2 { font-size: 16px; color: #1a1f3a; margin-bottom: 4px; }
      .meta { font-size: 11px; color: #6b7280; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #1a1f3a; color: white; padding: 6px 8px; text-align: left; font-size: 10px; white-space: nowrap; }
      td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
      tr:nth-child(even) td { background: #f9fafb; }
      .badge { display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px;
               background:#e0e7ff; color:#3730a3; font-weight:600; }
      @media print { @page { margin: 1cm; } body { padding: 0; } }
    </style>
  </head><body>
    <h2>${titulo}</h2>
    <div class="meta">
      Generado: ${new Date().toLocaleString('es-CL')}
      ${gestion ? ` &nbsp;·&nbsp; Gestión: <strong>${gestion}</strong>` : ''}
      &nbsp;·&nbsp; ${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''}
    </div>
    <table>
      <thead><tr>
        <th>Pedido</th><th>Código</th><th>Descripción</th>
        <th>Grupo</th><th>Cantidad</th>
        <th>Comentarios</th><th>Coment. Aprobador</th><th>Estado Línea</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </body></html>`;

  const win = window.open('', '_blank', 'width=1050,height=750');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// ─── Genérico: Imprimir / Exportar a Excel lo visible en un contenedor ───
// Captura las tablas (<table>) renderizadas dentro de #containerId tal
// como se ven en pantalla (filtros aplicados, agrupaciones, etc).
function imprimirVista(containerId, titulo) {
  const cont   = document.getElementById(containerId);
  const tablas = cont ? [...cont.querySelectorAll('table')] : [];
  if (!tablas.length) { toast('No hay datos para imprimir', 'error'); return; }

  const tablasHtml = tablas.map(t => t.outerHTML).join('<div style="height:18px"></div>');
  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${esc(titulo)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 16px; }
      h2 { font-size: 16px; color: #1a1f3a; margin-bottom: 4px; }
      .meta { font-size: 11px; color: #6b7280; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #1a1f3a; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; white-space: nowrap; }
      td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; font-size: 11px; }
      tr:nth-child(even) td { background: #f9fafb; }
      button, input, select, textarea, .btn { display: none !important; }
      @media print { @page { margin: 1cm; } body { padding: 0; } }
    </style>
  </head><body>
    <h2>${esc(titulo)}</h2>
    <div class="meta">Generado: ${new Date().toLocaleString('es-PE')}</div>
    ${tablasHtml}
  </body></html>`;

  const win = window.open('', '_blank', 'width=1100,height=750');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function exportarVistaExcel(containerId, nombreArchivo) {
  const cont   = document.getElementById(containerId);
  const tablas = cont ? [...cont.querySelectorAll('table')] : [];
  if (!tablas.length) { toast('No hay datos para exportar', 'error'); return; }

  const csvCell = s => {
    const v = String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    return `"${v.replace(/"/g, '""')}"`;
  };
  let csv = '';
  tablas.forEach((t, ti) => {
    if (ti) csv += '\r\n';
    [...t.rows].forEach(row => {
      const cells = [...row.cells]
        .filter(c => getComputedStyle(c).display !== 'none')
        .map(c => csvCell(c.innerText || c.textContent || ''));
      if (cells.length) csv += cells.join(',') + '\r\n';
    });
  });

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${nombreArchivo}-${today()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('✅ Exportando a Excel', 'success');
}

// ─── App Init ─────────────────────────────────────────────────────
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('sb-user').textContent = S.user.username;
  document.getElementById('sb-role').textContent = ROLE_LABELS[S.user.role] || S.user.role;
  // Si el prompt ya estaba listo antes del login, mostrar el botón ahora
  if (_installPrompt) document.getElementById('install-btn').classList.remove('hidden');
  // Botón Comentarios en sidebar footer: visible para todos los roles
  document.getElementById('sb-comentarios-btn').style.display = '';
  renderNav();
  // Navigate to default view
  const role = S.user.role;
  if ([ROLES.SOL, ROLES.ADMIN].includes(role)) navigate('solicitar');
  else if (role === ROLES.APR) navigate('aprobar');
  else if (role === ROLES.ATE || role === ROLES.PLT) navigate('atender');
  else if (role === ROLES.CONS) {
    if (S.user.puedeVerKardex) navigate('kardex');
    else if (S.user.sociedadesCompra?.length) navigate('precios');
    else navigate('comentarios');
  }
  // Inicializar push notifications (sin bloquear)
  initPush().catch(() => {});
  // Renovar token al arrancar y cada 30 minutos
  startTokenRefresh();
}

// ─── PWA: Install prompt ─────────────────────────────────────────
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();               // Evita el banner automático del browser
  _installPrompt = e;               // Guardamos el evento para usarlo después
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.add('hidden');
  toast('✅ App instalada correctamente', 'success');
});

// ─── PWA: Service Worker + Push Notifications ────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    // Escuchar mensajes del SW (navegación desde notificación)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE') {
        const hash = (e.data.url || '').replace(/^.*#/, '');
        if (hash) navigate(hash);
      }
    });

    // Obtener clave pública VAPID
    let vapidKey;
    try {
      const r = await GET('/push/vapid-public-key');
      vapidKey = r.key;
    } catch { return; }
    if (!vapidKey) return;

    // Verificar o crear suscripción
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission === 'denied') {
        console.warn('Notificaciones bloqueadas. Ve a Configuración del sitio para habilitarlas.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
    }
    // Registrar/actualizar suscripción en el servidor
    await POST('/push/subscribe', { subscription: sub.toJSON() });
  } catch (err) {
    console.warn('Push init error:', err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Restore session
  if (restoreSession()) {
    if (S.user.mustChangePassword) showChangePasswordModal();
    else showApp();
  }

  // Login form
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Ingresando...';
    try {
      const result = await login(document.getElementById('l-user').value, document.getElementById('l-pass').value);
      if (result.mustChangePassword) showChangePasswordModal();
      else showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });

  // Instalar PWA
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!_installPrompt) return;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === 'accepted') {
      _installPrompt = null;
      document.getElementById('install-btn').classList.add('hidden');
    }
  });

  // Comentarios (acceso rápido desde footer sidebar)
  document.getElementById('sb-comentarios-btn').addEventListener('click', () => navigate('comentarios'));

  // Cambiar contraseña
  document.getElementById('chpwd-btn-sidebar').addEventListener('click', showCambiarPasswordModal);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Hard refresh (bottom nav mobile)
  document.getElementById('bn-refresh-btn').addEventListener('click', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        Promise.all(regs.map(r => r.unregister())).then(() => location.reload(true));
      });
    } else {
      location.reload(true);
    }
  });
});

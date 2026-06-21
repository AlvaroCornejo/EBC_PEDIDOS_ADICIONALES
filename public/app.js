/* ═══════════════════════════════════════════════════════════════
   Sistema de Pedidos — app.js
═══════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────
const API = '/api';
const ROLES = { ADMIN: 'ADMIN', SOL: 'OPERADOR_SOLICITUD', APR: 'OPERADOR_APROBACION', ATE: 'OPERADOR_ATENCION', PLT: 'OPERADOR_PLANTA', CONS: 'OPERADOR_CONSULTA' };
const ROLE_LABELS = { ADMIN: 'Administrador', OPERADOR_SOLICITUD: 'Solicitador', OPERADOR_APROBACION: 'Aprobador', OPERADOR_ATENCION: 'Compras', OPERADOR_PLANTA: 'Planta', OPERADOR_CONSULTA: 'Consultas' };
const ITEMS_ROLES = [['','— Sin acceso —'],['solicitante','Solicitante'],['validador','Validador / Aprobador'],['registrador','Registrador ERP'],['admin','Administrador']];
const PAGO_ROLES  = [['','— Sin acceso —'],['programador','Programador (Paso 1)'],['aprobador','Aprobador (Paso 2)'],['pagador','Pagador (Paso 3 y 5)'],['autorizador','Autorizador (Paso 4)'],['admin','Administrador']];
const BCT_ROLES   = [['','— Sin acceso —'],['SOLICITUD','Solicitud'],['REGISTRO','Registro'],['CONSULTA','Consulta']];
const ROL86       = [['','— Sin acceso —'],['REGISTRO','Registro'],['CONSULTA','Consulta']];
const ESTADOS = ['SOLICITADO', 'APROBADO', 'RECHAZADO', 'REVISAR', 'ATENDIDO'];
const ALL_OPS = ['AASI', 'CDLAO', 'CDL28', 'PLANTA', 'GBADC', 'GBCFR', 'GBCFR2', 'GBCRP', 'GBGOL', 'GBSRQ', 'GBPLANTA'];
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
  const close = () => { document.getElementById('modal').classList.add('hidden'); box.classList.remove('modal-wide'); onClose?.(); };
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
  const views = { solicitar: viewSolicitar, 'mis-pedidos': viewMisPedidos, kardex: viewKardex, comentarios: viewComentarios, aprobar: viewAprobar, atender: viewAtender, precios: viewPrecios, comparativo: viewComparativo, ventas: viewVentasTip, bajas: viewBajas, items: viewItems, pagos: viewPagos, 'flujo-caja': viewFlujoCaja, movimientos: viewMovimientos, admin: viewAdmin };
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
            📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
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
            📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
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
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}</div>
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
            📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
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
      <td><strong style="font-size:13px">${esc(l.itemNombre || l.item || '—')}</strong><br><button onclick="verDesgloseReceta(${+(l.item)||0},${+(l.cantidadSolicitada)||1})" style="margin-top:4px;font-size:11px;padding:2px 8px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer">🏭 Genera Adicional</button></td>
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
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)} &nbsp;·&nbsp; ✅ ${esc(p.aprobadoPorNombre||'')}</div>
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
          <div class="pedido-info">📅 ${fmtDate(p.fechaPedido)} &nbsp;·&nbsp; 👤 ${esc(p.solicitadoPorNombre)}
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
let _dglsLineas    = [];  // filas del formulario de solicitud
let _dglsCatalog   = {};  // item -> {saldo, costoUnitario, grupoCompra, nombre}
let _dglsPedidoMap = {};  // id -> pedido (para toggle de pendientes)

const _dglsFmtN = v => v == null ? '' : Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function _dglsRenderTable() {
  const tbody = document.getElementById('dgls-sol-tbody');
  if (!tbody) return;
  tbody.innerHTML = _dglsLineas.map((l, i) => {
    const total = (l.cantDesglose || 0) + (l.ajuste || 0);
    const costoTotal = total * (l.costoUnitario || 0);
    const esNuevo = l.fuente === 'nuevo';
    return `<tr>
      <td style="padding:4px 6px;font-family:monospace;font-size:12px">
        ${esNuevo
          ? `<input type="number" class="form-control" style="width:72px;font-size:12px;padding:2px 4px" value="${l.item || ''}" oninput="_dglsSetField(${i},'item',+this.value||0)">`
          : esc(String(l.item))}
      </td>
      <td style="padding:4px 6px;font-size:12px">
        ${esNuevo
          ? `<input type="text" class="form-control" style="width:160px;font-size:12px;padding:2px 4px" value="${esc(l.descripcion)}" oninput="_dglsSetField(${i},'descripcion',this.value)">`
          : `<span style="font-weight:500">${esc(l.descripcion)}</span>`}
      </td>
      <td style="padding:4px 6px;text-align:right;font-size:12px;color:#6b7280">${_dglsFmtN(l.saldo)}</td>
      <td style="padding:4px 6px;text-align:right;font-size:12px">${_dglsFmtN(l.cantDesglose)}</td>
      <td style="padding:4px 6px">
        <input type="number" class="form-control" style="width:72px;text-align:right;font-size:12px;padding:2px 4px" value="${l.ajuste || 0}" step="any" oninput="_dglsSetField(${i},'ajuste',+this.value||0)">
      </td>
      <td id="dsl-tot-${i}" style="padding:4px 6px;text-align:right;font-weight:600;font-size:12px">${_dglsFmtN(total)}</td>
      <td style="padding:4px 6px">
        <input type="number" class="form-control" style="width:72px;text-align:right;font-size:12px;padding:2px 4px" value="${l.costoUnitario || 0}" step="any" oninput="_dglsSetField(${i},'costoUnitario',+this.value||0)">
      </td>
      <td id="dsl-ct-${i}" style="padding:4px 6px;text-align:right;font-size:12px">${_dglsFmtN(costoTotal)}</td>
      <td style="padding:4px 6px">
        <input type="text" class="form-control" style="width:120px;font-size:12px;padding:2px 4px" value="${esc(l.comentarios || '')}" oninput="_dglsSetField(${i},'comentarios',this.value)">
      </td>
      <td style="padding:4px 6px;text-align:center">
        <button onclick="_dglsRemoveLinea(${i})" style="border:none;background:none;color:#dc2626;cursor:pointer;font-size:15px;line-height:1">✕</button>
      </td>
    </tr>`;
  }).join('');
}

window._dglsSetField = function(i, field, val) {
  _dglsLineas[i][field] = val;
  if (['ajuste', 'cantDesglose', 'costoUnitario'].includes(field)) {
    const l = _dglsLineas[i];
    const total = (l.cantDesglose || 0) + (l.ajuste || 0);
    const tEl = document.getElementById(`dsl-tot-${i}`);
    const cEl = document.getElementById(`dsl-ct-${i}`);
    if (tEl) tEl.textContent = _dglsFmtN(total);
    if (cEl) cEl.textContent = _dglsFmtN(total * (l.costoUnitario || 0));
  }
};

window._dglsRemoveLinea = function(i) {
  _dglsLineas.splice(i, 1);
  _dglsRenderTable();
};

window._dglsAddLinea = function() {
  _dglsLineas.push({ item: 0, descripcion: '', saldo: 0, cantDesglose: 0, ajuste: 0, costoUnitario: 0, comentarios: '', gestion: 'PLANTA', grupoCompra: '', fuente: 'nuevo' });
  _dglsRenderTable();
  // scroll to bottom of table
  const tbody = document.getElementById('dgls-sol-tbody');
  if (tbody) tbody.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window._dglsTogglePedido = async function(pedidoId, checked) {
  const pedido = _dglsPedidoMap[pedidoId];
  if (!pedido) return;

  if (!checked) {
    _dglsLineas = _dglsLineas.filter(x => x.fuente !== `pedido:${pedidoId}`);
    _dglsRenderTable();
    return;
  }

  // Deshabilitar checkbox mientras carga
  const chk = document.querySelector(`input[onchange*="${pedidoId}"]`);
  if (chk) chk.disabled = true;

  const plLines = (pedido.lineas || []).filter(l => (l.gestion || 'COMPRAS') === 'PLANTA');
  for (const l of plLines) {
    try {
      const data = await GET(`/recetas/desglose?item=${encodeURIComponent(l.item)}&cantidad=${encodeURIComponent(l.cantidadSolicitada || 1)}`);
      if (data.sinReceta) {
        // Sin receta: agregar el ítem directamente
        _dglsLineas.push({
          item:          l.item,
          descripcion:   l.itemNombre || String(l.item),
          saldo:         _dglsCatalog[l.item]?.saldo || 0,
          cantDesglose:  l.cantidadSolicitada || 0,
          ajuste:        0,
          costoUnitario: l.costoUnitario || _dglsCatalog[l.item]?.costoUnitario || 0,
          comentarios:   `${esc(pedido.operacion)} (sin receta)`,
          gestion:       'PLANTA',
          grupoCompra:   l.grupoCompra || _dglsCatalog[l.item]?.grupoCompra || '',
          fuente:        `pedido:${pedidoId}`,
        });
      } else {
        // Con receta: agregar insumos finales (último nivel)
        for (const r of data.resumen) {
          _dglsLineas.push({
            item:          r.item,
            descripcion:   r.descripcion || (_dglsCatalog[r.item]?.nombre || ''),
            saldo:         _dglsCatalog[r.item]?.saldo || 0,
            cantDesglose:  r.cantidad,
            ajuste:        0,
            costoUnitario: _dglsCatalog[r.item]?.costoUnitario || 0,
            comentarios:   `Desglose de ${esc(l.itemNombre || String(l.item))} — ${esc(pedido.operacion)}`,
            gestion:       'PLANTA',
            grupoCompra:   r.areaDescarga || _dglsCatalog[r.item]?.grupoCompra || '',
            fuente:        `pedido:${pedidoId}`,
          });
        }
      }
    } catch (err) {
      toast(`Error al expandir ítem ${l.item}: ${err.message}`, 'error');
    }
  }
  _dglsRenderTable();
  if (chk) chk.disabled = false;
  _dglsRenderTable();
};

window.generarSolicitudDesdeDesglose = async function() {
  const userOps = S.user.role === 'ADMIN' ? ALL_OPS : (S.user.operations || []);
  const targetOp = userOps.find(op => op.includes('PLANTA'));
  if (!targetOp) { toast('No tienes asignada ninguna operación con PLANTA', 'error'); return; }

  openModal(`📋 Solicitud de Adicionales — ${targetOp}`,
    `<div style="text-align:center;padding:32px"><span class="spinner spinner-dark"></span></div>`,
    null, { wide: true });

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
    const pendingHtml = pendingPedidos.length ? `
      <div style="margin-bottom:16px">
        <div style="font-weight:600;font-size:12px;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Solicitudes pendientes con ítems PLANTA</div>
        <div style="border:1px solid #e5e7eb;border-radius:6px;max-height:140px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f3f4f6;position:sticky;top:0">
              <th style="padding:5px 8px;width:32px"></th>
              <th style="padding:5px 8px;text-align:left">Operación</th>
              <th style="padding:5px 8px;text-align:left">Fecha</th>
              <th style="padding:5px 8px;text-align:left">Estado</th>
              <th style="padding:5px 8px;text-align:left">Solicitante</th>
              <th style="padding:5px 8px;text-align:right">Líneas PLANTA</th>
            </tr></thead>
            <tbody>
              ${pendingPedidos.map(p => {
                const plCount = (p.lineas || []).filter(l => (l.gestion || 'COMPRAS') === 'PLANTA').length;
                return `<tr>
                  <td style="padding:5px 8px;text-align:center">
                    <input type="checkbox" onchange="_dglsTogglePedido('${p.id}',this.checked)" style="cursor:pointer">
                  </td>
                  <td style="padding:5px 8px;font-weight:600">${esc(p.operacion)}</td>
                  <td style="padding:5px 8px">${fmtDate(p.fechaPedido)}</td>
                  <td style="padding:5px 8px"><span class="badge badge-${(p.estado||'').toLowerCase()}">${p.estado}</span></td>
                  <td style="padding:5px 8px">${esc(p.solicitadoPorNombre || '')}</td>
                  <td style="padding:5px 8px;text-align:right;font-weight:600">${plCount}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    document.getElementById('modal-body').innerHTML = `
      <div style="font-size:13px;color:#374151;margin-bottom:14px">
        Operación destino: <strong style="color:#059669">${esc(targetOp)}</strong>
        &nbsp;·&nbsp; Fecha: <strong>${new Date().toISOString().split('T')[0]}</strong>
      </div>
      ${pendingHtml}
      <div style="font-weight:600;font-size:12px;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Líneas del adicional</div>
      <div style="border:1px solid #e5e7eb;border-radius:6px;overflow-x:auto;max-height:320px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f3f4f6;position:sticky;top:0">
            <th style="padding:5px 8px;text-align:left;min-width:76px">Código</th>
            <th style="padding:5px 8px;text-align:left;min-width:160px">Descripción</th>
            <th style="padding:5px 8px;text-align:right;min-width:70px">Saldo</th>
            <th style="padding:5px 8px;text-align:right;min-width:80px">Cant. Calc.</th>
            <th style="padding:5px 8px;text-align:right;min-width:80px">Ajuste</th>
            <th style="padding:5px 8px;text-align:right;min-width:80px">Total</th>
            <th style="padding:5px 8px;text-align:right;min-width:76px">Costo U.</th>
            <th style="padding:5px 8px;text-align:right;min-width:86px">Costo Total</th>
            <th style="padding:5px 8px;text-align:left;min-width:130px">Comentarios</th>
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
      </div>`;
    _dglsRenderTable();
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<p style="color:#dc2626;padding:16px">Error: ${esc(err.message)}</p>`;
  }
};

window._dglsEnviarSolicitud = async function(targetOp) {
  const lineas = _dglsLineas.filter(l => ((l.cantDesglose || 0) + (l.ajuste || 0)) > 0 && l.item);
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
        cantidadSolicitada: (l.cantDesglose || 0) + (l.ajuste || 0),
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
                return `<tr style="${checked?'background:#f0fdf4;':''}${pgAdelantoRowStyle(o.pagarA)}">
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
                  <td class="text-right fw-semibold" style="${montoColor}">${fmtMonto(o.monto)}</td>
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
      if (tr) tr.style.background = checked ? '#f0fdf4' : '';
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
    if (tr) tr.style.background = cb.checked ? '#f0fdf4' : '';
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

  // ── Guardar selecciones ────────────────────────────────────────────
  async function pgGuardar() {
    if (!progActual) return;
    const selecciones = progActual.obligaciones.map(ob => ({ id: ob._id, seleccionado: ob.seleccionado }));
    try {
      await PUT(`/pagos/programaciones/${progActual._id}/guardar`, { selecciones });
      toast('Programación guardada', 'success');
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
                  <tr style="border-top:1px solid #f1f5f9;background:${ob.seleccionado?'#f0fdf4':''}" id="ap2-tr-${ob._id}">
                    <td style="padding:2px 4px 2px 24px">
                      <input type="checkbox" data-id="${ob._id}" data-ben="${benKey}"
                             class="ap2-ob-cb" ${ob.seleccionado ? 'checked' : ''}
                             style="width:12px;height:12px;accent-color:var(--primary);cursor:pointer"
                             onchange="ap2ToggleOb('${ob._id}','${benKey}',this.checked)">
                    </td>
                    <td style="padding:2px 4px">${esc(ob.tipoDocumento||'')}</td>
                    <td style="padding:2px 4px">${esc(ob.numeroDocumento||'')}</td>
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
          <button class="btn btn-outline btn-sm" onclick="ap2Guardar()">💾 Guardar</button>
          ${puedeAprobar && ap2Prog.estado !== 'aprobado' ? `
            <button class="btn btn-primary btn-sm" onclick="ap2Aprobar()"
                    style="background:#16a34a;border-color:#16a34a">✅ Aprobar</button>` : ''}
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
  const AGRUPS_FIJOS = ['INDIVIDUAL','AGRUPADO 1','AGRUPADO 2','AGRUPADO 3','AGRUPADO 4',
                        'AGRUPADO 5','AGRUPADO 6','AGRUPADO 7','AGRUPADO 8','AGRUPADO 9','AGRUPADO 10'];
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
  const AGRUPS_FIJOS_4 = ['INDIVIDUAL','AGRUPADO 1','AGRUPADO 2','AGRUPADO 3','AGRUPADO 4',
                          'AGRUPADO 5','AGRUPADO 6','AGRUPADO 7','AGRUPADO 8','AGRUPADO 9','AGRUPADO 10'];

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

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">💵 Flujo de Caja</div>
    </div>
    <div class="page-body">
      <div class="card mb-16" style="padding:16px">
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
      <div id="fc-wrap"><div class="text-muted text-center py-24">Selecciona sociedad(es) y presiona "Ver Flujo".</div></div>
    </div>`;

  window.fcVerFlujo = async function() {
    const companias = [...document.querySelectorAll('.fc-soc-chk:checked')].map(c => c.value);
    const moneda    = document.getElementById('fc-moneda').value;
    const granularidad = document.getElementById('fc-granularidad').value;
    const periodos  = document.getElementById('fc-periodos').value || 12;
    const wrap = document.getElementById('fc-wrap');
    if (!companias.length) { toast('Selecciona al menos una sociedad', 'warning'); return; }
    wrap.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const data = await GET(`/flujo-caja/resumen?companias=${encodeURIComponent(companias.join(','))}&moneda=${moneda}&granularidad=${granularidad}&periodos=${periodos}`);
      const simbolo = moneda === 'USD' ? 'US$' : 'S/';

      let filasHtml = '';
      let seccionActual = null;
      data.filas.forEach(f => {
        if (f.seccion !== seccionActual) {
          seccionActual = f.seccion;
          filasHtml += `<tr style="background:#1a1f3a">
            <td colspan="${data.periodos.length + 1}" style="padding:6px 10px;color:#fff;font-weight:700;font-size:12px">${esc(SECCION_LABEL[f.seccion] || f.seccion)}</td>
          </tr>`;
        }
        const destacar = ['SALDO_INICIAL','SALDO_FINAL'].includes(f.seccion);
        const tipoAct  = f.tipoActividad && TIPO_ACT_LABEL[f.tipoActividad];
        const tipoActBadge = tipoAct ? `<span style="margin-left:8px;font-size:9px;font-weight:600;padding:1px 6px;border-radius:8px;color:#fff;background:${TIPO_ACT_COLOR[f.tipoActividad]}">${esc(tipoAct)}</span>` : '';
        filasHtml += `<tr ${destacar?'style="font-weight:700;background:#f0fdf4"':''}>
          <td style="padding:5px 10px 5px 24px">${esc(f.nombre)}${tipoActBadge}</td>
          ${f.valores.map(v => `<td style="padding:5px 10px;text-align:right;${v<0?'color:#dc2626':''}">${fmtMonto(v)}</td>`).join('')}
        </tr>`;
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
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          ℹ️ Por ahora se muestra el saldo inicial real (desde Cuentas Bancarias) y la estructura completa del flujo;
          los movimientos reales y proyectados se incorporarán en una próxima entrega.
        </p>`;
    } catch(e) {
      wrap.innerHTML = `<div class="text-center py-24" style="color:#dc2626">${esc(e.message)}</div>`;
    }
  };

  // Carga inicial automática si hay al menos una sociedad
  if (socsFC.length) await window.fcVerFlujo();
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
  const BASE = '__BASE__';
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
    ['base',      '🧱 Estructura Base'],
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

  // ── 1) Estructura Base ──────────────────────────────────────────
  async function renderBase() {
    const el = document.getElementById('fc-adm-base');
    const lineas = await GET(`/flujo-caja/lineas?compania=${encodeURIComponent(BASE)}`);
    el.innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
        Esta es la estructura base que aplica a todas las sociedades. Al crear una línea aquí,
        se propaga automáticamente como línea heredada en cada sociedad.
      </p>
      <div class="card" style="overflow:hidden;max-width:760px;margin-bottom:16px">
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Sección</th><th>Línea</th><th style="width:160px">Tipo de Actividad</th><th style="width:70px">Orden</th><th style="width:90px">Activa</th><th style="width:80px">Acciones</th></tr></thead>
          <tbody>
            ${SECCIONES.map(([sk,sl]) => {
              const filas = lineas.filter(l => l.seccion === sk).sort((a,b) => (a.orden||0) - (b.orden||0));
              const headerRow = `<tr><td colspan="6" style="background:${seccionBg(sk,0.28)};font-weight:700;font-size:11px;padding:6px 10px">${esc(sl)}</td></tr>`;
              if (!filas.length) return headerRow;
              return headerRow +
                filas.map(l => `
                <tr style="background:${seccionBg(sk,0.07)}">
                  <td class="text-muted" style="font-size:11px">${esc(sl)}</td>
                  <td><input class="form-control fc-base-nombre" data-id="${l._id}" value="${esc(l.nombre)}" style="font-size:12px"></td>
                  <td>${tipoActSelectHtml('fc-base-tipo', l._id, l.tipoActividad || 'OPERACION')}</td>
                  <td><input type="number" class="form-control fc-base-orden" data-id="${l._id}" value="${l.orden||0}" style="font-size:12px;width:60px"></td>
                  <td class="text-center"><input type="checkbox" class="fc-base-activa" data-id="${l._id}" ${l.activa!==false?'checked':''}></td>
                  <td class="text-center" style="white-space:nowrap">
                    <button class="btn btn-xs btn-primary" onclick="fcBaseGuardar('${l._id}')" title="Guardar">💾</button>
                    <button class="btn btn-xs btn-danger" onclick="fcBaseEliminar('${l._id}')" title="Eliminar">✕</button>
                  </td>
                </tr>`).join('');
            }).join('')}
            ${!lineas.length ? '<tr><td colspan="6" class="text-muted text-center py-8">Sin líneas. Agrega la primera abajo.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <div class="card" style="padding:14px;max-width:760px">
        <strong style="font-size:13px">+ Nueva línea base</strong>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block">Sección</label>
            <select id="fc-base-new-seccion" class="form-control" style="width:170px;font-size:12px">
              ${SECCIONES.map(([sk,sl])=>`<option value="${sk}">${esc(sl)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block">Nombre de la línea</label>
            <input id="fc-base-new-nombre" class="form-control" style="width:240px;font-size:12px" placeholder="Ej: Cobranza Clientes">
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block">Tipo de Actividad</label>
            <select id="fc-base-new-tipo" class="form-control" style="width:160px;font-size:12px">
              ${TIPOS_ACTIVIDAD.map(([tk,tl])=>`<option value="${tk}">${esc(tl)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block">Orden</label>
            <input id="fc-base-new-orden" type="number" class="form-control" style="width:70px;font-size:12px" value="0">
          </div>
          <button class="btn btn-primary btn-sm" onclick="fcBaseAgregar()">+ Agregar</button>
        </div>
      </div>`;
  }

  window.fcBaseAgregar = async () => {
    const seccion = document.getElementById('fc-base-new-seccion').value;
    const nombre  = document.getElementById('fc-base-new-nombre').value.trim();
    const tipoActividad = document.getElementById('fc-base-new-tipo').value;
    const orden   = document.getElementById('fc-base-new-orden').value;
    if (!nombre) { toast('Ingresa el nombre de la línea', 'warning'); return; }
    try {
      await POST('/flujo-caja/lineas', { compania: BASE, seccion, nombre, tipoActividad, orden });
      toast('✅ Línea base creada y propagada a todas las sociedades', 'success');
      await renderBase();
    } catch(e) { toast(e.message, 'error'); }
  };
  window.fcBaseGuardar = async (id) => {
    const nombre = container.querySelector(`.fc-base-nombre[data-id="${id}"]`)?.value.trim();
    const tipoActividad = container.querySelector(`.fc-base-tipo[data-id="${id}"]`)?.value;
    const orden  = container.querySelector(`.fc-base-orden[data-id="${id}"]`)?.value;
    const activa = container.querySelector(`.fc-base-activa[data-id="${id}"]`)?.checked;
    try {
      await PUT(`/flujo-caja/lineas/${id}`, { nombre, tipoActividad, orden, activa });
      toast('Guardado', 'success');
      await renderBase();
    } catch(e) { toast(e.message, 'error'); }
  };
  window.fcBaseEliminar = async (id) => {
    if (!confirm('¿Eliminar esta línea base?')) return;
    try {
      await DEL(`/flujo-caja/lineas/${id}`);
      toast('Eliminada', 'success');
      await renderBase();
    } catch(e) {
      if (e.data?.requiereCascada) {
        const n = e.data.hijas || 0;
        if (confirm(`⚠️ Esta línea base tiene ${n} línea(s) heredada(s) en las sociedades (y posiblemente mapeos que la usan).\n\n¿Eliminar TODO en cascada (la línea base + sus ${n} línea(s) de sociedad + los mapeos asociados)?\n\nEsta acción no se puede deshacer. Si solo quieres dejar de usarla sin perder datos, cancela y desactívala en su lugar.`)) {
          try {
            await DEL(`/flujo-caja/lineas/${id}?cascade=true`);
            toast(`🗑️ Línea base y ${n} línea(s) de sociedad eliminadas`, 'success');
            await renderBase();
          } catch(e2) { toast(e2.message, 'error'); }
        }
      } else {
        toast(e.message, 'error');
      }
    }
  };

  // ── 2) Estructura por Sociedad ───────────────────────────────────
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
      const [lineas, basesRaw] = await Promise.all([
        GET(`/flujo-caja/lineas?compania=${encodeURIComponent(comp)}`),
        GET(`/flujo-caja/lineas?compania=${encodeURIComponent(BASE)}`),
      ]);
      const baseById = {}; basesRaw.forEach(b => baseById[b._id] = b);
      const cont = document.getElementById('fc-soc-cont');
      cont.innerHTML = `
        <div class="card" style="overflow:hidden;max-width:840px;margin-bottom:16px">
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Sección</th><th>Línea</th><th>Línea base</th><th style="width:130px">Tipo de Actividad</th><th style="width:70px">Orden</th><th style="width:90px">Activa</th><th style="width:80px">Acciones</th></tr></thead>
            <tbody>
              ${lineas.length ? SECCIONES.map(([sk,sl]) => {
                const filas = lineas.filter(l => l.seccion === sk).sort((a,b) => (a.orden||0) - (b.orden||0));
                const headerRow = `<tr><td colspan="7" style="background:${seccionBg(sk,0.28)};font-weight:700;font-size:11px;padding:6px 10px">${esc(sl)}</td></tr>`;
                if (!filas.length) return headerRow;
                return headerRow + filas.map(l => `
                <tr style="background:${seccionBg(sk,0.07)}">
                  <td class="text-muted" style="font-size:11px">${esc(sl)}</td>
                  <td><input class="form-control fc-soc-nombre" data-id="${l._id}" value="${esc(l.nombre)}" style="font-size:12px"></td>
                  <td class="text-muted" style="font-size:11px">${esc(baseById[l.baseLineaId]?.nombre || '—')}</td>
                  <td class="text-muted" style="font-size:11px">${esc(tipoActLabel(l.tipoActividad || baseById[l.baseLineaId]?.tipoActividad))}</td>
                  <td><input type="number" class="form-control fc-soc-orden" data-id="${l._id}" value="${l.orden||0}" style="font-size:12px;width:60px"></td>
                  <td class="text-center"><input type="checkbox" class="fc-soc-activa" data-id="${l._id}" ${l.activa!==false?'checked':''}></td>
                  <td class="text-center" style="white-space:nowrap">
                    <button class="btn btn-xs btn-primary" onclick="fcSocGuardar('${l._id}')" title="Guardar">💾</button>
                    <button class="btn btn-xs btn-danger" onclick="fcSocEliminar('${l._id}')" title="Eliminar">✕</button>
                  </td>
                </tr>`).join('');
              }).join('') : '<tr><td colspan="7" class="text-muted text-center py-8">Sin líneas para esta sociedad todavía (crea líneas en Estructura Base para que se hereden).</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card" style="padding:14px;max-width:840px">
          <strong style="font-size:13px">+ Nueva línea propia de ${esc(comp)}</strong>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Sección</label>
              <select id="fc-soc-new-seccion" class="form-control" style="width:170px;font-size:12px">
                ${SECCIONES.map(([sk,sl])=>`<option value="${sk}">${esc(sl)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Nombre de la línea</label>
              <input id="fc-soc-new-nombre" class="form-control" style="width:220px;font-size:12px" placeholder="Ej: Venta Local Tienda X">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Línea base (obligatorio)</label>
              <select id="fc-soc-new-base" class="form-control" style="width:220px;font-size:12px">
                ${basesRaw.map(b=>`<option value="${b._id}">${esc((SECCIONES.find(s=>s[0]===b.seccion)||[,b.seccion])[1])} — ${esc(b.nombre)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted);display:block">Orden</label>
              <input id="fc-soc-new-orden" type="number" class="form-control" style="width:70px;font-size:12px" value="0">
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
      const baseLineaId = document.getElementById('fc-soc-new-base').value;
      const orden   = document.getElementById('fc-soc-new-orden').value;
      if (!nombre)      { toast('Ingresa el nombre de la línea', 'warning'); return; }
      if (!baseLineaId) { toast('Selecciona la línea base a enlazar', 'warning'); return; }
      try {
        await POST('/flujo-caja/lineas', { compania: comp, seccion, nombre, baseLineaId, orden });
        toast('✅ Línea agregada', 'success');
        await load();
      } catch(e) { toast(e.message, 'error'); }
    };
    window.fcSocGuardar = async (id) => {
      const nombre = container.querySelector(`.fc-soc-nombre[data-id="${id}"]`)?.value.trim();
      const orden  = container.querySelector(`.fc-soc-orden[data-id="${id}"]`)?.value;
      const activa = container.querySelector(`.fc-soc-activa[data-id="${id}"]`)?.checked;
      try { await PUT(`/flujo-caja/lineas/${id}`, { nombre, orden, activa }); toast('Guardado', 'success'); await load(); }
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

      cont.innerHTML = `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${esc(cfg.descripcion)}</p>
        <div class="card" style="overflow:hidden;max-width:920px;margin-bottom:16px">
          <table class="data-table" style="font-size:12px">
            <thead><tr>${colHeaders}<th>Línea del Flujo</th><th style="width:60px">Acciones</th></tr></thead>
            <tbody>
              ${rows.map(r => `
              <tr>
                ${cfg.buildClaveCols(r, cuentas, cuentaLabel)}
                <td class="text-muted" style="font-size:11px">${esc(r.lineaId?.nombre || '—')}</td>
                <td class="text-center"><button class="btn btn-xs btn-danger" onclick="fcMapEliminar('${cfg.endpoint}','${cfg.tabKey}','${r._id}')" title="Eliminar">✕</button></td>
              </tr>`).join('') || `<tr><td colspan="${cfg.campos.length+2}" class="text-muted text-center py-8">Sin registros</td></tr>`}
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
                ${lineas.map(l=>`<option value="${l._id}">${esc((SECCIONES.find(s=>s[0]===l.seccion)||[,l.seccion])[1])} — ${esc(l.nombre)}</option>`).join('') || '<option value="">— Sin líneas —</option>'}
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
    window.fcMapEliminar = async (endpoint, tabKey, id) => {
      if (!confirm('¿Eliminar este registro?')) return;
      try { await DEL(`/flujo-caja/${endpoint}/${id}`); toast('Eliminado', 'success'); await load(); }
      catch(e) { toast(e.message, 'error'); }
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
  await renderBase();
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
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_OPS.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-op" value="${op}" ${(user?.operations||[]).includes(op)?'checked':''}>
            ${op}
          </label>`).join('')}
        </div>
      </div>
      <div class="form-group" id="um-transf-dest-section"><label>Operaciones Destino para Transferencias</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_OPS.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-transf-dest" value="${op}" ${(user?.transferenciaDestinos||[]).includes(op)?'checked':''}>
            ${op}
          </label>`).join('')}
        </div>
      </div>
      <div id="um-permisos-extra" class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
        <label style="display:block;font-weight:600;margin-bottom:10px;color:#b42318">🗑️ Bajas / Consumos / Transferencias / 86</label>
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
        <label style="display:block;font-weight:600;margin-bottom:10px;color:#0369a1">🔍 Otros Permisos</label>
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
    const data = {
      username: document.getElementById('um-username').value.trim(),
      email: document.getElementById('um-email').value.trim(),
      role,
      itemsRol: document.getElementById('um-items-role').value,
      rolPago:      document.getElementById('um-pago-role').value,
      rolBCT:       isAdmin ? '' : document.getElementById('um-rol-bct').value,
      rol86:        isAdmin ? '' : document.getElementById('um-rol-86').value,
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
      sociedadesCompra,
      sociedadesPago,
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

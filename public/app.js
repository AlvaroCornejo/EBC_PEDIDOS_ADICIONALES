/* ═══════════════════════════════════════════════════════════════
   Sistema de Pedidos — app.js
═══════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────
const API = '/api';
const ROLES = { ADMIN: 'ADMIN', SOL: 'OPERADOR_SOLICITUD', APR: 'OPERADOR_APROBACION', ATE: 'OPERADOR_ATENCION', PLT: 'OPERADOR_PLANTA', CONS: 'OPERADOR_CONSULTA' };
const ROLE_LABELS = { ADMIN: 'Administrador', OPERADOR_SOLICITUD: 'Solicitador', OPERADOR_APROBACION: 'Aprobador', OPERADOR_ATENCION: 'Compras', OPERADOR_PLANTA: 'Planta', OPERADOR_CONSULTA: 'Consultas' };
const ESTADOS = ['SOLICITADO', 'APROBADO', 'RECHAZADO', 'REVISAR', 'ATENDIDO'];
const ALL_OPS = ['AASI', 'CDLAO', 'CDL28', 'CORP', 'DOSIMETRIA', 'PREP', 'GBADC', 'GBCFR', 'GBCFR2', 'GBCRP', 'GBGOL', 'GBSRQ', 'GBPLANTA'];
const ALL_SOCS_COMPRA = ['ERSAC', 'FRQ1', 'GB'];

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
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Solo hacer auto-logout si la petición llevaba token (ruta protegida)
    // Si no llevaba token (ej: /auth/login con contraseña incorrecta), mostrar el error normal
    if (S.token) {
      S.user = null; S.token = null;
      localStorage.removeItem('pedidos_token');
      localStorage.removeItem('pedidos_user');
      document.getElementById('app').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
      toast('Tu sesión expiró. Por favor vuelve a iniciar sesión.', 'error');
      throw new Error('Sesión expirada');
    }
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const GET  = (p)    => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT  = (p, b) => api('PUT', p, b);
const DEL  = (p)    => api('DELETE', p);

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
  localStorage.setItem('pedidos_token', data.token);
  localStorage.setItem('pedidos_user', JSON.stringify(data.user));
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
      localStorage.setItem('pedidos_user', JSON.stringify(S.user));
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
  localStorage.removeItem('pedidos_token');
  localStorage.removeItem('pedidos_user');
  location.reload();
}

function restoreSession() {
  const token = localStorage.getItem('pedidos_token');
  const user  = localStorage.getItem('pedidos_user');
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
      localStorage.setItem('pedidos_token', data.token);
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
  { id: 'comparativo',   label: 'Comparativo OC',  icon: '📈', roles: [ROLES.ADMIN, ROLES.SOL, ROLES.APR, ROLES.ATE, ROLES.PLT, ROLES.CONS] },
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
  return false;
}

function renderNav() {
  const visibles = NAV_ITEMS.filter(canSeeNav);

  // Sidebar (desktop)
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = visibles
    .map(n => `<a href="#" class="nav-item" data-view="${n.id}"><span class="nav-icon">${n.icon}</span>${n.label}</a>`)
    .join('');
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.view); });
  });

  // Bottom nav (mobile)
  const bn = document.getElementById('bottom-nav');
  bn.innerHTML = visibles
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
  const vc = document.getElementById('view-container');
  vc.innerHTML = '';
  const views = { solicitar: viewSolicitar, 'mis-pedidos': viewMisPedidos, kardex: viewKardex, comentarios: viewComentarios, aprobar: viewAprobar, atender: viewAtender, precios: viewPrecios, comparativo: viewComparativo, admin: viewAdmin };
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
  const ops = S.user.role === ROLES.ADMIN ? ALL_OPS : (userOps.length ? userOps : ALL_OPS);
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
  const ops = S.user.role === ROLES.ADMIN ? ALL_OPS : (S.user.operations || ALL_OPS);
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
        <div class="aprobacion-row" style="justify-content:flex-end">
          <button class="btn btn-primary apr-save-btn" data-id="${p.id}">💾 Guardar aprobación</button>
        </div>
      </div>
    </div>`).join('');

  container.querySelectorAll('.pedido-card-header').forEach(h => {
    h.addEventListener('click', () => h.nextElementSibling.classList.toggle('open'));
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
        <span style="color:var(--text-muted);font-size:12px">▼</span>
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
      <td><strong style="font-size:13px">${esc(l.itemNombre || l.item || '—')}</strong></td>
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
  // Operaciones accesibles para este usuario
  const userOps = S.user.role === ROLES.ADMIN ? ALL_OPS : (S.user.operations || ALL_OPS);

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
              ${userOps.map(o => `<option value="${o}">${o}</option>`).join('')}
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
              <option value="evolucion">Evolución semanal</option>
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

  function renderResumen(container, data, op, sems) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos para ${op} en las últimas ${sems} semanas.</p></div>`;
      return;
    }
    // Totales
    const totReal  = data.reduce((s,r) => s + r.importeReal, 0);
    const totOC    = data.reduce((s,r) => s + r.impOCTotal, 0);
    const pctGlobal = totOC > 0 ? (totReal / totOC * 100) : null;

    // Clasificación
    const enRango  = data.filter(r => r.pctCumplimiento != null && r.pctCumplimiento >= 90 && r.pctCumplimiento <= 110).length;
    const leve     = data.filter(r => r.pctCumplimiento != null && ((r.pctCumplimiento >= 70 && r.pctCumplimiento < 90) || (r.pctCumplimiento > 110 && r.pctCumplimiento <= 130))).length;
    const critico  = data.filter(r => r.pctCumplimiento != null && (r.pctCumplimiento < 70 || r.pctCumplimiento > 130)).length;

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
        <div style="padding:12px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
          ${data.length} ítems — últimas ${sems} semanas
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ítem</th>
                <th>Descripción</th>
                <th>Grupo</th>
                <th class="text-right">Cant. OC</th>
                <th class="text-right">Cant. Real</th>
                <th class="text-right">% Cumpl.</th>
                <th class="text-right">Importe OC</th>
                <th class="text-right">Importe Real</th>
                <th class="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(r => `<tr style="cursor:pointer" onclick="cmpVerEvolucion('${r.item}','${esc(r.nombre)}')">
                <td><code style="font-size:11px">${esc(r.item)}</code></td>
                <td style="font-size:12px">${esc(r.nombre)}</td>
                <td><span style="font-size:11px;background:var(--bg-secondary);padding:1px 6px;border-radius:4px">${esc(r.grupoCompra)}</span></td>
                <td class="text-right">${fmt(r.ocTotal, 1)}</td>
                <td class="text-right">${fmt(r.cantidadReal, 1)}</td>
                <td class="text-right">${pctBadge(r.pctCumplimiento)}</td>
                <td class="text-right text-muted">${fmtMoney(r.impOCTotal)}</td>
                <td class="text-right">${fmtMoney(r.importeReal)}</td>
                <td class="text-right" style="color:${r.diferencia >= 0 ? '#10b981' : '#ef4444'};font-weight:600">${fmtMoney(r.diferencia)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    // Función global para drill-down desde fila
    window.cmpVerEvolucion = async (item, nombre) => {
      const op   = document.getElementById('cmp-op').value;
      const sems = document.getElementById('cmp-sems').value;
      try {
        const data = await GET(`/comparativo/evolucion?operacion=${op}&item=${item}&semanas=${sems}`);
        renderEvolucion(container, data, op, nombre);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ── Render evolución semanal ─────────────────────────────────────
  function renderEvolucion(container, data, op, titulo) {
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Sin datos de evolución.</p></div>`;
      return;
    }
    container.innerHTML = `
      <div class="card">
        <div style="padding:12px 16px;font-weight:600;border-bottom:1px solid var(--border)">
          ${titulo ? `📈 Evolución: ${esc(titulo)}` : `📈 Evolución semanal — ${op}`}
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
              ${data.map(r => `<tr>
                <td><strong>${esc(r.label)}</strong></td>
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
        <div style="padding:10px 16px">
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('cmp-vista').value='resumen';document.getElementById('cmp-buscar').click()">
            ← Volver al resumen
          </button>
        </div>
      </div>`;
  }

  // Cargar al inicio
  await buscarComparativo();
}

// ─── View: Admin ──────────────────────────────────────────────────
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
      </div>
      <div id="tab-usuarios" class="tab-panel active"></div>
      <div id="tab-items" class="tab-panel"></div>
      <div id="tab-archivos" class="tab-panel"></div>
      <div id="tab-pedidos-admin" class="tab-panel"></div>
      <div id="tab-database" class="tab-panel"></div>
      <div id="tab-config" class="tab-panel"></div>
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
  const allRoles = Object.entries(ROLE_LABELS);
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
      <div class="form-group"><label>Rol *</label>
        <select id="um-role">
          ${allRoles.map(([k,v])=>`<option value="${k}" ${user?.role===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="um-ops-section"><label>Operaciones Autorizadas</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_OPS.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-op" value="${op}" ${(user?.operations||[]).includes(op)?'checked':''}>
            ${op}
          </label>`).join('')}
        </div>
      </div>
      <div class="form-group" id="um-socs-section"><label>Sociedades Autorizadas</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_SOCS_COMPRA.map(s => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-soc-compra" value="${s}"
              ${(user?.sociedadesCompra||[]).includes(s)?'checked':''}
              style="width:15px;height:15px;accent-color:var(--primary)">
            ${s}
          </label>`).join('')}
        </div>
      </div>
      <div id="um-consulta-perms" class="form-group" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;display:none">
        <label style="display:block;font-weight:600;margin-bottom:10px;color:#0369a1">🔍 Permisos de Consulta</label>
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
    const role       = document.getElementById('um-role').value;
    const isAdmin    = role === ROLES.ADMIN;
    const isConsulta = role === ROLES.CONS;
    document.getElementById('um-ops-section').style.display      = isAdmin ? 'none' : 'block';
    document.getElementById('um-socs-section').style.display     = isAdmin ? 'none' : 'block';
    document.getElementById('um-consulta-perms').style.display   = isConsulta ? 'block' : 'none';
  }
  syncRoleUI();
  document.getElementById('um-role').addEventListener('change', syncRoleUI);

  document.getElementById('um-save').addEventListener('click', async () => {
    const errEl = document.getElementById('um-error');
    errEl.classList.add('hidden');
    const role = document.getElementById('um-role').value;
    const isConsulta = role === ROLES.CONS;
    // Sociedades siempre del selector top-level; para CONS además requiere perm de Precios activado
    const selectedSocs = [...document.querySelectorAll('input[name="um-soc-compra"]:checked')].map(cb => cb.value);
    const sociedadesCompra = isConsulta
      ? (document.getElementById('um-precios')?.checked ? selectedSocs : [])
      : selectedSocs;
    const data = {
      username: document.getElementById('um-username').value.trim(),
      email: document.getElementById('um-email').value.trim(),
      role,
      operations: [...document.querySelectorAll('input[name="um-op"]:checked')].map(cb => cb.value),
      puedeVerKardex:      isConsulta ? (document.getElementById('um-kardex')?.checked      ?? false) : false,
      puedeVerComparativo: isConsulta ? (document.getElementById('um-comparativo')?.checked ?? false) : false,
      sociedadesCompra,
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
            <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Sociedad</label>
            <select id="pr-sociedad" class="form-control" style="width:160px">
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

  // Cargar sociedades y luego grupos filtrados por la sociedad por omisión
  try {
    const socs = await GET('/compras/sociedades');

    // Sociedades
    const selSoc = document.getElementById('pr-sociedad');
    selSoc.innerHTML = '<option value="">Todas las sociedades</option>';
    if (socs.length === 0) {
      selSoc.innerHTML = '<option value="">Sin datos</option>';
    } else {
      socs.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = String(s);
        selSoc.appendChild(opt);
      });
      selSoc.selectedIndex = 1;
    }

    // Cargar grupos filtrados por la sociedad seleccionada por omisión
    const socDefault = selSoc.value;
    const [gruposItem, gruposCompra] = await Promise.all([
      GET(socDefault ? `/compras/grupos-item?sociedad=${encodeURIComponent(socDefault)}` : '/compras/grupos-item'),
      GET(socDefault ? `/compras/grupos?sociedad=${encodeURIComponent(socDefault)}` : '/compras/grupos'),
    ]);
    cargarGruposItem(gruposItem);
    cargarGrupos(gruposCompra);

    // Cascada: Sociedad → recarga Grupo y Grupo Compra, luego busca
    selSoc.addEventListener('change', async () => {
      const soc = selSoc.value;
      try {
        const [gi, gc] = await Promise.all([
          GET(soc ? `/compras/grupos-item?sociedad=${encodeURIComponent(soc)}` : '/compras/grupos-item'),
          GET(soc ? `/compras/grupos?sociedad=${encodeURIComponent(soc)}` : '/compras/grupos'),
        ]);
        cargarGruposItem(gi);
        cargarGrupos(gc);
      } catch (_) {}
      buscarPrecios();
    });

    // Cascada: Grupo → recarga Grupo Compra, luego busca
    document.getElementById('pr-grupo-item').addEventListener('change', async () => {
      const soc  = selSoc.value;
      const grp  = document.getElementById('pr-grupo-item').value;
      try {
        const params = new URLSearchParams();
        if (soc) params.set('sociedad', soc);
        if (grp) params.set('grupoItem', grp);
        const gc = await GET(`/compras/grupos?${params}`);
        cargarGrupos(gc);
      } catch (_) {}
      buscarPrecios();
    });

  } catch (err) {
    document.getElementById('pr-sociedad').innerHTML = '<option value="">Error al cargar</option>';
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
  ['pr-sociedad', 'pr-grupo-item', 'pr-grupo', 'pr-n'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => buscarPrecios());
  });

  async function buscarPrecios() {
    const sociedad   = document.getElementById('pr-sociedad').value;
    const grupoItem  = document.getElementById('pr-grupo-item').value;
    const grupo      = document.getElementById('pr-grupo').value;
    const pareto     = document.getElementById('pr-pareto').value;
    const n          = document.getElementById('pr-n').value;
    const res        = document.getElementById('pr-result');

    res.innerHTML = `<div class="loading-overlay" style="position:relative;height:80px"><span class="spinner spinner-dark"></span> Consultando...</div>`;

    try {
      const params = new URLSearchParams({ sociedad, pareto });
      if (grupoItem) params.set('grupoItem', grupoItem);
      if (grupo)     params.set('grupo', grupo);
      const data = await GET(`/compras/items?${params}`);
      renderPreciosResult(res, data, sociedad, n, pareto);
    } catch (err) {
      res.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Error: ${esc(err.message)}</p></div>`;
    }
  }

  function renderPreciosResult(container, data, sociedad, n, pareto) {
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
          <button onclick="verComprasItem(${it.item},'${esc(it.nombre||'')}','${encodeURIComponent(sociedad)}')"
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
        const socParam = encodeURIComponent(sociedad);
        const [compras, totData] = await Promise.all([
          GET(`/compras/precios/${it.item}?sociedad=${socParam}&desde=${encodeURIComponent(desdeISO)}`),
          GET(`/compras/total/${it.item}?sociedad=${socParam}`),
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
        if (totalCell) { totalCell.textContent = totData.total > 0 ? fmtImp(totData.total) : '—'; totalCell.style.color = ''; }

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
  window.verComprasItem = async function(itemId, nombre, socEnc) {
    const sociedad   = decodeURIComponent(socEnc);
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
              ${sociedad ? 'Sociedad: ' + esc(sociedad) + ' · ' : ''}Últimas ${nSemanas} semanas
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
      const compras = await GET(`/compras/precios/${itemId}?sociedad=${encodeURIComponent(sociedad)}&desde=${encodeURIComponent(desdeModal)}`);
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
      localStorage.removeItem('pedidos_token'); localStorage.removeItem('pedidos_user');
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

function imprimirPedidos(pedidos, titulo = 'Pedidos Adicionales', gestion = '') {
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

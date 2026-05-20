/* ═══════════════════════════════════════════════════════════════
   Sistema de Pedidos — app.js
═══════════════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────────────────
const API = '/api';
const ROLES = { ADMIN: 'ADMIN', SOL: 'OPERADOR_SOLICITUD', APR: 'OPERADOR_APROBACION', ATE: 'OPERADOR_ATENCION', PLT: 'OPERADOR_PLANTA' };
const ROLE_LABELS = { ADMIN: 'Administrador', OPERADOR_SOLICITUD: 'Solicitador', OPERADOR_APROBACION: 'Aprobador', OPERADOR_ATENCION: 'Compras', OPERADOR_PLANTA: 'Planta' };
const ESTADOS = ['SOLICITADO', 'APROBADO', 'RECHAZADO', 'REVISAR', 'ATENDIDO'];
const ALL_OPS = ['AASI', 'CDLAO', 'CDL28'];

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
const fmtMoney = (n) => n == null ? '—' : 'S/ ' + Number(n).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
function openModal(title, html, onClose) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
  const close = () => { document.getElementById('modal').classList.add('hidden'); onClose?.(); };
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

function logout() {
  S.user = null; S.token = null;
  localStorage.removeItem('pedidos_token');
  localStorage.removeItem('pedidos_user');
  location.reload();
}

function restoreSession() {
  const token = localStorage.getItem('pedidos_token');
  const user = localStorage.getItem('pedidos_user');
  if (token && user) { S.token = token; S.user = JSON.parse(user); return true; }
  return false;
}

// ─── Navigation ──────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'solicitar',    label: 'Solicitar',    icon: '📝', roles: [ROLES.ADMIN, ROLES.SOL] },
  { id: 'mis-pedidos',  label: 'Mis Pedidos',  icon: '📋', roles: [ROLES.ADMIN, ROLES.SOL] },
  { id: 'comentarios',  label: 'Comentarios',  icon: '💬', roles: [ROLES.ADMIN, ROLES.SOL, ROLES.APR, ROLES.ATE, ROLES.PLT] },
  { id: 'aprobar',      label: 'Aprobar',      icon: '✅', roles: [ROLES.ADMIN, ROLES.APR] },
  { id: 'atender',      label: 'Atender',      icon: '🚚', roles: [ROLES.ADMIN, ROLES.ATE, ROLES.PLT] },
  { id: 'admin',        label: 'Admin',        icon: '⚙️', roles: [ROLES.ADMIN] }
];

function renderNav() {
  const role = S.user.role;
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = NAV_ITEMS
    .filter(n => n.roles.includes(role))
    .map(n => `<a href="#" class="nav-item" data-view="${n.id}"><span class="nav-icon">${n.icon}</span>${n.label}</a>`)
    .join('');
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.view); });
  });
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
}

function navigate(view, params = {}) {
  S.view = view;
  S.viewParams = params;
  setActiveNav(view);
  const vc = document.getElementById('view-container');
  vc.innerHTML = '';
  const views = { solicitar: viewSolicitar, 'mis-pedidos': viewMisPedidos, comentarios: viewComentarios, aprobar: viewAprobar, atender: viewAtender, admin: viewAdmin };
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
    ? (S.user.operations?.length ? S.user.operations : ['AASI'])
    : (S.user.operations || []);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">${editId ? '✏️ Editar Pedido' : '📝 Nueva Solicitud'}</div>
      <div style="margin-left:auto"><button class="btn btn-outline btn-sm" id="btn-resumen">📊 Resumen</button></div>
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
              ${S.form.lineas.map((l, i) => renderLineaRow(l, i, true, S.form.editMode || 'edit')).join('')}
            </tbody>
          </table>
        </div>
        <div class="add-line-row flex gap-8 items-center">
          <button class="btn btn-outline btn-sm" id="add-linea-btn">+ Agregar línea</button>
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
        <th class="col-item" rowspan="2">Item</th>
        <th rowspan="2">Grupo</th>
        <th class="group-header" colspan="4">Semana Anterior</th>
        <th class="group-header" colspan="4">Semana Actual</th>
        <th rowspan="2" class="col-auto col-num">Saldo</th>
        <th rowspan="2" class="col-auto col-num">🔒 Costo U.</th>
        <th rowspan="2" class="col-auto col-num">Cantidad</th>
        <th rowspan="2" class="col-auto col-num">Costo Total</th>
        <th rowspan="2" style="min-width:160px">Comentarios</th>
        ${lastCols}
      </tr>
      <tr>
        <th class="sub-header col-num">Cons. Est.</th>
        <th class="sub-header col-num">Real Venta</th>
        <th class="sub-header col-num">Real Transf.</th>
        <th class="sub-header col-num">Variación</th>
        <th class="sub-header col-num">Cons. Est.</th>
        <th class="sub-header col-num">Real Venta</th>
        <th class="sub-header col-num">Real Transf.</th>
        <th class="sub-header col-num">Variación</th>
      </tr>
    </thead>`;
}

function renderLineaRow(l, idx, editable = true, mode = 'edit') {
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

  return `<tr data-idx="${idx}" data-linea-id="${lid}"${isLocked ? ' style="opacity:.7;background:#f9fafb"' : ''}${rowClass}>
    <td class="col-item">
      ${(rowEditable && mode !== 'edit-revisar') ? `
        <div class="ac-wrap">
          <input type="text" class="tbl-input item-input" data-idx="${idx}" value="${esc(l.itemNombre || l.item || '')}" placeholder="Buscar item..." autocomplete="off">
          <div class="ac-dropdown hidden"></div>
        </div>
        <span class="auto-gestion-${idx}" style="margin-top:4px;display:inline-block">${gestionIcon(l.gestion)}</span>` : `
        <div style="display:flex;align-items:center;gap:6px">${gestionIcon(l.gestion)}<strong>${esc(l.itemNombre || l.item || '')}</strong></div>`}
    </td>
    <td><span class="auto-grupo-${idx}">${esc(l.grupoCompra || '—')}</span></td>
    <td class="col-num"><span class="auto-ceA-${idx} ${!l.semanaAnterior?'cell-loading':''}">${l.semanaAnterior ? fmt(sa.consumoEstimado) : '...'}</span></td>
    <td class="col-num"><span class="auto-rvA-${idx}">${l.semanaAnterior ? fmt(sa.consumoRealVenta) : '...'}</span></td>
    <td class="col-num"><span class="auto-rtA-${idx}">${l.semanaAnterior ? fmt(sa.consumoRealTransformacion) : '...'}</span></td>
    <td class="col-num"><span class="auto-vA-${idx} ${varA>=0?'variacion-pos':'variacion-neg'}">${l.semanaAnterior ? fmt(varA) : '...'}</span></td>
    <td class="col-num"><span class="auto-ceC-${idx}">${l.semanaActual ? fmt(sc.consumoEstimado) : '...'}</span></td>
    <td class="col-num"><span class="auto-rvC-${idx}">${l.semanaActual ? fmt(sc.consumoRealVenta) : '...'}</span></td>
    <td class="col-num"><span class="auto-rtC-${idx}">${l.semanaActual ? fmt(sc.consumoRealTransformacion) : '...'}</span></td>
    <td class="col-num"><span class="auto-vC-${idx} ${varC>=0?'variacion-pos':'variacion-neg'}">${l.semanaActual ? fmt(varC) : '...'}</span></td>
    <td class="col-num"><span class="auto-saldo-${idx}">${l.saldo != null ? fmt(l.saldo) : '...'}</span></td>
    <td class="col-num"><span class="auto-cu-${idx}">${l.costoUnitario != null ? fmtMoney(l.costoUnitario) : '...'}</span></td>
    <td class="col-num">
      ${rowEditable
        ? `<input type="number" class="tbl-input tbl-input-num cantidad-input" data-idx="${idx}" value="${l.cantidadSolicitada || ''}" min="0" step="0.01" style="width:90px">`
        : fmt(l.cantidadSolicitada)}
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
      tbody.innerHTML = f.lineas.map((l, i) => renderLineaRow(l, i, true, S.form.editMode || 'edit')).join('');
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
      S.form.lineas[idx].cantidadSolicitada = parseFloat(e.target.value) || null;
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
    set(`.auto-rtA-${idx}`, fmt(sa.consumoRealTransformacion));
    set(`.auto-vA-${idx}`, fmt(sa.variacion), `auto-vA-${idx} ${sa.variacion >= 0 ? 'variacion-pos' : 'variacion-neg'}`);
    set(`.auto-ceC-${idx}`, fmt(sc.consumoEstimado));
    set(`.auto-rvC-${idx}`, fmt(sc.consumoRealVenta));
    set(`.auto-rtC-${idx}`, fmt(sc.consumoRealTransformacion));
    set(`.auto-vC-${idx}`, fmt(sc.variacion), `auto-vC-${idx} ${sc.variacion >= 0 ? 'variacion-pos' : 'variacion-neg'}`);
    set(`.auto-saldo-${idx}`, fmt(data.saldo));
    set(`.auto-cu-${idx}`, fmtMoney(data.costoUnitario));
    const gEl = document.querySelector(`.auto-gestion-${idx}`);
    if (gEl) gEl.innerHTML = gestionIcon(data.gestion || 'COMPRAS');

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
  const lineas = S.form.lineas.filter(l => l.item);
  if (!lineas.length) return toast('Agregue al menos una línea con item', 'error');

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
      <button class="btn btn-primary" onclick="navigate('solicitar')">+ Nuevo Pedido</button>
    </div>
    <div class="page-body">
      <div class="filter-bar mb-16">
        <select id="filter-estado">
          <option value="">Todos los estados</option>
          ${ESTADOS.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
        <select id="filter-op">
          <option value="">Todas las operaciones</option>
          ${(S.user.operations || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); }

  function render() {
    const est = document.getElementById('filter-estado').value;
    const op  = document.getElementById('filter-op').value;
    const filtered = pedidos.filter(p => (!est || p.estado === est) && (!op || p.operacion === op));
    renderPedidosList(document.getElementById('pedidos-list'), filtered, { canEdit: true });
  }
  document.getElementById('filter-estado').addEventListener('change', render);
  document.getElementById('filter-op').addEventListener('change', render);
  render();
}

// ─── View: Comentarios ───────────────────────────────────────────
async function viewComentarios(container) {
  container.innerHTML = `
    <div class="page-header"><div class="page-title">💬 Comentarios</div></div>
    <div class="page-body">
      <div class="card" style="max-width:700px">
        <div class="card-body" style="padding:0;display:flex;flex-direction:column;height:65vh">
          <div id="com-list" style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px">
            <div class="loading-overlay"><span class="spinner spinner-dark"></span></div>
          </div>
          <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px">
            <textarea id="com-texto" placeholder="Escribe un comentario..." rows="2"
              style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:13px;resize:none"></textarea>
            <button class="btn btn-primary" id="com-send" style="align-self:flex-end">Enviar</button>
          </div>
        </div>
      </div>
    </div>`;

  async function loadComments() {
    const list = document.getElementById('com-list');
    if (!list) return;
    try {
      const comentarios = await GET('/comentarios');
      if (!list) return;
      if (!comentarios.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>Sin comentarios aún. ¡Sé el primero!</p></div>`;
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

  await loadComments();

  document.getElementById('com-send')?.addEventListener('click', async () => {
    const texto = document.getElementById('com-texto')?.value?.trim();
    if (!texto) return;
    const btn = document.getElementById('com-send');
    btn.disabled = true;
    try {
      await POST('/comentarios', { texto });
      document.getElementById('com-texto').value = '';
      await loadComments();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  // Enviar con Ctrl+Enter
  document.getElementById('com-texto')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) document.getElementById('com-send')?.click();
  });
}

// ─── View: Aprobar ────────────────────────────────────────────────
async function viewAprobar(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">✅ Aprobar Pedidos</div>
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
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); }

  function render() {
    const op  = document.getElementById('filter-op').value;
    const est = document.getElementById('filter-estado').value;
    const filtered = pedidos.filter(p =>
      (!op  || p.operacion === op) &&
      (!est || p.estado === est)
    );
    const pendientes  = filtered.filter(p => ['SOLICITADO','REVISAR'].includes(p.estado));
    const procesados  = filtered.filter(p => !['SOLICITADO','REVISAR'].includes(p.estado));
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
  render();
}

// ─── View: Atender ────────────────────────────────────────────────
async function viewAtender(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🚚 Atender Pedidos</div>
    </div>
    <div class="page-body">
      <div class="filter-bar mb-16">
        <select id="filter-op"><option value="">Todas las operaciones</option>
          ${(S.user.operations || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>
      <div id="pedidos-list"><div class="loading-overlay"><span class="spinner spinner-dark"></span> Cargando...</div></div>
    </div>`;

  let pedidos = [];
  try { pedidos = await GET('/pedidos?vista=atender'); } catch (err) { toast(err.message, 'error'); }

  function render() {
    const op = document.getElementById('filter-op').value;
    const filtered = pedidos.filter(p => !op || p.operacion === op);
    const activos   = filtered.filter(p => p.estado === 'APROBADO');
    const atendidos = filtered.filter(p => p.estado === 'ATENDIDO');
    const list = document.getElementById('pedidos-list');
    list.innerHTML = '';
    renderPedidosAtender(list, activos);
    if (atendidos.length) {
      const sep = document.createElement('div');
      sep.innerHTML = `<div class="section-title mt-8 mb-16" style="margin-top:32px;color:var(--text-muted)">✔ Atendidos</div>`;
      list.appendChild(sep);
      renderPedidosAtendidos(list, atendidos);
    }
  }
  document.getElementById('filter-op').addEventListener('change', render);
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
        ${renderLineasReadOnly(p.lineas)}
        <div class="mt-8 text-right font-bold">Total: ${fmtMoney(p.lineas.reduce((s,l)=>(s+(l.cantidadSolicitada||0)*(l.costoUnitario||0)),0))}</div>
      </div>
    </div>`;
}

function renderLineasReadOnly(lineas) {
  if (!lineas?.length) return '<p class="text-muted">Sin líneas</p>';
  const hasAtencion = lineas.some(l => l.estadoAtencion === 'ATENDIDO');
  const hasApproval = lineas.some(l => l.estadoLinea && l.estadoLinea !== 'PENDIENTE');
  const mode = hasAtencion ? 'atendido' : hasApproval ? 'approved' : 'read';
  return `<div class="table-wrap"><table>
    ${renderTableHeader(mode)}
    <tbody>
      ${lineas.map((l, i) => renderLineaRow(l, i, false, mode)).join('')}
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
              ${p.lineas.map((l, i) => renderLineaRow(l, i, false, 'approve')).join('')}
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
          <tbody>${p.lineas.map((l,i) => renderLineaRow(l, i, false, estadoMode)).join('')}</tbody>
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

function renderPedidosAtender(container, pedidos) {
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
        <div class="table-wrap">
          <table>
            ${renderTableHeader('atender')}
            <tbody>
              ${p.lineas.map((l, i) => {
                const lineaGestion = l.gestion || 'COMPRAS';
                const esPropia = S.user.role === 'ADMIN' || lineaGestion === gestionRol;
                return renderLineaRow(l, i, false, esPropia ? 'atender' : 'atendido');
              }).join('')}
            </tbody>
          </table>
        </div>
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

function renderPedidosAtendidos(container, pedidos) {
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
        <div class="table-wrap">
          <table>
            ${renderTableHeader('atendido')}
            <tbody>
              ${p.lineas.map((l, i) => renderLineaRow(l, i, false, 'atendido')).join('')}
            </tbody>
          </table>
        </div>
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

// ─── View: Admin ──────────────────────────────────────────────────
async function viewAdmin(container) {
  container.innerHTML = `
    <div class="page-header"><div class="page-title">⚙️ Administración</div></div>
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

  container.innerHTML = `
    <div class="section-title mb-16">Parámetros del sistema</div>
    <div class="card" style="max-width:500px">
      <div class="card-body">
        <div class="form-group">
          <label>Máxima variación permitida para auto-aprobación (%)</label>
          <input type="number" id="cfg-maxvar" class="form-control" value="${cfg.maxVariacion ?? 10}" min="0" max="100" step="1" style="width:120px">
          <p class="text-muted" style="font-size:12px;margin-top:4px">
            Si la cantidad solicitada ≤ sugerido × (1 + este %), la línea se auto-aprueba y no puede ser modificada.
          </p>
        </div>
        <button class="btn btn-primary" id="cfg-save">💾 Guardar configuración</button>
        <span id="cfg-status" style="margin-left:12px;font-size:13px"></span>
      </div>
    </div>`;

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
    btn.disabled = false; btn.textContent = '💾 Guardar configuración';
    setTimeout(() => { if (status) status.innerHTML = ''; }, 3000);
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
      <div class="form-group"><label>Operaciones asignadas</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
          ${ALL_OPS.map(op => `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
            <input type="checkbox" name="um-op" value="${op}" ${(user?.operations||[]).includes(op)?'checked':''}>
            ${op}
          </label>`).join('')}
        </div>
      </div>
      <div id="um-error" class="msg-error hidden"></div>
    </form>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
      <button class="btn btn-primary" id="um-save">💾 Guardar</button>
    </div>`;

  openModal(user ? 'Editar Usuario' : 'Nuevo Usuario', body);

  document.getElementById('um-save').addEventListener('click', async () => {
    const errEl = document.getElementById('um-error');
    errEl.classList.add('hidden');
    const data = {
      username: document.getElementById('um-username').value.trim(),
      email: document.getElementById('um-email').value.trim(),
      role: document.getElementById('um-role').value,
      operations: [...document.querySelectorAll('input[name="um-op"]:checked')].map(cb => cb.value)
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
  try { pedidos = await GET('/pedidos'); } catch (err) { toast(err.message, 'error'); }
  renderPedidosList(container, pedidos, { canEdit: false });
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

// ─── App Init ─────────────────────────────────────────────────────
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('sb-user').textContent = S.user.username;
  document.getElementById('sb-role').textContent = ROLE_LABELS[S.user.role] || S.user.role;
  renderNav();
  // Navigate to default view
  const role = S.user.role;
  if ([ROLES.SOL, ROLES.ADMIN].includes(role)) navigate('solicitar');
  else if (role === ROLES.APR) navigate('aprobar');
  else if (role === ROLES.ATE || role === ROLES.PLT) navigate('atender');
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

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);
});

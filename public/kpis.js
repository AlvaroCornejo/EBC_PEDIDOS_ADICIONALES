/* ═══════════════════════════════════════════════════════════════
   Indicadores de Gestión del Back Office (GAF) — kpis.js
   Módulo separado de app.js (se carga después y usa sus helpers:
   GET/POST/PUT, esc, toast, openModal, S). Prefijo kpi* / _kpi*.
   Los permisos reales se validan en el backend (utils/kpiAcceso.js);
   aquí solo se decide qué mostrar.
═══════════════════════════════════════════════════════════════ */

// ─── Formato peruano: S/, dd/mm/aaaa, coma de miles y punto decimal ──
const kpiFmtNum = (n, dec = 2) => n == null || n === '' || isNaN(n) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const kpiFmtFecha = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const p = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(dt);
  const v = (t) => p.find(x => x.type === t).value;
  return `${v('day')}/${v('month')}/${v('year')}`;
};

// Se llama en showApp(): deja S.kpi con el acceso vigente y S.user.kpiAcceso para el menú.
async function cargarAccesoKpis() {
  try { S.kpi = await GET('/kpis/mi-acceso'); } catch { S.kpi = { acceso: false }; }
  S.user.kpiAcceso = !!S.kpi.acceso;
}

// ─── Vista principal ──────────────────────────────────────────────
async function viewIndicadores(container) {
  await cargarAccesoKpis(); // en vivo: refleja cambios de permisos sin re-login
  if (!S.kpi.acceso) {
    container.innerHTML = `<div class="page-body"><div class="msg-error">No tienes acceso a Indicadores GAF.</div></div>`;
    return;
  }
  const tabs = [
    { id: 'dashboard', label: '📊 Dashboard' },
    ...(S.kpi.areas.some(a => a.nivel === 'CAPTURA') ? [{ id: 'captura', label: '✍️ Captura' }] : []),
    ...(S.kpi.esAdmin ? [{ id: 'config', label: '⚙️ Configuración' }] : []),
  ];
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">🎯 Indicadores GAF</div>
      <div class="text-muted" style="font-size:12px">${S.kpi.esAdmin ? 'Administrador' : S.kpi.esLector ? 'Lector global' : 'Acceso por área'}</div>
    </div>
    <div class="page-body">
      <div class="tabs">${tabs.map((t, i) => `<button class="tab-btn${i ? '' : ' active'}" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
      ${tabs.map((t, i) => `<div id="kpi-tab-${t.id}" class="tab-panel${i ? '' : ' active'}"></div>`).join('')}
    </div>`;

  const renderers = { dashboard: kpiRenderDashboard, captura: kpiRenderCaptura, config: kpiRenderConfig };
  const cargados = new Set();
  const abrir = (id) => {
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    container.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `kpi-tab-${id}`));
    if (!cargados.has(id)) { cargados.add(id); renderers[id](document.getElementById(`kpi-tab-${id}`)); }
  };
  container.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => abrir(b.dataset.tab)));
  abrir(tabs[0].id);
}

// ─── Dashboard (Etapa 4) ──────────────────────────────────────────
function kpiRenderDashboard(el) {
  el.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="section-title" style="margin-bottom:10px">Tus áreas</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${S.kpi.areas.map(a => `<span class="badge" style="background:${a.nivel === 'CAPTURA' ? '#eef2ff;color:#3730a3' : '#f1f5f9;color:#475569'}">
          ${esc(a.nombre)} · ${a.nivel === 'CAPTURA' ? 'Captura' : 'Lectura'}</span>`).join('')}
      </div>
      <p class="text-muted" style="font-size:13px;margin-top:14px">El dashboard con semáforos se habilita cuando esté cargado el catálogo de KPIs.</p>
    </div>`;
}

// ─── Captura (Etapa 3) ────────────────────────────────────────────
function kpiRenderCaptura(el) {
  el.innerHTML = `<div class="card" style="padding:16px"><p class="text-muted" style="font-size:13px">La captura de valores se habilita en la siguiente etapa.</p></div>`;
}

// ─── Configuración (solo admin de Indicadores) ────────────────────
function kpiRenderConfig(el) {
  el.innerHTML = `<div id="kpi-cfg-areas"></div>`;
  kpiRenderAdminAreas(document.getElementById('kpi-cfg-areas'));
}

async function kpiRenderAdminAreas(el) {
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let areas = [];
  try { areas = await GET('/kpis/areas'); } catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }

  el.innerHTML = `
    <div class="flex gap-12 items-center mb-16 justify-between">
      <div class="section-title">Áreas</div>
      <button class="btn btn-primary btn-sm" id="kpi-area-nueva">+ Nueva área</button>
    </div>
    <p class="text-muted" style="font-size:12px;margin-bottom:10px">
      Las áreas no se borran: una área desactivada deja de mostrarse y sus usuarios pierden el acceso a ella.
      Los accesos por usuario se asignan en Admin → Usuarios.
    </p>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Nombre</th><th style="width:90px">Orden</th><th style="width:100px">Estado</th><th class="col-actions">Acciones</th></tr></thead>
      <tbody>
        ${areas.map(a => `<tr ${a.activo ? '' : 'style="opacity:.55"'}>
          <td><strong>${esc(a.codigo)}</strong></td>
          <td>${esc(a.nombre)}</td>
          <td>${a.orden}</td>
          <td>${a.activo ? '<span class="badge" style="background:#dcfce7;color:#166534">Activa</span>' : '<span class="badge" style="background:#fee2e2;color:#991b1b">Inactiva</span>'}</td>
          <td class="col-actions"><div class="flex gap-8 justify-center">
            <button class="btn btn-xs btn-outline kpi-area-edit" data-cod="${esc(a.codigo)}" title="Editar">✏️</button>
            <button class="btn btn-xs btn-outline kpi-area-toggle" data-cod="${esc(a.codigo)}" title="${a.activo ? 'Desactivar' : 'Reactivar'}">${a.activo ? '🚫' : '✅'}</button>
          </div></td>
        </tr>`).join('')}
      </tbody>
    </table></div></div>`;

  const recargar = async () => { await cargarAccesoKpis(); kpiRenderAdminAreas(el); };

  document.getElementById('kpi-area-nueva').addEventListener('click', () => kpiModalArea(null, recargar));
  el.querySelectorAll('.kpi-area-edit').forEach(b => b.addEventListener('click', () =>
    kpiModalArea(areas.find(a => a.codigo === b.dataset.cod), recargar)));
  el.querySelectorAll('.kpi-area-toggle').forEach(b => b.addEventListener('click', async () => {
    const a = areas.find(x => x.codigo === b.dataset.cod);
    if (a.activo && !confirm(`¿Desactivar el área ${a.nombre}? Sus usuarios dejarán de verla.`)) return;
    try {
      await PUT(`/kpis/areas/${encodeURIComponent(a.codigo)}`, { activo: !a.activo });
      toast(a.activo ? 'Área desactivada' : 'Área reactivada', 'success');
      recargar();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function kpiModalArea(area, onSave) {
  openModal(area ? `Editar área ${area.codigo}` : 'Nueva área', `
    <div class="form-group"><label>Código *</label>
      <input type="text" id="kpi-area-codigo" value="${esc(area?.codigo || '')}" ${area ? 'disabled' : ''} placeholder="Ej. RRHH" style="text-transform:uppercase">
    </div>
    <div class="form-group"><label>Nombre *</label>
      <input type="text" id="kpi-area-nombre" value="${esc(area?.nombre || '')}">
    </div>
    <div class="form-group"><label>Orden</label>
      <input type="number" id="kpi-area-orden" value="${area?.orden ?? 0}">
    </div>
    <div id="kpi-area-error" class="msg-error hidden"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="kpi-area-guardar">💾 Guardar</button>
    </div>`);
  document.getElementById('kpi-area-guardar').addEventListener('click', async () => {
    const errEl = document.getElementById('kpi-area-error');
    const body = {
      nombre: document.getElementById('kpi-area-nombre').value.trim(),
      orden: document.getElementById('kpi-area-orden').value,
    };
    try {
      if (area) await PUT(`/kpis/areas/${encodeURIComponent(area.codigo)}`, body);
      else await POST('/kpis/areas', { ...body, codigo: document.getElementById('kpi-area-codigo').value.trim() });
      closeModal();
      toast('Área guardada', 'success');
      onSave();
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  });
}

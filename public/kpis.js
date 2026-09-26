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
  // 'YYYY-MM-DD' (vigencias, periodos) es una fecha calendario: no pasa por zona horaria
  // (new Date() la tomaría como medianoche UTC = día anterior en Lima).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const p = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(dt);
  const v = (t) => p.find(x => x.type === t).value;
  return `${v('day')}/${v('month')}/${v('year')}`;
};

const kpiHoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

// Enteros sin decimales, el resto con 2 (95 → "95", 99.5 → "99.50").
const kpiFmtAuto = (n) => n == null || n === '' || isNaN(n) ? '—' : kpiFmtNum(n, Number.isInteger(Number(n)) ? 0 : 2);

const KPI_UNIDADES = { '%': '%', 'S/': 'S/', 'US$': 'US$', dias: 'días', horas: 'horas', numero: 'N°', pp: 'pp' };
const KPI_SENTIDOS = { MAYOR: 'Mayor es mejor', MENOR: 'Menor es mejor', RANGO: 'Dentro de rango' };
const KPI_FRECUENCIAS = { SEMANAL: 'Semanal', MENSUAL: 'Mensual' };
const KPI_FUENTES = ['SPRING', 'BBVA', 'SUNAT', 'SIRE', 'Tickets TI', 'Monitoreo TI', 'EBC Gestión de Pagos', 'EBC Flujo de Caja', 'Manual'];

// Valor con su unidad: "S/ 1,250.00", "95 %", "24 horas", "3 N°".
function kpiFmtValor(v, unidad) {
  if (v == null || v === '' || isNaN(v)) return '—';
  if (unidad === 'S/' || unidad === 'US$') return `${unidad} ${kpiFmtNum(v, 2)}`;
  return `${kpiFmtAuto(v)} ${KPI_UNIDADES[unidad] || ''}`.trim();
}

// Meta legible: "≥ 95 % (ámbar ≥ 90)", "≤ 24 horas (ámbar ≤ 36)", "-10 a 10 % (± 5)", "Informativo".
function kpiTextoMeta(sentido, unidad, m) {
  if (!m) return '<span class="text-muted">Informativo</span>';
  if (sentido === 'RANGO') {
    if (m.rangoMin == null) return '<span class="text-muted">Informativo</span>';
    return `${kpiFmtAuto(m.rangoMin)} a ${kpiFmtValor(m.rangoMax, unidad)}${m.tolerancia ? ` <span class="text-muted">(± ${kpiFmtAuto(m.tolerancia)})</span>` : ''}`;
  }
  if (m.meta == null) return '<span class="text-muted">Informativo</span>';
  const op = sentido === 'MAYOR' ? '≥' : '≤';
  const ambar = m.umbralAmbar != null && m.umbralAmbar !== m.meta ? ` <span class="text-muted">(ámbar ${op} ${kpiFmtAuto(m.umbralAmbar)})</span>` : '';
  return `${op} ${kpiFmtValor(m.meta, unidad)}${ambar}`;
}

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
  const secciones = [
    { id: 'catalogo', label: '📋 Catálogo de KPIs', render: kpiRenderAdminCatalogo },
    { id: 'areas',    label: '🗂️ Áreas',            render: kpiRenderAdminAreas },
  ];
  el.innerHTML = `
    <div class="flex gap-8 mb-16">
      ${secciones.map((s, i) => `<button class="btn btn-sm ${i ? 'btn-outline' : 'btn-primary'} kpi-cfg-sec" data-sec="${s.id}">${s.label}</button>`).join('')}
    </div>
    <div id="kpi-cfg-body"></div>`;
  const abrir = (id) => {
    el.querySelectorAll('.kpi-cfg-sec').forEach(b => {
      b.classList.toggle('btn-primary', b.dataset.sec === id);
      b.classList.toggle('btn-outline', b.dataset.sec !== id);
    });
    secciones.find(s => s.id === id).render(document.getElementById('kpi-cfg-body'));
  };
  el.querySelectorAll('.kpi-cfg-sec').forEach(b => b.addEventListener('click', () => abrir(b.dataset.sec)));
  abrir('catalogo');
}

// ─── Catálogo de KPIs (admin) ─────────────────────────────────────
let _kpiCatFiltro = { area: '', inactivos: false, texto: '' };

async function kpiRenderAdminCatalogo(el) {
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let kpis, areas, responsables;
  try {
    [kpis, areas, responsables] = await Promise.all([
      GET('/kpis/definiciones?inactivos=1'), GET('/kpis/areas'), GET('/kpis/responsables'),
    ]);
  } catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  const nombreArea = Object.fromEntries(areas.map(a => [a.codigo, a.nombre]));
  const nombreUsuario = Object.fromEntries(responsables.map(u => [u.id, u.username]));
  const ctx = { areas, responsables, recargar: () => kpiRenderAdminCatalogo(el) };

  el.innerHTML = `
    <div class="flex gap-12 items-center mb-16" style="flex-wrap:wrap">
      <select id="kpi-cat-area" style="width:auto">
        <option value="">Todas las áreas</option>
        ${areas.map(a => `<option value="${esc(a.codigo)}" ${_kpiCatFiltro.area === a.codigo ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}
      </select>
      <input type="search" id="kpi-cat-texto" placeholder="Buscar código o nombre…" value="${esc(_kpiCatFiltro.texto)}" style="width:220px">
      <label style="display:flex;align-items:center;gap:6px;font-weight:normal;font-size:13px">
        <input type="checkbox" id="kpi-cat-inactivos" ${_kpiCatFiltro.inactivos ? 'checked' : ''}> Mostrar inactivos
      </label>
      <button class="btn btn-primary btn-sm" id="kpi-cat-nuevo" style="margin-left:auto">+ Nuevo KPI</button>
    </div>
    <div id="kpi-cat-tabla"></div>`;

  const pintar = () => {
    const t = _kpiCatFiltro.texto.toLowerCase();
    const visibles = kpis.filter(k => (!_kpiCatFiltro.area || k.areaCodigo === _kpiCatFiltro.area)
      && (_kpiCatFiltro.inactivos || k.activo)
      && (!t || k.codigo.toLowerCase().includes(t) || k.nombre.toLowerCase().includes(t)));
    const porArea = areas.map(a => [a, visibles.filter(k => k.areaCodigo === a.codigo)]).filter(([, ks]) => ks.length);
    document.getElementById('kpi-cat-tabla').innerHTML = !porArea.length
      ? `<div class="card text-muted" style="padding:16px">No hay KPIs con ese filtro.</div>`
      : porArea.map(([a, ks]) => `
        <div class="section-title" style="margin:18px 0 8px">${esc(a.nombre)} <span class="text-muted" style="font-weight:normal">(${ks.length})</span></div>
        <div class="card"><div class="table-wrap"><table>
          <thead><tr>
            <th>Código</th><th>KPI</th><th>Frecuencia</th><th>Meta vigente</th><th>Ámbito</th><th>Responsables</th><th class="col-actions">Acciones</th>
          </tr></thead>
          <tbody>${ks.map(k => `<tr ${k.activo ? '' : 'style="opacity:.55"'}>
            <td style="white-space:nowrap"><strong>${esc(k.codigo)}</strong>${k.activo ? '' : ' <span class="badge" style="background:#fee2e2;color:#991b1b">Inactivo</span>'}</td>
            <td>${esc(k.nombre)}<div class="text-muted" style="font-size:11px">${KPI_SENTIDOS[k.sentido]} · ${KPI_UNIDADES[k.unidad]}${k.tipoCaptura === 'RATIO' ? ' · numerador/denominador' : ''}${k.fuente ? ` · ${esc(k.fuente)}` : ''}</div></td>
            <td>${KPI_FRECUENCIAS[k.frecuencia]}</td>
            <td>${kpiTextoMeta(k.sentido, k.unidad, k.metaVigente)}${k.metasPorUnidad.length ? `<div class="text-muted" style="font-size:11px">+ metas propias: ${k.metasPorUnidad.map(esc).join(', ')}</div>` : ''}</td>
            <td>${k.unidades.length ? k.unidades.map(u => `<span class="badge" style="background:#f0fdf4;color:#166534;margin:1px">${esc(u)}</span>`).join('')
              : '<span style="color:#b45309;font-size:12px">⚠ Sin unidades</span>'}</td>
            <td style="font-size:12px">${k.responsables.length ? k.responsables.map(id => esc(nombreUsuario[id] || '¿?')).join(', ')
              : '<span style="color:#b45309">⚠ Sin responsable</span>'}</td>
            <td class="col-actions"><div class="flex gap-8 justify-center">
              <button class="btn btn-xs btn-outline" data-acc="editar" data-id="${k._id}" title="Editar">✏️</button>
              <button class="btn btn-xs btn-outline" data-acc="metas" data-id="${k._id}" title="Metas y versiones">🎯</button>
              <button class="btn btn-xs btn-outline" data-acc="estado" data-id="${k._id}" title="${k.activo ? 'Desactivar' : 'Reactivar'}">${k.activo ? '🚫' : '✅'}</button>
            </div></td>
          </tr>`).join('')}</tbody>
        </table></div></div>`).join('');
  };
  pintar();

  document.getElementById('kpi-cat-area').addEventListener('change', e => { _kpiCatFiltro.area = e.target.value; pintar(); });
  document.getElementById('kpi-cat-texto').addEventListener('input', e => { _kpiCatFiltro.texto = e.target.value; pintar(); });
  document.getElementById('kpi-cat-inactivos').addEventListener('change', e => { _kpiCatFiltro.inactivos = e.target.checked; pintar(); });
  document.getElementById('kpi-cat-nuevo').addEventListener('click', () => kpiModalDefinicion(null, ctx));
  document.getElementById('kpi-cat-tabla').addEventListener('click', async e => {
    const b = e.target.closest('button[data-acc]');
    if (!b) return;
    const k = kpis.find(x => x._id === b.dataset.id);
    if (b.dataset.acc === 'editar') return kpiModalDefinicion(k, ctx);
    if (b.dataset.acc === 'metas') return kpiModalMetas(k, ctx);
    if (k.activo && !confirm(`¿Desactivar ${k.codigo} — ${k.nombre}?\n\nDeja de pedirse su captura y de mostrarse en el dashboard. Su historial se conserva.`)) return;
    try {
      await PUT(`/kpis/definiciones/${k._id}`, { activo: !k.activo });
      toast(k.activo ? 'KPI desactivado' : 'KPI reactivado', 'success');
      ctx.recargar();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// Inputs de meta según el sentido (compartido por "Nuevo KPI" y "Nueva versión de meta").
function kpiCamposMetaHtml(sentido, prefijo, valores = {}) {
  const inp = (id, label, v) => `<div class="form-group" style="flex:1;min-width:120px"><label>${label}</label>
    <input type="number" step="any" id="${prefijo}-${id}" value="${v ?? ''}"></div>`;
  if (sentido === 'RANGO') {
    return `<div class="flex gap-12" style="flex-wrap:wrap">${inp('rangoMin', 'Mínimo', valores.rangoMin)}${inp('rangoMax', 'Máximo', valores.rangoMax)}${inp('tolerancia', 'Tolerancia ámbar (±)', valores.tolerancia)}</div>`;
  }
  const op = sentido === 'MENOR' ? '≤' : '≥';
  return `<div class="flex gap-12" style="flex-wrap:wrap">${inp('meta', `Meta (verde si ${op})`, valores.meta)}${inp('umbralAmbar', `Umbral ámbar (ámbar si ${op})`, valores.umbralAmbar)}</div>`;
}

function kpiLeerMeta(prefijo) {
  const out = {};
  for (const k of ['meta', 'umbralAmbar', 'rangoMin', 'rangoMax', 'tolerancia']) {
    const el = document.getElementById(`${prefijo}-${k}`);
    if (el) out[k] = el.value === '' ? null : el.value;
  }
  return out;
}

function kpiModalDefinicion(kpi, ctx) {
  const k = kpi || { unidad: '%', frecuencia: 'MENSUAL', tipoCaptura: 'DIRECTO', sentido: 'MAYOR', nivelAmbito: 'SOCIEDAD', plazoCapturaDias: 8, unidades: [], responsables: [], areaCodigo: _kpiCatFiltro.area || ctx.areas[0]?.codigo };
  const opts = (mapa, sel) => Object.entries(mapa).map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const hoyMes = kpiHoyLima().slice(0, 7);

  openModal(kpi ? `Editar ${kpi.codigo}` : 'Nuevo KPI', `
    <div class="flex gap-12">
      <div class="form-group" style="width:140px"><label>Código *</label>
        <input type="text" id="kd-codigo" value="${esc(k.codigo || '')}" ${kpi ? 'disabled' : ''} style="text-transform:uppercase" placeholder="COM-08"></div>
      <div class="form-group" style="flex:1"><label>Nombre *</label><input type="text" id="kd-nombre" value="${esc(k.nombre || '')}"></div>
    </div>
    <div class="flex gap-12">
      <div class="form-group" style="flex:1"><label>Área *</label>
        <select id="kd-area">${ctx.areas.map(a => `<option value="${esc(a.codigo)}" ${a.codigo === k.areaCodigo ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
      <div class="form-group" style="flex:1"><label>Fuente del dato</label>
        <input type="text" id="kd-fuente" list="kd-fuentes" value="${esc(k.fuente || '')}">
        <datalist id="kd-fuentes">${KPI_FUENTES.map(f => `<option value="${esc(f)}">`).join('')}</datalist></div>
    </div>
    <div class="form-group"><label>Descripción</label><textarea id="kd-descripcion" rows="2">${esc(k.descripcion || '')}</textarea></div>
    <div class="form-group"><label>Fórmula (explicación)</label><textarea id="kd-formula" rows="2" placeholder="Ej. OC entregadas completas y a tiempo / total de OC × 100">${esc(k.formula || '')}</textarea></div>
    <div class="flex gap-12" style="flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:130px"><label>Unidad</label><select id="kd-unidad">${opts(KPI_UNIDADES, k.unidad)}</select></div>
      <div class="form-group" style="flex:1;min-width:130px"><label>Frecuencia</label><select id="kd-frecuencia">${opts(KPI_FRECUENCIAS, k.frecuencia)}</select></div>
      <div class="form-group" style="flex:1;min-width:160px"><label>Tipo de captura</label>
        <select id="kd-tipo">${opts({ DIRECTO: 'Valor directo', RATIO: 'Numerador / denominador' }, k.tipoCaptura)}</select></div>
      <div class="form-group" style="flex:1;min-width:160px"><label>Sentido</label><select id="kd-sentido" ${kpi ? 'disabled title="Para cambiar el sentido cree un KPI nuevo: las metas vigentes dependen de él"' : ''}>${opts(KPI_SENTIDOS, k.sentido)}</select></div>
      <div class="form-group" style="width:130px"><label>Plazo captura (días)</label><input type="number" min="0" max="60" id="kd-plazo" value="${k.plazoCapturaDias}"></div>
    </div>
    <div class="text-muted" id="kd-ayuda-ratio" style="font-size:11px;margin:-6px 0 10px"></div>
    ${kpi ? '' : `
      <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
        <label style="font-weight:600;color:var(--text-muted)">Meta inicial <span style="font-weight:normal">(vacía = KPI informativo, sin semáforo)</span></label>
        <div id="kd-meta-campos"></div>
        <div class="form-group" style="width:200px"><label>Vigente desde</label><input type="date" id="kd-vigente" value="${hoyMes}-01"></div>
      </div>`}
    <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
      <label style="font-weight:600;color:var(--text-muted)">Ámbito — a qué unidades aplica</label>
      <select id="kd-nivel" style="width:auto;margin-bottom:8px">${opts({ SOCIEDAD: 'Por sociedad', OPERACION: 'Por operación' }, k.nivelAmbito)}</select>
      <div id="kd-unidades" style="display:flex;flex-wrap:wrap;gap:6px 16px"></div>
    </div>
    <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">
      <label style="font-weight:600;color:var(--text-muted)">Responsables de captura</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px 16px;max-height:140px;overflow:auto">
        ${ctx.responsables.map(u => `<label style="display:flex;align-items:center;gap:5px;font-weight:normal;font-size:13px">
          <input type="checkbox" class="kd-resp" value="${esc(u.id)}" ${k.responsables.includes(u.id) ? 'checked' : ''}> ${esc(u.username)}</label>`).join('')}
      </div>
      <div class="text-muted" style="font-size:11px;margin-top:4px">Reciben los recordatorios. Para poder registrar, además necesitan nivel Captura en el área (Admin → Usuarios).</div>
    </div>
    <div id="kd-error" class="msg-error hidden"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="kd-guardar">💾 Guardar</button>
    </div>`, null, { wide: true });

  const $ = (id) => document.getElementById(id);
  const seleccionadas = new Set(k.unidades);
  const pintarUnidades = () => {
    const lista = $('kd-nivel').value === 'OPERACION'
      ? (S.sociedades || []).flatMap(s => (s.operaciones || []).map(o => o.codigo))
      : (S.sociedades || []).map(s => s.codigo);
    $('kd-unidades').innerHTML = lista.map(c => `<label style="display:flex;align-items:center;gap:5px;font-weight:normal;font-size:13px">
      <input type="checkbox" class="kd-uni" value="${esc(c)}" ${seleccionadas.has(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')
      || '<span class="text-muted">No hay unidades en el catálogo de Sociedades y Operaciones.</span>';
  };
  const pintarAyuda = () => {
    $('kd-ayuda-ratio').textContent = $('kd-tipo').value === 'RATIO'
      ? `Se capturan numerador y denominador; la app calcula numerador ÷ denominador${$('kd-unidad').value === '%' ? ' × 100' : ''}.` : '';
  };
  const pintarMeta = () => { if ($('kd-meta-campos')) $('kd-meta-campos').innerHTML = kpiCamposMetaHtml($('kd-sentido').value, 'kd'); };
  pintarUnidades(); pintarAyuda(); pintarMeta();
  $('kd-unidades').addEventListener('change', e => { if (e.target.checked) seleccionadas.add(e.target.value); else seleccionadas.delete(e.target.value); });
  $('kd-nivel').addEventListener('change', () => { seleccionadas.clear(); pintarUnidades(); });
  $('kd-tipo').addEventListener('change', pintarAyuda);
  $('kd-unidad').addEventListener('change', pintarAyuda);
  $('kd-sentido').addEventListener('change', pintarMeta);

  $('kd-guardar').addEventListener('click', async () => {
    const body = {
      nombre: $('kd-nombre').value, areaCodigo: $('kd-area').value, fuente: $('kd-fuente').value,
      descripcion: $('kd-descripcion').value, formula: $('kd-formula').value,
      unidad: $('kd-unidad').value, frecuencia: $('kd-frecuencia').value, tipoCaptura: $('kd-tipo').value,
      plazoCapturaDias: Number($('kd-plazo').value),
      nivelAmbito: $('kd-nivel').value, unidades: [...seleccionadas],
      responsables: [...document.querySelectorAll('.kd-resp:checked')].map(c => c.value),
    };
    if (!kpi) Object.assign(body, { codigo: $('kd-codigo').value, sentido: $('kd-sentido').value, vigenteDesde: $('kd-vigente').value, ...kpiLeerMeta('kd') });
    try {
      if (kpi) await PUT(`/kpis/definiciones/${kpi._id}`, body);
      else await POST('/kpis/definiciones', body);
      closeModal();
      toast('KPI guardado', 'success');
      ctx.recargar();
    } catch (err) { $('kd-error').textContent = err.message; $('kd-error').classList.remove('hidden'); }
  });
}

async function kpiModalMetas(kpi, ctx) {
  let det;
  try { det = await GET(`/kpis/definiciones/${kpi._id}`); } catch (err) { toast(err.message, 'error'); return; }
  const hoyMes = kpiHoyLima().slice(0, 7);

  openModal(`Metas — ${kpi.codigo} ${kpi.nombre}`, `
    <p class="text-muted" style="font-size:12px;margin-bottom:10px">
      ${KPI_SENTIDOS[kpi.sentido]} · ${KPI_UNIDADES[kpi.unidad]}. Las versiones no se editan ni se borran:
      un cambio de meta crea una versión nueva desde su fecha de vigencia. Los registros ya guardados
      conservan la meta con la que se evaluaron.
    </p>
    <div class="table-wrap" style="max-height:220px;overflow:auto"><table>
      <thead><tr><th>Vigente desde</th><th>Aplica a</th><th>Meta</th><th>Motivo</th><th>Registrado por</th></tr></thead>
      <tbody>${det.versiones.length ? det.versiones.map(v => `<tr>
        <td>${kpiFmtFecha(v.vigenteDesde)}</td>
        <td>${v.unidadCodigo ? esc(v.unidadCodigo) : 'Todas'}</td>
        <td>${kpiTextoMeta(kpi.sentido, kpi.unidad, v)}</td>
        <td style="font-size:12px">${esc(v.motivo)}</td>
        <td style="font-size:12px">${esc(v.creadoPor)}<div class="text-muted">${kpiFmtFecha(v.creadoEn)}</div></td>
      </tr>`).join('') : '<tr><td colspan="5" class="text-muted">Sin metas: KPI informativo.</td></tr>'}</tbody>
    </table></div>
    <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:14px">
      <label style="font-weight:600;color:var(--text-muted)">Nueva versión</label>
      ${kpiCamposMetaHtml(kpi.sentido, 'km', det.metaVigente || {})}
      <div class="flex gap-12" style="flex-wrap:wrap">
        <div class="form-group" style="width:180px"><label>Vigente desde *</label><input type="date" id="km-vigente" value="${hoyMes}-01"></div>
        <div class="form-group" style="width:180px"><label>Aplica a</label>
          <select id="km-unidad"><option value="">Todas las unidades</option>
            ${kpi.unidades.map(u => `<option value="${esc(u)}">Solo ${esc(u)}</option>`).join('')}</select></div>
        <div class="form-group" style="flex:1;min-width:200px"><label>Motivo *</label><input type="text" id="km-motivo" placeholder="Ej. nueva política de compras"></div>
      </div>
    </div>
    <div id="km-error" class="msg-error hidden"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
      <button class="btn btn-primary" id="km-guardar">➕ Crear versión</button>
    </div>`, null, { wide: true });

  document.getElementById('km-guardar').addEventListener('click', async () => {
    const errEl = document.getElementById('km-error');
    try {
      await POST(`/kpis/definiciones/${kpi._id}/metas`, {
        ...kpiLeerMeta('km'),
        vigenteDesde: document.getElementById('km-vigente').value,
        unidadCodigo: document.getElementById('km-unidad').value,
        motivo: document.getElementById('km-motivo').value,
      });
      toast('Nueva versión de meta creada', 'success');
      closeModal();
      ctx.recargar();
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  });
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

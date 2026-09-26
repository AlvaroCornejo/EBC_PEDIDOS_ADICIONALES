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
    { id: 'registros', label: '🗒️ Registros' },
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

  const renderers = { dashboard: kpiRenderDashboard, captura: kpiRenderCaptura, registros: kpiRenderRegistros, config: kpiRenderConfig };
  const cargados = new Set();
  const abrir = (id) => {
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    container.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `kpi-tab-${id}`));
    if (!cargados.has(id)) { cargados.add(id); renderers[id](document.getElementById(`kpi-tab-${id}`)); }
  };
  container.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => abrir(b.dataset.tab)));
  abrir(tabs[0].id);
}

// ─── Dashboard ────────────────────────────────────────────────────
// Navegación interna: portada (tarjetas por área + pendientes) → área → KPI.
let _kpiDash = { mes: '', area: '', unidad: '', vista: 'portada', areaSel: '', kpiSel: '', unidadSel: '' };

async function kpiRenderDashboard(el) {
  const d = _kpiDash;
  el.innerHTML = `
    <div class="flex gap-12 items-center mb-16" style="flex-wrap:wrap">
      <label style="font-weight:normal;font-size:13px">Periodo <input type="month" id="kd-mes" value="${d.mes}" style="width:auto"></label>
      <select id="kd-area" style="width:auto"><option value="">Todas mis áreas</option>
        ${S.kpi.areas.map(a => `<option value="${esc(a.codigo)}" ${d.area === a.codigo ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select>
      <select id="kd-unidad" style="width:auto"><option value="">Todas las sociedades / operaciones</option></select>
      <button class="btn btn-outline btn-sm" id="kd-excel" style="margin-left:auto" title="Exporta lo que estás viendo">📥 Excel</button>
    </div>
    <div id="kd-cuerpo"><div class="loading-overlay"><span class="spinner spinner-dark"></span></div></div>`;
  const $ = (id) => document.getElementById(id);

  let t;
  try {
    t = await GET(`/kpis/dashboard?${new URLSearchParams({ ...(d.mes && { mes: d.mes }), ...(d.area && { area: d.area }), ...(d.unidad && { unidad: d.unidad }) })}`);
  } catch (err) { $('kd-cuerpo').innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  d.mes = t.mes;
  $('kd-mes').value = t.mes;
  $('kd-unidad').innerHTML += t.unidades.map(u => `<option value="${esc(u)}" ${d.unidad === u ? 'selected' : ''}>${esc(u)}</option>`).join('');

  const recargar = () => kpiRenderDashboard(el);
  $('kd-mes').addEventListener('change', e => { d.mes = e.target.value; recargar(); });
  $('kd-area').addEventListener('change', e => { d.area = e.target.value; d.vista = e.target.value ? 'area' : 'portada'; d.areaSel = e.target.value; recargar(); });
  $('kd-unidad').addEventListener('change', e => { d.unidad = e.target.value; recargar(); });
  $('kd-excel').addEventListener('click', () => kpiExportarExcel());

  const ir = (cambios) => { Object.assign(d, cambios); pintar(); };
  const pintar = () => {
    const cuerpo = $('kd-cuerpo');
    if (d.vista === 'kpi') return kpiDashDetalleKpi(cuerpo, t, ir);
    const area = t.areas.find(a => a.codigo === d.areaSel);
    if (d.vista === 'area' && area) return kpiDashDetalleArea(cuerpo, t, area, ir);
    d.vista = 'portada';
    kpiDashPortada(cuerpo, t, ir);
  };
  pintar();
}

function kpiDashConteo(conteo, pendientes) {
  const item = (c, n) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:12px">
    <span style="width:8px;height:8px;border-radius:50%;background:${KPI_COLORES[c].punto}"></span>${n} ${KPI_COLORES[c].label.toLowerCase()}</span>`;
  return ['VERDE', 'AMBAR', 'ROJO', 'SIN_DATO'].map(c => item(c, conteo[c])).join('')
    + (pendientes ? `<span class="text-muted" style="font-size:12px">${pendientes} en plazo</span>` : '');
}

function kpiDashPortada(el, t, ir) {
  el.innerHTML = `
    <div class="text-muted" style="font-size:12px;margin-bottom:10px">Resultados de ${esc(t.etiquetaMes)}
      (los KPIs semanales muestran la última semana que empieza en el mes).</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-bottom:22px">
      ${t.areas.map(a => {
        const c = KPI_COLORES[a.color ?? 'SIN_DATO'];
        const nKpis = a.kpis.reduce((s, k) => s + k.filas.length, 0);
        return `<button class="card kd-area" data-area="${esc(a.codigo)}" style="text-align:left;padding:0;cursor:pointer;border:1px solid var(--border);overflow:hidden;font:inherit">
          <div style="height:6px;background:${a.color ? c.punto : '#e2e8f0'}"></div>
          <div style="padding:14px 16px">
            <div class="flex items-center justify-between" style="gap:8px;margin-bottom:10px">
              <strong style="font-size:15px">${esc(a.nombre)}</strong>
              ${a.color ? kpiBadgeSemaforo(a.color) : '<span class="text-muted" style="font-size:12px">Sin KPIs medidos</span>'}
            </div>
            <div>${kpiDashConteo(a.conteo, a.pendientes)}</div>
            <div class="text-muted" style="font-size:11px;margin-top:8px">${nKpis} indicador${nKpis === 1 ? '' : 'es'} por unidad${a.informativos ? ` · ${a.informativos} informativo${a.informativos === 1 ? '' : 's'}` : ''}</div>
          </div>
        </button>`;
      }).join('') || '<div class="text-muted">Sin áreas para mostrar.</div>'}
    </div>
    <div id="kd-pendientes"></div>`;
  el.querySelectorAll('.kd-area').forEach(b => b.addEventListener('click', () => ir({ vista: 'area', areaSel: b.dataset.area })));
  kpiDashPendientes(document.getElementById('kd-pendientes'));
}

async function kpiDashPendientes(el) {
  const d = _kpiDash;
  let p;
  try { p = await GET(`/kpis/pendientes?${new URLSearchParams({ ...(d.area && { area: d.area }), ...(d.unidad && { unidad: d.unidad }) })}`); }
  catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    <div class="section-title" style="margin-bottom:8px">Pendientes de captura <span class="text-muted" style="font-weight:normal">(${p.total} vencido${p.total === 1 ? '' : 's'}, últimos 12 periodos)</span></div>
    ${!p.total ? `<div class="card text-muted" style="padding:14px;font-size:13px">✅ No hay capturas vencidas.</div>` : `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">
      ${p.grupos.map(g => `<div class="card" style="padding:12px 14px">
        <div class="flex items-center justify-between" style="margin-bottom:6px">
          <strong>${g.responsableId ? '👤' : '⚠️'} ${esc(g.responsable)}</strong>
          <span class="badge" style="background:#f1f5f9;color:#475569">${g.items.length}</span>
        </div>
        <div style="max-height:220px;overflow:auto">
          ${g.items.map(i => `<div style="font-size:12px;padding:4px 0;border-top:1px solid var(--border)">
            <strong>${esc(i.codigo)}</strong> ${esc(i.nombre)} · ${esc(i.unidad)} · ${esc(i.etiqueta)}
            <div class="text-muted">Venció ${kpiFmtFecha(i.vence)} · ${i.diasAtraso} día${i.diasAtraso === 1 ? '' : 's'} de atraso</div>
          </div>`).join('')}
        </div>
      </div>`).join('')}
    </div>`}`;
}

// Variación vs. el periodo anterior, coloreada por si es mejora (no por si sube).
function kpiDashVariacion(f, unidad) {
  if (f.variacion == null) return '<span class="text-muted">—</span>';
  if (f.variacion === 0) return '<span class="text-muted">= 0</span>';
  const flecha = f.variacion > 0 ? '▲' : '▼';
  const color = f.mejora === true ? '#166534' : f.mejora === false ? '#b91c1c' : 'var(--text-muted)';
  const u = unidad === '%' ? ' pp' : unidad === 'S/' || unidad === 'US$' ? '' : ` ${KPI_UNIDADES[unidad]}`;
  const valor = unidad === 'S/' || unidad === 'US$' ? kpiFmtValor(Math.abs(f.variacion), unidad) : kpiFmtAuto(Math.abs(f.variacion)) + u;
  return `<span style="color:${color};white-space:nowrap" title="vs. ${esc(kpiEtiquetaPeriodo(f.anterior.periodo))}: ${kpiFmtValor(f.anterior.valor, unidad)}">${flecha} ${valor}</span>`;
}

// Mini gráfico de 12 periodos: línea neutra, meta como referencia, último punto con su color.
function kpiSparkline(tendencia, meta, sentido) {
  const W = 120, H = 32, pad = 4;
  const vals = tendencia.map(p => p.valor).filter(v => v != null);
  if (!vals.length) return '<span class="text-muted" style="font-size:11px">sin historial</span>';
  const ref = meta ? (sentido === 'RANGO' ? [meta.rangoMin, meta.rangoMax] : [meta.meta]).filter(v => v != null) : [];
  let min = Math.min(...vals, ...ref), max = Math.max(...vals, ...ref);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => pad + (i * (W - 2 * pad)) / (tendencia.length - 1);
  const y = (v) => H - pad - ((v - min) / (max - min)) * (H - 2 * pad);
  let path = '', abierto = false;
  tendencia.forEach((p, i) => {
    if (p.valor == null) { abierto = false; return; }
    path += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`;
    abierto = true;
  });
  const iu = tendencia.map(p => p.valor != null).lastIndexOf(true);
  const ultimo = tendencia[iu];
  const c = KPI_COLORES[ultimo.semaforo ?? 'null'];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia de 12 periodos">
    ${ref.map(v => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="#94a3b8" stroke-width="1"/>`).join('')}
    <path d="${path}" fill="none" stroke="#64748b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(iu)}" cy="${y(ultimo.valor)}" r="4" fill="${c.punto}" stroke="#fff" stroke-width="2"/>
  </svg>`;
}

function kpiDashDetalleArea(el, t, area, ir) {
  const filas = area.kpis.flatMap(k => k.filas.map(f => ({ k, f })));
  el.innerHTML = `
    <div class="flex items-center gap-12" style="margin-bottom:12px;flex-wrap:wrap">
      ${_kpiDash.area ? '' : `<button class="btn btn-outline btn-sm" id="kd-volver">← Todas las áreas</button>`}
      <strong style="font-size:17px">${esc(area.nombre)}</strong> ${area.color ? kpiBadgeSemaforo(area.color) : ''}
      <span>${kpiDashConteo(area.conteo, area.pendientes)}</span>
    </div>
    ${!filas.length ? `<div class="card text-muted" style="padding:16px">Esta área no tiene KPIs activos con unidades asignadas.</div>` : `
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>KPI</th><th>Unidad</th><th>Periodo</th><th style="text-align:right">Valor</th><th>Meta</th><th>Semáforo</th><th>Var. vs anterior</th><th>Últimos 12</th></tr></thead>
      <tbody>${filas.map(({ k, f }) => `<tr class="kd-fila" data-kpi="${k._id}" data-unidad="${esc(f.unidad)}" style="cursor:pointer">
        <td><strong>${esc(k.codigo)}</strong> ${esc(k.nombre)}</td>
        <td>${esc(f.unidad)}</td>
        <td style="white-space:nowrap">${esc(f.etiqueta)}</td>
        <td style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${f.registrado ? kpiFmtValor(f.valor, k.unidad) : '—'}
          ${f.corregido ? ' <span title="Corregido">✏️</span>' : ''}${f.adjuntos ? ' <span title="Con evidencia">📎</span>' : ''}${f.comentario ? ` <span title="${esc(f.comentario)}">💬</span>` : ''}</td>
        <td style="font-size:12px">${kpiTextoMeta(k.sentido, k.unidad, f.meta)}</td>
        <td>${kpiDashEstado(f)}</td>
        <td>${kpiDashVariacion(f, k.unidad)}</td>
        <td>${kpiSparkline(f.tendencia, f.meta, k.sentido)}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`}`;
  document.getElementById('kd-volver')?.addEventListener('click', () => ir({ vista: 'portada' }));
  el.querySelectorAll('.kd-fila').forEach(tr => tr.addEventListener('click', () =>
    ir({ vista: 'kpi', areaSel: area.codigo, kpiSel: tr.dataset.kpi, unidadSel: tr.dataset.unidad })));
}

function kpiDashEstado(f) {
  if (f.estado === 'PENDIENTE') return `<span class="text-muted" style="font-size:12px;white-space:nowrap">En plazo · vence ${kpiFmtFecha(f.vence).slice(0, 5)}</span>`;
  if (f.estado === 'NO_EXIGIBLE') return '<span class="text-muted">—</span>';
  return kpiBadgeSemaforo(f.estado);
}

async function kpiDashDetalleKpi(el, t, ir) {
  const d = _kpiDash;
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let hst;
  try { hst = await GET(`/kpis/definiciones/${d.kpiSel}/historico?unidad=${encodeURIComponent(d.unidadSel)}&n=24`); }
  catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  const k = hst.kpi;
  const area = t.areas.find(a => a.codigo === k.areaCodigo);
  const puntos = hst.puntos;

  el.innerHTML = `
    <div class="flex items-center gap-12" style="margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" id="kd-volver">← ${esc(area?.nombre || 'Área')}</button>
      <strong style="font-size:17px">${esc(k.codigo)} — ${esc(k.nombre)}</strong>
      ${k.unidades.length > 1 ? `<select id="kd-kpi-unidad" style="width:auto">${k.unidades.map(u => `<option ${u === hst.unidad ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>` : `<span class="badge" style="background:#f1f5f9;color:#475569">${esc(hst.unidad)}</span>`}
    </div>
    <div class="text-muted" style="font-size:12px;margin-bottom:12px">${KPI_FRECUENCIAS[k.frecuencia]} · ${KPI_SENTIDOS[k.sentido]} · ${KPI_UNIDADES[k.unidad]}${k.fuente ? ` · Fuente: ${esc(k.fuente)}` : ''}${k.formula ? `<br>Fórmula: ${esc(k.formula)}` : ''}</div>
    <div class="card" style="padding:14px 16px;margin-bottom:16px;position:relative">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">Histórico de ${puntos.length} periodos · ${esc(hst.unidad)}</div>
      <div id="kd-grafico"></div>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Periodo</th><th style="text-align:right">Valor</th><th>Meta</th><th>Semáforo</th><th>Comentario</th><th>Registrado</th></tr></thead>
      <tbody>${[...puntos].reverse().map(p => `<tr ${p.registroId ? `class="kd-reg" data-id="${p.registroId}" style="cursor:pointer"` : ''}>
        <td style="white-space:nowrap">${esc(p.etiqueta)}</td>
        <td style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${p.valor != null ? kpiFmtValor(p.valor, k.unidad) : '—'}${p.corregido ? ' <span title="Corregido por el administrador">✏️</span>' : ''}</td>
        <td style="font-size:12px">${kpiTextoMeta(k.sentido, k.unidad, p.meta)}</td>
        <td>${kpiDashEstado(p)}</td>
        <td style="font-size:12px;max-width:320px">${esc(p.comentario)}${p.adjuntos.length ? p.adjuntos.map(a => ` <a href="#" onclick="event.stopPropagation();kpiAbrirAdjunto('${p.registroId}','${esc(a.boxFileId)}');return false" title="${esc(a.nombreOriginal)}">📎</a>`).join('') : ''}</td>
        <td style="font-size:12px;white-space:nowrap">${p.registroId ? `${esc(p.registradoPorNombre)}<div class="text-muted">${kpiFmtFecha(p.registradoEn)}</div>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;

  kpiGraficoHistorico(document.getElementById('kd-grafico'), puntos, k);
  document.getElementById('kd-volver').addEventListener('click', () => ir({ vista: 'area' }));
  document.getElementById('kd-kpi-unidad')?.addEventListener('change', e => ir({ unidadSel: e.target.value }));
  el.querySelectorAll('.kd-reg').forEach(tr => tr.addEventListener('click', () => kpiModalRegistro(tr.dataset.id, () => ir({}))));
}

// Gráfico histórico: una serie (sin leyenda), meta como línea escalonada de referencia
// (cambia si hubo nueva versión), puntos con el color del semáforo, tooltip al pasar.
function kpiGraficoHistorico(el, puntos, k) {
  const W = Math.max(el.clientWidth || 640, 320), H = 240;
  const m = { t: 12, r: 44, b: 28, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const metaDe = (p) => !p.meta ? [] : k.sentido === 'RANGO' ? [p.meta.rangoMin, p.meta.rangoMax] : [p.meta.meta];
  const vals = [...puntos.map(p => p.valor), ...puntos.flatMap(metaDe)].filter(v => v != null);
  if (!vals.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:30px 0;text-align:center">Aún no hay registros para graficar.</div>'; return; }

  // Escala con ticks "limpios".
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const paso0 = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= paso0);
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso;
  const ticks = []; for (let v = lo; v <= hi + paso / 2; v += paso) ticks.push(+v.toFixed(6));
  const x = (i) => m.l + (puntos.length === 1 ? iw / 2 : (i * iw) / (puntos.length - 1));
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const cada = Math.ceil(puntos.length / Math.max(Math.floor(iw / 70), 1)); // etiquetas X sin chocar

  let linea = '', abierto = false;
  puntos.forEach((p, i) => { if (p.valor == null) { abierto = false; return; } linea += `${abierto ? 'L' : 'M'}${x(i)},${y(p.valor)}`; abierto = true; });
  const escalon = (idx) => { // línea de meta escalonada por periodo
    let d = '';
    puntos.forEach((p, i) => {
      const v = metaDe(p)[idx]; if (v == null) return;
      const x0 = i === 0 ? x(0) : (x(i - 1) + x(i)) / 2, x1 = i === puntos.length - 1 ? x(i) : (x(i) + x(i + 1)) / 2;
      d += `M${x0},${y(v)}H${x1}`;
    });
    return d;
  };
  const ultimaMeta = [...puntos].reverse().find(p => metaDe(p).length);

  el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible" role="img" aria-label="Histórico de ${esc(k.nombre)}">
    ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef2f7" stroke-width="1"/>
      <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64748b" style="font-variant-numeric:tabular-nums">${kpiFmtAuto(v)}</text>`).join('')}
    ${puntos.map((p, i) => i % cada === 0 || i === puntos.length - 1
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#64748b">${esc(p.etiqueta.replace(' 20', " '"))}</text>` : '').join('')}
    ${[0, 1].map(idx => `<path d="${escalon(idx)}" stroke="#475569" stroke-width="1.5" fill="none"/>`).join('')}
    ${ultimaMeta ? `<text x="${W - m.r + 6}" y="${y(metaDe(ultimaMeta)[0]) + 4}" font-size="11" fill="#475569">Meta</text>` : ''}
    <path d="${linea}" fill="none" stroke="#64748b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${puntos.map((p, i) => p.valor != null
      ? `<circle cx="${x(i)}" cy="${y(p.valor)}" r="5" fill="${KPI_COLORES[p.estado ?? 'null'].punto}" stroke="#fff" stroke-width="2"/>`
      : p.estado === 'SIN_DATO' ? `<circle cx="${x(i)}" cy="${m.t + ih}" r="4" fill="#fff" stroke="#94a3b8" stroke-width="2"/>` : '').join('')}
    <line id="kd-cruz" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#94a3b8" stroke-width="1" visibility="hidden"/>
    ${puntos.map((p, i) => `<rect class="kd-hit" data-i="${i}" x="${x(i) - iw / puntos.length / 2}" y="${m.t}" width="${iw / puntos.length}" height="${ih}" fill="transparent"/>`).join('')}
  </svg>
  <div id="kd-tip" style="position:absolute;display:none;pointer-events:none;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.12);padding:8px 10px;font-size:12px;z-index:5"></div>`;

  const tip = el.querySelector('#kd-tip'), cruz = el.querySelector('#kd-cruz'), svg = el.querySelector('svg');
  el.querySelectorAll('.kd-hit').forEach(r => {
    r.addEventListener('mouseenter', () => {
      const p = puntos[r.dataset.i];
      cruz.setAttribute('x1', x(+r.dataset.i)); cruz.setAttribute('x2', x(+r.dataset.i)); cruz.setAttribute('visibility', 'visible');
      tip.innerHTML = `<strong>${esc(p.etiqueta)}</strong><br>${p.valor != null ? kpiFmtValor(p.valor, k.unidad) : 'Sin registro'} ${kpiDashEstado(p)}<br>
        <span class="text-muted">Meta: ${kpiTextoMeta(k.sentido, k.unidad, p.meta)}</span>${p.corregido ? '<br>✏️ Corregido' : ''}`;
      tip.style.display = 'block';
      const escala = svg.getBoundingClientRect().width / W;
      const px = x(+r.dataset.i) * escala;
      tip.style.left = `${Math.min(px + 16, svg.getBoundingClientRect().width - tip.offsetWidth)}px`;
      tip.style.top = '36px';
    });
    r.addEventListener('mouseleave', () => { tip.style.display = 'none'; cruz.setAttribute('visibility', 'hidden'); });
  });
}

// Etapa 5 (exportación): se completa en la siguiente etapa.
function kpiExportarExcel() { toast('La exportación a Excel se habilita en la siguiente etapa', 'info'); }

// ─── Semáforo ─────────────────────────────────────────────────────
const KPI_COLORES = {
  VERDE:    { bg: '#dcfce7', fg: '#166534', punto: '#16a34a', label: 'Verde' },
  AMBAR:    { bg: '#fef3c7', fg: '#92400e', punto: '#d97706', label: 'Ámbar' },
  ROJO:     { bg: '#fee2e2', fg: '#991b1b', punto: '#dc2626', label: 'Rojo' },
  SIN_DATO: { bg: '#f1f5f9', fg: '#475569', punto: '#94a3b8', label: 'Sin dato' },
  null:     { bg: '#eef2ff', fg: '#3730a3', punto: '#6366f1', label: 'Informativo' },
};
function kpiBadgeSemaforo(s) {
  const c = KPI_COLORES[s ?? 'null'] || KPI_COLORES.null;
  return `<span class="badge" style="background:${c.bg};color:${c.fg};white-space:nowrap">
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.punto};margin-right:4px"></span>${c.label}</span>`;
}

// POST multipart (el helper api() de app.js solo manda JSON).
async function kpiPostMultipart(path, datos, archivos) {
  const fd = new FormData();
  fd.append('datos', JSON.stringify(datos));
  for (const f of archivos || []) fd.append('archivos', f);
  const res = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${S.token}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// styles.css oculta todos los input[type=file]: se usa un botón que lo abre + la lista elegida.
const kpiSelectorArchivosHtml = (id) => `
  <input type="file" id="${id}" multiple>
  <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('${id}').click()">📎 Elegir archivos</button>
  <span id="${id}-lista" class="text-muted" style="font-size:12px;margin-left:8px">Ningún archivo</span>`;
function kpiBindSelectorArchivos(id) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    document.getElementById(`${id}-lista`).textContent = input.files.length
      ? [...input.files].map(f => `${f.name} (${f.size < 1048576 ? `${kpiFmtNum(f.size / 1024, 0)} KB` : `${kpiFmtNum(f.size / 1048576, 1)} MB`})`).join(', ') : 'Ningún archivo';
  });
}

async function kpiAbrirAdjunto(registroId, fileId) {
  try {
    const { url } = await GET(`/kpis/registros/${registroId}/adjuntos/${encodeURIComponent(fileId)}`);
    window.open(url, '_blank', 'noopener');
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Captura ──────────────────────────────────────────────────────
async function kpiRenderCaptura(el) {
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let opciones;
  try { opciones = await GET('/kpis/captura/opciones'); } catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  if (!opciones.length) {
    el.innerHTML = `<div class="card text-muted" style="padding:16px;font-size:13px">No hay KPIs para capturar en tus áreas
      (o aún no tienen unidades asignadas en el catálogo).</div>`;
    return;
  }
  const areas = Object.fromEntries(S.kpi.areas.map(a => [a.codigo, a.nombre]));
  const porArea = [...new Set(opciones.map(k => k.areaCodigo))];

  el.innerHTML = `
    <div class="card" style="padding:18px;max-width:760px">
      <div class="form-group"><label>KPI *</label>
        <select id="kc-kpi"><option value="">— Seleccione —</option>
          ${porArea.map(a => `<optgroup label="${esc(areas[a] || a)}">
            ${opciones.filter(k => k.areaCodigo === a).map(k => `<option value="${k._id}">${esc(k.codigo)} — ${esc(k.nombre)}</option>`).join('')}
          </optgroup>`).join('')}
        </select>
      </div>
      <div id="kc-info" class="text-muted" style="font-size:12px;margin:-4px 0 12px"></div>
      <div id="kc-resto" style="display:none">
        <div class="flex gap-12" style="flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:200px"><label>Periodo *</label><select id="kc-periodo"></select></div>
          <div class="form-group" style="flex:1;min-width:160px"><label>Unidad *</label><select id="kc-unidad"></select></div>
        </div>
        <div id="kc-ya" class="msg-info hidden" style="margin-bottom:12px"></div>
        <div id="kc-valores" class="flex gap-12" style="flex-wrap:wrap"></div>
        <div id="kc-resultado" style="font-size:13px;margin:-4px 0 12px"></div>
        <div class="form-group"><label>Comentario <span id="kc-com-oblig" style="color:#dc2626;display:none">* (obligatorio: resultado en rojo)</span></label>
          <textarea id="kc-comentario" rows="3" maxlength="2000"></textarea></div>
        <div class="form-group"><label>Evidencia (opcional, se guarda en Box)</label>
          <div>${kpiSelectorArchivosHtml('kc-archivos')}</div>
          <div class="text-muted" style="font-size:11px;margin-top:4px">Hasta 5 archivos de 20 MB cada uno.</div></div>
        <div id="kc-error" class="msg-error hidden"></div>
        <button class="btn btn-primary" id="kc-revisar">Revisar y registrar</button>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  kpiBindSelectorArchivos('kc-archivos');
  let kpi = null, registrados = new Set();

  const datosForm = () => ({
    kpiId: kpi._id, periodo: $('kc-periodo').value, unidadCodigo: $('kc-unidad').value,
    ...(kpi.tipoCaptura === 'RATIO'
      ? { numerador: $('kc-num').value, denominador: $('kc-den').value }
      : { valor: $('kc-valor').value }),
  });

  const pintarYaRegistrado = () => {
    const ya = registrados.has(`${$('kc-periodo').value}|${$('kc-unidad').value}`);
    $('kc-ya').classList.toggle('hidden', !ya);
    $('kc-ya').textContent = ya ? 'Este KPI ya está registrado para ese periodo y unidad. Revísalo en la pestaña Registros.' : '';
    $('kc-revisar').disabled = ya;
  };

  // Resultado y semáforo en vivo (el backend es quien calcula: mismo criterio que al guardar).
  let evalSeq = 0;
  const evaluar = async () => {
    const d = datosForm();
    const vacio = kpi.tipoCaptura === 'RATIO' ? (d.numerador === '' || d.denominador === '') : d.valor === '';
    if (vacio) { $('kc-resultado').innerHTML = ''; $('kc-com-oblig').style.display = 'none'; return null; }
    const seq = ++evalSeq;
    try {
      const r = await POST('/kpis/registros/evaluar', d);
      if (seq !== evalSeq) return null;
      $('kc-resultado').innerHTML = `Resultado: <strong>${kpiFmtValor(r.valor, kpi.unidad)}</strong> ${kpiBadgeSemaforo(r.semaforo)}
        <span class="text-muted">Meta del periodo: ${kpiTextoMeta(kpi.sentido, kpi.unidad, r.meta)}</span>`;
      $('kc-com-oblig').style.display = r.comentarioObligatorio ? 'inline' : 'none';
      return r;
    } catch (err) {
      if (seq === evalSeq) $('kc-resultado').innerHTML = `<span style="color:#dc2626">${esc(err.message)}</span>`;
      return null;
    }
  };

  $('kc-kpi').addEventListener('change', async () => {
    kpi = opciones.find(k => k._id === $('kc-kpi').value) || null;
    $('kc-resto').style.display = kpi ? 'block' : 'none';
    if (!kpi) { $('kc-info').innerHTML = ''; return; }
    $('kc-info').innerHTML = `${KPI_FRECUENCIAS[kpi.frecuencia]} · ${KPI_SENTIDOS[kpi.sentido]} · Meta: ${kpiTextoMeta(kpi.sentido, kpi.unidad, kpi.metaVigente)}
      ${kpi.formula ? `<br>Fórmula: ${esc(kpi.formula)}` : ''}`;
    $('kc-periodo').innerHTML = kpi.periodos.map(p => `<option value="${p.periodo}" ${p.periodo === kpi.periodoSugerido ? 'selected' : ''}>
      ${esc(p.etiqueta)}${kpi.frecuencia === 'SEMANAL' ? ` (${kpiFmtFecha(p.inicio).slice(0, 5)} – ${kpiFmtFecha(p.fin).slice(0, 5)})` : ''}${p.periodo > kpi.periodoSugerido ? ' — en curso' : ''}</option>`).join('');
    $('kc-unidad').innerHTML = kpi.unidades.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    const campo = (id, label) => `<div class="form-group" style="flex:1;min-width:150px"><label>${label} *</label><input type="number" step="any" id="${id}"></div>`;
    $('kc-valores').innerHTML = kpi.tipoCaptura === 'RATIO'
      ? campo('kc-num', 'Numerador') + campo('kc-den', 'Denominador')
      : campo('kc-valor', `Valor (${KPI_UNIDADES[kpi.unidad]})`);
    $('kc-valores').querySelectorAll('input').forEach(i => i.addEventListener('input', evaluar));
    $('kc-resultado').innerHTML = '';
    try {
      const regs = await GET(`/kpis/registros?kpiId=${kpi._id}`);
      registrados = new Set(regs.map(r => `${r.periodo}|${r.unidadCodigo}`));
    } catch { registrados = new Set(); }
    pintarYaRegistrado();
  });
  $('kc-periodo').addEventListener('change', () => { pintarYaRegistrado(); evaluar(); });
  $('kc-unidad').addEventListener('change', () => { pintarYaRegistrado(); evaluar(); });

  $('kc-revisar').addEventListener('click', async () => {
    const errEl = $('kc-error');
    errEl.classList.add('hidden');
    const r = await evaluar();
    if (!r) { errEl.textContent = 'Complete el valor para continuar.'; errEl.classList.remove('hidden'); return; }
    const comentario = $('kc-comentario').value.trim();
    if (r.comentarioObligatorio && !comentario) { errEl.textContent = 'El resultado queda en rojo: el comentario es obligatorio.'; errEl.classList.remove('hidden'); return; }
    const archivos = [...$('kc-archivos').files];
    const d = datosForm();
    const periodo = kpi.periodos.find(p => p.periodo === d.periodo);

    openModal('Confirmar registro', `
      <table style="font-size:14px;margin-bottom:14px"><tbody>
        <tr><td class="text-muted" style="padding:3px 16px 3px 0">KPI</td><td><strong>${esc(kpi.codigo)}</strong> — ${esc(kpi.nombre)}</td></tr>
        <tr><td class="text-muted" style="padding:3px 16px 3px 0">Periodo</td><td>${esc(periodo?.etiqueta || d.periodo)}</td></tr>
        <tr><td class="text-muted" style="padding:3px 16px 3px 0">Unidad</td><td>${esc(d.unidadCodigo)}</td></tr>
        ${kpi.tipoCaptura === 'RATIO' ? `<tr><td class="text-muted" style="padding:3px 16px 3px 0">Cálculo</td><td>${kpiFmtAuto(d.numerador)} ÷ ${kpiFmtAuto(d.denominador)}${kpi.unidad === '%' ? ' × 100' : ''}</td></tr>` : ''}
        <tr><td class="text-muted" style="padding:3px 16px 3px 0">Resultado</td><td><strong>${kpiFmtValor(r.valor, kpi.unidad)}</strong> ${kpiBadgeSemaforo(r.semaforo)}</td></tr>
        <tr><td class="text-muted" style="padding:3px 16px 3px 0">Meta</td><td>${kpiTextoMeta(kpi.sentido, kpi.unidad, r.meta)}</td></tr>
        ${comentario ? `<tr><td class="text-muted" style="padding:3px 16px 3px 0">Comentario</td><td>${esc(comentario)}</td></tr>` : ''}
        ${archivos.length ? `<tr><td class="text-muted" style="padding:3px 16px 3px 0">Evidencia</td><td>${archivos.map(f => esc(f.name)).join(', ')}</td></tr>` : ''}
      </tbody></table>
      <div class="msg-error" style="font-weight:600">⚠️ Una vez registrado, este valor no podrá modificarse.</div>
      <div id="kc-conf-error" class="msg-error hidden" style="margin-top:8px"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Volver</button>
        <button class="btn btn-primary" id="kc-confirmar">✔ Registrar</button>
      </div>`);
    $('kc-confirmar').addEventListener('click', async () => {
      const btn = $('kc-confirmar');
      btn.disabled = true; btn.textContent = archivos.length ? '⏳ Subiendo evidencia…' : '⏳ Registrando…';
      try {
        await kpiPostMultipart('/kpis/registros', { ...d, comentario, confirmado: true }, archivos);
        closeModal();
        toast('Valor registrado', 'success');
        kpiRenderCaptura(el); // formulario limpio
      } catch (err) {
        $('kc-conf-error').textContent = err.message; $('kc-conf-error').classList.remove('hidden');
        btn.disabled = false; btn.textContent = '✔ Registrar';
      }
    });
  });
}

// ─── Registros (historial) ────────────────────────────────────────
let _kpiRegFiltro = { area: '', kpiId: '', desde: '', hasta: '' };

async function kpiRenderRegistros(el) {
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let kpis;
  try { kpis = await GET('/kpis/definiciones'); } catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  const f = _kpiRegFiltro;
  el.innerHTML = `
    <div class="flex gap-12 items-center mb-16" style="flex-wrap:wrap">
      <select id="kr-area" style="width:auto"><option value="">Todas mis áreas</option>
        ${S.kpi.areas.map(a => `<option value="${esc(a.codigo)}" ${f.area === a.codigo ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select>
      <select id="kr-kpi" style="width:auto;max-width:320px"></select>
      <label style="font-weight:normal;font-size:13px">Desde <input type="month" id="kr-desde" value="${f.desde}" style="width:auto"></label>
      <label style="font-weight:normal;font-size:13px">Hasta <input type="month" id="kr-hasta" value="${f.hasta}" style="width:auto"></label>
    </div>
    <div id="kr-tabla"></div>`;
  const $ = (id) => document.getElementById(id);
  const pintarKpis = () => {
    $('kr-kpi').innerHTML = `<option value="">Todos los KPIs</option>` + kpis.filter(k => !f.area || k.areaCodigo === f.area)
      .map(k => `<option value="${k._id}" ${f.kpiId === k._id ? 'selected' : ''}>${esc(k.codigo)} — ${esc(k.nombre)}</option>`).join('');
  };
  const cargar = async () => {
    $('kr-tabla').innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
    // desde/hasta por mes; el backend filtra por la fecha de inicio de cada periodo.
    const q = new URLSearchParams({ ...(f.area && { area: f.area }), ...(f.kpiId && { kpiId: f.kpiId }),
      ...(f.desde && { desde: f.desde }), ...(f.hasta && { hasta: f.hasta }) });
    let regs;
    try { regs = await GET(`/kpis/registros?${q}`); } catch (err) { $('kr-tabla').innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
    $('kr-tabla').innerHTML = !regs.length ? `<div class="card text-muted" style="padding:16px">Sin registros con ese filtro.</div>` : `
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Periodo</th><th>KPI</th><th>Unidad</th><th style="text-align:right">Valor</th><th>Meta</th><th>Semáforo</th><th>Comentario</th><th>Registrado</th></tr></thead>
        <tbody>${regs.map(r => `<tr class="kr-fila" data-id="${r._id}" style="cursor:pointer">
          <td style="white-space:nowrap">${esc(kpiEtiquetaPeriodo(r.periodo))}</td>
          <td><strong>${esc(r.kpiCodigo)}</strong> ${esc(kpis.find(k => k._id === r.kpiId)?.nombre || '')}</td>
          <td>${esc(r.unidadCodigo)}</td>
          <td style="text-align:right;white-space:nowrap">${kpiFmtValor(r.valor, r.unidad)}</td>
          <td style="font-size:12px">${kpiTextoMeta(r.sentido, r.unidad, r.meta)}</td>
          <td>${kpiBadgeSemaforo(r.semaforo)}${r.corregido ? ' <span class="badge" style="background:#fef3c7;color:#92400e" title="Corregido por el administrador">✏️ corregido</span>' : ''}</td>
          <td style="font-size:12px;max-width:260px">${esc((r.comentario || '').slice(0, 90))}${(r.comentario || '').length > 90 ? '…' : ''}${r.adjuntos.length ? ` <span title="Evidencia">📎${r.adjuntos.length}</span>` : ''}</td>
          <td style="font-size:12px;white-space:nowrap">${esc(r.registradoPorNombre)}<div class="text-muted">${kpiFmtFecha(r.registradoEn)}</div></td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
    $('kr-tabla').querySelectorAll('.kr-fila').forEach(tr => tr.addEventListener('click', () => kpiModalRegistro(tr.dataset.id, cargar)));
  };
  pintarKpis();
  $('kr-area').addEventListener('change', e => { f.area = e.target.value; f.kpiId = ''; pintarKpis(); cargar(); });
  $('kr-kpi').addEventListener('change', e => { f.kpiId = e.target.value; cargar(); });
  $('kr-desde').addEventListener('change', e => { f.desde = e.target.value; cargar(); });
  $('kr-hasta').addEventListener('change', e => { f.hasta = e.target.value; cargar(); });
  cargar();
}

// 'Set 2026' / 'S39 2026' (misma regla que utils/kpiPeriodo.js: etiqueta).
function kpiEtiquetaPeriodo(p) {
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-W(\d{2})$/.exec(p);
  return m ? `S${Number(m[2])} ${m[1]}` : p;
}

// Detalle de un registro: datos, evidencia, bitácora y (admin) corrección.
async function kpiModalRegistro(id, alCambiar) {
  let r;
  try { r = await GET(`/kpis/registros/${id}`); } catch (err) { toast(err.message, 'error'); return; }
  const fechaHora = (d) => `${kpiFmtFecha(d)} ${fmtTime(d)}`;
  const txtEstado = (e) => !e ? '—' : e.adjuntos ? `Evidencia: ${e.adjuntos.map(esc).join(', ')}`
    : `${kpiFmtValor(e.valor, r.unidad)}${e.numerador != null ? ` (${kpiFmtAuto(e.numerador)} ÷ ${kpiFmtAuto(e.denominador)})` : ''} ${kpiBadgeSemaforo(e.semaforo)}${e.comentario ? `<div class="text-muted" style="font-size:12px">“${esc(e.comentario)}”</div>` : ''}`;
  const ACC = { CREACION: '🆕 Registro', CORRECCION: '✏️ Corrección', ADJUNTO: '📎 Evidencia agregada' };

  openModal(`${r.kpiCodigo} · ${kpiEtiquetaPeriodo(r.periodo)} · ${r.unidadCodigo}`, `
    <div class="flex gap-12 items-center" style="flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:24px;font-weight:700">${kpiFmtValor(r.valor, r.unidad)}</div>
      ${kpiBadgeSemaforo(r.semaforo)}
      ${r.corregido ? `<span class="badge" style="background:#fef3c7;color:#92400e">✏️ Corregido ${r.nCorrecciones} ${r.nCorrecciones === 1 ? 'vez' : 'veces'}</span>` : ''}
    </div>
    <div style="font-size:13px;margin-bottom:12px">
      ${r.tipoCaptura === 'RATIO' ? `<div>Cálculo: ${kpiFmtAuto(r.numerador)} ÷ ${kpiFmtAuto(r.denominador)}${r.unidad === '%' ? ' × 100' : ''}</div>` : ''}
      <div>Meta del periodo: ${kpiTextoMeta(r.sentido, r.unidad, r.meta)}</div>
      <div class="text-muted">Registrado por ${esc(r.registradoPorNombre)} el ${fechaHora(r.registradoEn)}</div>
    </div>
    ${r.comentario ? `<div class="card" style="padding:10px 12px;font-size:13px;margin-bottom:12px">💬 ${esc(r.comentario)}</div>` : ''}
    ${r.adjuntos.length ? `<div style="margin-bottom:12px"><div class="section-title" style="font-size:12px;margin-bottom:6px">Evidencia</div>
      ${r.adjuntos.map(a => `<button class="btn btn-xs btn-outline" style="margin:2px" onclick="kpiAbrirAdjunto('${r._id}','${esc(a.boxFileId)}')">📎 ${esc(a.nombreOriginal)}</button>`).join('')}</div>` : ''}
    <div class="section-title" style="font-size:12px;margin-bottom:6px">Historial (bitácora de auditoría)</div>
    <div class="kpi-bitacora" style="border-left:2px solid var(--border);padding-left:12px">
      ${r.auditoria.map(a => `<div style="margin-bottom:12px;font-size:13px">
        <div><strong>${ACC[a.accion]}</strong> · ${esc(a.usuarioNombre)} · <span class="text-muted">${fechaHora(a.fechaHora)}</span></div>
        ${a.accion === 'CORRECCION'
          ? `<div style="margin-top:3px">Antes: ${txtEstado(a.antes)}</div><div>Después: ${txtEstado(a.despues)}</div>`
          : `<div style="margin-top:3px">${txtEstado(a.despues)}</div>`}
        ${a.motivo ? `<div class="text-muted" style="font-size:12px">Motivo: ${esc(a.motivo)}</div>` : ''}
      </div>`).join('')}
    </div>
    ${S.kpi.esAdmin ? `
      <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">✏️ Corregir (administrador)</summary>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-top:8px">
          <div class="flex gap-12" style="flex-wrap:wrap">
            ${r.tipoCaptura === 'RATIO'
              ? `<div class="form-group" style="flex:1;min-width:130px"><label>Numerador</label><input type="number" step="any" id="kx-num" value="${r.numerador}"></div>
                 <div class="form-group" style="flex:1;min-width:130px"><label>Denominador</label><input type="number" step="any" id="kx-den" value="${r.denominador}"></div>`
              : `<div class="form-group" style="flex:1;min-width:130px"><label>Valor</label><input type="number" step="any" id="kx-valor" value="${r.valor}"></div>`}
          </div>
          <div class="form-group"><label>Comentario</label><textarea id="kx-comentario" rows="2">${esc(r.comentario)}</textarea></div>
          <div class="form-group"><label>Motivo de la corrección *</label><input type="text" id="kx-motivo"></div>
          <div class="text-muted" style="font-size:11px;margin-bottom:8px">Queda en la bitácora con el valor anterior, el nuevo, tu usuario y la hora. El semáforo se recalcula con la meta del periodo.</div>
          <button class="btn btn-primary btn-sm" id="kx-corregir">Guardar corrección</button>
        </div>
      </details>
      <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">📎 Agregar evidencia (administrador)</summary>
        <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:8px">
          <div style="margin-bottom:8px">${kpiSelectorArchivosHtml('kx-archivos')}</div>
          <div class="form-group"><label>Motivo *</label><input type="text" id="kx-adj-motivo"></div>
          <button class="btn btn-outline btn-sm" id="kx-adjuntar">Subir evidencia</button>
        </div>
      </details>` : ''}
    <div id="kx-error" class="msg-error hidden" style="margin-top:8px"></div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cerrar</button></div>`, null, { wide: true });

  if (!S.kpi.esAdmin) return;
  const $ = (i) => document.getElementById(i);
  kpiBindSelectorArchivos('kx-archivos');
  const error = (m) => { $('kx-error').textContent = m; $('kx-error').classList.remove('hidden'); };
  const listo = (msg) => { toast(msg, 'success'); kpiModalRegistro(id, alCambiar); alCambiar?.(); };
  $('kx-corregir').addEventListener('click', async () => {
    const body = { comentario: $('kx-comentario').value, motivo: $('kx-motivo').value,
      ...(r.tipoCaptura === 'RATIO' ? { numerador: $('kx-num').value, denominador: $('kx-den').value } : { valor: $('kx-valor').value }) };
    if (!confirm('¿Guardar la corrección? Quedará registrada en la bitácora de auditoría.')) return;
    try { await PUT(`/kpis/registros/${id}/corregir`, body); listo('Registro corregido'); }
    catch (err) { error(err.message); }
  });
  $('kx-adjuntar').addEventListener('click', async () => {
    const archivos = [...$('kx-archivos').files];
    if (!archivos.length) return error('Seleccione al menos un archivo');
    try { await kpiPostMultipart(`/kpis/registros/${id}/adjuntos`, { motivo: $('kx-adj-motivo').value }, archivos); listo('Evidencia agregada'); }
    catch (err) { error(err.message); }
  });
}

// ─── Configuración (solo admin de Indicadores) ────────────────────
function kpiRenderConfig(el) {
  const secciones = [
    { id: 'catalogo', label: '📋 Catálogo de KPIs', render: kpiRenderAdminCatalogo },
    { id: 'areas',    label: '🗂️ Áreas',            render: kpiRenderAdminAreas },
    { id: 'general',  label: '🔧 General y Box',    render: kpiRenderAdminGeneral },
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

// ─── General y Box (admin) ────────────────────────────────────────
const KPI_REGLAS = {
  MAS_FRECUENTE_PISO_AMBAR: 'Color más frecuente; con algún KPI en rojo, al menos ámbar',
  MAS_FRECUENTE: 'Color más frecuente',
  PEOR: 'El peor color presente',
};

async function kpiRenderAdminGeneral(el) {
  el.innerHTML = `<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>`;
  let cfg;
  try { cfg = await GET('/kpis/config'); } catch (err) { el.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }
  el.innerHTML = `
    <div class="card" style="padding:16px;max-width:720px;margin-bottom:16px">
      <div class="section-title" style="margin-bottom:10px">Resumen del área en el dashboard</div>
      <select id="kg-regla">${cfg.reglasResumen.map(r => `<option value="${r}" ${cfg.kpiReglaResumen === r ? 'selected' : ''}>${esc(KPI_REGLAS[r] || r)}</option>`).join('')}</select>
      <div class="text-muted" style="font-size:11px;margin-top:4px">Los KPIs informativos no cuentan; los empates se resuelven hacia el color más grave.</div>
    </div>
    <div class="card" style="padding:16px;max-width:720px">
      <div class="section-title" style="margin-bottom:10px">Evidencias en Box</div>
      <div class="form-group"><label>ID de la carpeta de Box</label>
        <div class="flex gap-8"><input type="text" id="kg-carpeta" value="${esc(cfg.kpiBoxCarpetaId)}" placeholder="Ej. 312345678901" style="max-width:240px">
        <button class="btn btn-outline btn-sm" id="kg-probar">Probar conexión</button></div>
        <div class="text-muted" style="font-size:11px;margin-top:4px">Es el número al final de la URL de la carpeta en Box (…/folder/<strong>312345678901</strong>).
          Dentro se crean subcarpetas Área / KPI / Periodo / Unidad. La carpeta debe estar compartida con la cuenta de servicio de la app de Box.</div>
        <div id="kg-probar-res" style="font-size:13px;margin-top:6px"></div>
      </div>
      <details ${cfg.box.clientId ? '' : 'open'}><summary style="cursor:pointer;font-weight:600;font-size:13px">Credenciales de la app de Box ${cfg.box.secretConfigurado ? '✅' : '⚠️ sin configurar'}</summary>
        ${cfg.puedeEditarBox ? `
          <div class="text-muted" style="font-size:11px;margin:6px 0">Compartidas con toda la app. El secreto nunca se muestra: déjelo vacío para no cambiarlo.</div>
          <div class="flex gap-12" style="flex-wrap:wrap">
            <div class="form-group" style="flex:1;min-width:200px"><label>Client ID</label><input type="text" id="kg-client" value="${esc(cfg.box.clientId)}"></div>
            <div class="form-group" style="flex:1;min-width:200px"><label>Client Secret</label><input type="password" id="kg-secret" placeholder="${cfg.box.secretConfigurado ? '●●●●●● (sin cambios)' : ''}" autocomplete="new-password"></div>
            <div class="form-group" style="flex:1;min-width:160px"><label>Enterprise ID</label><input type="text" id="kg-enterprise" value="${esc(cfg.box.enterpriseId)}"></div>
          </div>`
          : `<div class="text-muted" style="font-size:12px;margin-top:6px">Solo el administrador de la app puede cambiarlas.</div>`}
      </details>
      <div id="kg-error" class="msg-error hidden" style="margin-top:8px"></div>
      <button class="btn btn-primary btn-sm" id="kg-guardar" style="margin-top:10px">💾 Guardar</button>
    </div>`;
  const $ = (id) => document.getElementById(id);
  $('kg-regla').addEventListener('change', async e => {
    try { await PUT('/kpis/config', { kpiReglaResumen: e.target.value }); toast('Regla actualizada', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('kg-guardar').addEventListener('click', async () => {
    const body = { kpiBoxCarpetaId: $('kg-carpeta').value };
    if (cfg.puedeEditarBox) body.box = { clientId: $('kg-client').value, clientSecret: $('kg-secret').value, enterpriseId: $('kg-enterprise').value };
    try { await PUT('/kpis/config', body); toast('Configuración guardada', 'success'); kpiRenderAdminGeneral(el); }
    catch (err) { $('kg-error').textContent = err.message; $('kg-error').classList.remove('hidden'); }
  });
  $('kg-probar').addEventListener('click', async () => {
    $('kg-probar-res').innerHTML = '⏳ Probando…';
    try {
      const r = await POST('/kpis/config/probar-box', {});
      $('kg-probar-res').innerHTML = `<span style="color:#166534">✅ Conectado a la carpeta “${esc(r.nombre)}”</span>`;
    } catch (err) { $('kg-probar-res').innerHTML = `<span style="color:#dc2626">❌ ${esc(err.message)}</span>`; }
  });
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

/* ═══════════════════════════════════════════════════════════════
   Costo de Producción de planta — costoProduccion.js
   Módulo separado de app.js (se carga después y usa sus helpers:
   GET, esc, toast, S). Prefijo cp* / _cp*.
   Costo receta vs. costo real por ítem y mes (EBC COSTO DE PRODUCCION.xlsx).
   Desviación = (costo receta − costo real) / costo receta:
   verde ≥ 10 %, amarillo 0 – 9.99 %, rojo < 0 (mismo semáforo del Excel).
   El backend (routes/costoProduccion.js) ya filtra las áreas permitidas.
═══════════════════════════════════════════════════════════════ */

const CP_MESES   = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const CP_MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CP_AREA_NOMBRE = { PANADERIA: 'Panadería', PREP: 'Prep', REPOSTERIA: 'Repostería' };
// Colores por área en orden fijo (no por ranking): un área conserva su color con cualquier filtro.
const CP_COLORES = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#4a3aa7'];
const CP_SEM = { g: { color: '#0ca30c', label: 'Verde' }, y: { color: '#fab219', label: 'Amarillo' }, r: { color: '#d03b3b', label: 'Rojo' } };

const cpAreaNombre = a => CP_AREA_NOMBRE[a] || (a.charAt(0) + a.slice(1).toLowerCase());
const cpSem = d => d == null ? 'n' : d >= 0.10 ? 'g' : d >= 0 ? 'y' : 'r';
const cpFmtS  = v => (v < 0 ? '−' : '') + 'S/ ' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const cpFmtS2 = v => 'S/ ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cpFmtP  = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';
const cpFmtN  = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
const cpCls   = v => v == null ? '' : v >= 0 ? 'cp-pos' : 'cp-neg';

/** Totales de un grupo de ítems en unos meses: solo ítems con costo receta y meses con producción. */
function cpAgg(items, meses) {
  let rec = 0, real = 0, q = 0;
  for (const it of items) {
    if (!(it.costoReceta > 0)) continue;
    for (const m of meses) {
      const x = it.meses[m];
      if (!x || !(x.cantidad > 0) || !(x.costoReal > 0)) continue;
      rec += x.cantidad * it.costoReceta; real += x.cantidad * x.costoReal; q += x.cantidad;
    }
  }
  return { rec, real, q, imp: rec - real, dev: rec ? (rec - real) / rec : null };
}
const cpDevMes = (it, m) => {
  const x = it.meses[m];
  return it.costoReceta > 0 && x && x.cantidad > 0 && x.costoReal > 0 ? (it.costoReceta - x.costoReal) / it.costoReceta : null;
};

function cpEstilos() {
  if (document.getElementById('cp-style')) return;
  const st = document.createElement('style');
  st.id = 'cp-style';
  st.textContent = `
  .cp-wrap{display:flex;flex-direction:column;gap:16px}
  .cp-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:14px}
  .cp-bar label{font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px}
  .cp-seg{display:inline-flex;flex-wrap:wrap;gap:2px;background:var(--bg);border-radius:8px;padding:3px}
  .cp-seg button{border:0;background:none;padding:6px 11px;border-radius:6px;font-size:13px;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:5px}
  .cp-seg button:hover{background:var(--white)}
  .cp-seg button.on{background:var(--sidebar);color:#fff}
  .cp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
  .cp-kpi{padding:14px 16px;display:flex;flex-direction:column;gap:3px;min-width:0}
  .cp-kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)}
  .cp-kpi .v{font-size:24px;font-weight:700;line-height:1.15}
  .cp-kpi .n{font-size:12px;color:var(--text-muted)}
  .cp-pos{color:#067a06} .cp-neg{color:#b42323}
  .cp-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
  .cp-lights{display:flex;gap:12px;font-size:20px;font-weight:700;align-items:center}
  .cp-lights span{display:inline-flex;align-items:center;gap:5px}
  .cp-row{display:grid;grid-template-columns:1.25fr 1fr;gap:12px}
  @media (max-width:900px){.cp-row{grid-template-columns:1fr}}
  .cp-panel{padding:16px;min-width:0;display:flex;flex-direction:column;gap:10px}
  .cp-panel h3{margin:0;font-size:15px}
  .cp-hint{margin:0;font-size:12px;color:var(--text-muted)}
  .cp-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--text-muted)}
  .cp-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:6px}
  .cp-legend i.sq{width:10px;height:10px}
  .cp-panel svg{display:block;width:100%;height:auto;overflow:visible}
  .cp-panel svg text{font-size:11px;fill:var(--text-muted)}
  .cp-tip{position:fixed;pointer-events:none;background:var(--sidebar);color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.45;z-index:3000;max-width:300px;box-shadow:var(--shadow-md)}
  .cp-tip .r{display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums}
  .cp-hb{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center}
  .cp-hb .nm{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cp-hb .vl{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .cp-hb .tr{grid-column:1/-1;height:8px;background:var(--bg);border-radius:4px}
  .cp-hb .tr div{height:100%;border-radius:4px}
  .cp-tscroll{overflow-x:auto}
  .cp-tbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:880px;font-size:13px}
  .cp-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);font-weight:600;text-align:right;padding:9px 8px;border-bottom:1px solid var(--border);cursor:pointer;white-space:nowrap;user-select:none}
  .cp-tbl th.on{color:var(--text)}
  .cp-tbl td{padding:7px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
  .cp-tbl th:nth-child(-n+2),.cp-tbl td:nth-child(-n+2){text-align:left}
  .cp-tbl td.nm{white-space:normal;min-width:240px}
  .cp-tbl td.nm small{display:block;color:var(--text-muted);font-size:11px}
  .cp-tbl tbody tr:hover td{background:var(--accent-light)}
  .cp-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid var(--border);background:var(--white)}
  .cp-strip{display:inline-flex;gap:2px}
  .cp-strip span{width:13px;height:13px;border-radius:3px;background:var(--border)}
  .cp-foot{font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px}`;
  document.head.appendChild(st);
}

async function viewCostoProduccion(container) {
  cpEstilos();
  const st = { anio: null, area: 'ALL', mes: 0, sem: 'ALL', q: '', sort: 'imp', dir: 1 }; // mes 0 = acumulado
  let D = null; // respuesta de /datos

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🏭 Costo de Producción</div>
      <div id="cp-cargado" style="font-size:12px;color:var(--text-muted)"></div></div>
    <div class="page-body"><div id="cp-root" class="cp-wrap"><div class="text-muted text-center py-24">⏳ Cargando...</div></div></div>`;
  const root = document.getElementById('cp-root');

  let tip = document.getElementById('cp-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'cp-tip'; tip.className = 'cp-tip'; tip.hidden = true; document.body.appendChild(tip); }
  const showTip = (e, html) => {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const hideTip = () => { tip.hidden = true; };

  async function cargar(anio) {
    try {
      D = await GET('/costo-produccion/datos' + (anio ? `?anio=${anio}` : ''));
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }
    if (!D.anio) { root.innerHTML = '<div class="empty-state"><p>Todavía no hay datos de costo de producción cargados.</p></div>'; return; }
    st.anio = D.anio;
    if (st.area !== 'ALL' && !D.areas.includes(st.area)) st.area = 'ALL';
    if (st.mes && !D.meses.includes(st.mes)) st.mes = 0;
    D.color = Object.fromEntries(D.areas.map((a, i) => [a, CP_COLORES[i % CP_COLORES.length]]));
    document.getElementById('cp-cargado').textContent = D.cargadoEn ? `Actualizado: ${kpiFmtFecha(D.cargadoEn)}` : '';
    esqueleto();
    render();
  }

  const mesesSel = () => st.mes ? [st.mes] : D.meses;
  const itemsSel = () => D.items.filter(it => st.area === 'ALL' || it.area === st.area);
  const periodo = () => st.mes ? `${CP_MESES_L[st.mes]} ${D.anio}` : `acumulado ${CP_MESES_L[D.meses[0]].toLowerCase()} – ${CP_MESES_L[D.meses[D.meses.length - 1]].toLowerCase()} ${D.anio}`;
  const setMes = m => { st.mes = st.mes === m ? 0 : m; document.getElementById('cp-mes').value = st.mes; render(); };

  function esqueleto() {
    const seg = (id, opts, val) => `<div class="cp-seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    root.innerHTML = `
      <div class="card cp-bar">
        ${D.anios.length > 1 ? `<div><label for="cp-anio">Año</label><select id="cp-anio" class="form-control" style="width:100px">${D.anios.map(a => `<option ${a === D.anio ? 'selected' : ''}>${a}</option>`).join('')}</select></div>` : ''}
        <div><label for="cp-mes">Periodo</label><select id="cp-mes" class="form-control" style="width:190px">
          <option value="0">Acumulado del año</option>${D.meses.map(m => `<option value="${m}">${CP_MESES_L[m]}</option>`).join('')}</select></div>
        ${D.areas.length > 1 ? `<div><label>Área</label>${seg('cp-area', [['ALL', 'Todas'], ...D.areas.map(a => [a, cpAreaNombre(a)])], st.area)}</div>` : ''}
      </div>
      <div class="cp-kpis" id="cp-kpis"></div>
      <div class="cp-row">
        <div class="card cp-panel"><div><h3>Desviación ponderada por mes</h3><p class="cp-hint">Ponderada por cantidad producida. Sobre 0 = se produjo por debajo del costo receta. Clic en un mes para verlo.</p></div>
          <div class="cp-legend" id="cp-leg"></div><div id="cp-trend"></div></div>
        <div class="card cp-panel"><div><h3>Semáforo de ítems por mes</h3><p class="cp-hint">Ítems con producción en el mes, según su desviación.</p></div>
          <div class="cp-legend"><span><i class="sq" style="background:${CP_SEM.g.color}"></i>Verde ≥ 10%</span><span><i class="sq" style="background:${CP_SEM.y.color}"></i>Amarillo 0 – 9.99%</span><span><i class="sq" style="background:${CP_SEM.r.color}"></i>Rojo &lt; 0</span></div>
          <div id="cp-stack"></div></div>
      </div>
      <div class="cp-row">
        <div class="card cp-panel"><div><h3>Mayores sobrecostos (S/)</h3><p class="cp-hint" id="cp-top-h"></p></div><div id="cp-top"></div></div>
        <div class="card cp-panel"><div><h3>Mayores ahorros (S/)</h3><p class="cp-hint" id="cp-bot-h"></p></div><div id="cp-bot"></div></div>
      </div>
      <div class="card cp-panel">
        <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:flex-end">
          <div><h3>Detalle por ítem</h3><p class="cp-hint" id="cp-tbl-h"></p></div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
            <input type="search" id="cp-q" class="form-control" style="width:220px" placeholder="Buscar ítem o código" value="${esc(st.q)}">
            ${seg('cp-sem', [['ALL', 'Todos'], ['r', `<span class="cp-dot" style="background:${CP_SEM.r.color}"></span>Rojo`], ['y', `<span class="cp-dot" style="background:${CP_SEM.y.color}"></span>Amarillo`], ['g', `<span class="cp-dot" style="background:${CP_SEM.g.color}"></span>Verde`]], st.sem)}
          </div>
        </div>
        <div class="cp-tscroll"><table class="cp-tbl"><thead id="cp-thead"></thead><tbody id="cp-tbody"></tbody></table></div>
      </div>
      <div class="cp-foot" id="cp-foot"></div>`;

    document.getElementById('cp-anio')?.addEventListener('change', e => cargar(Number(e.target.value)));
    const selMes = document.getElementById('cp-mes');
    selMes.value = st.mes;
    selMes.addEventListener('change', () => { st.mes = Number(selMes.value); render(); });
    document.getElementById('cp-area')?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.area = b.dataset.v; render(); });
    document.getElementById('cp-sem').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.sem = b.dataset.v; renderTabla(); });
    document.getElementById('cp-q').addEventListener('input', e => { st.q = e.target.value.trim().toLowerCase(); renderTabla(); });
  }

  function render() {
    document.querySelectorAll('#cp-area button').forEach(b => b.classList.toggle('on', b.dataset.v === st.area));
    renderKpis(); renderTendencia(); renderSemaforo(); renderTops(); renderTabla();
  }

  function renderKpis() {
    const items = itemsSel(), a = cpAgg(items, mesesSel());
    const cnt = { g: 0, y: 0, r: 0 };
    items.forEach(it => { const d = cpAgg([it], mesesSel()); if (d.q > 0) cnt[cpSem(d.dev)]++; });
    const s = cpSem(a.dev);
    document.getElementById('cp-kpis').innerHTML = `
      <div class="card cp-kpi"><span class="l">Costo real</span><span class="v">${cpFmtS(a.real)}</span><span class="n">${periodo()}</span></div>
      <div class="card cp-kpi"><span class="l">Costo receta</span><span class="v">${cpFmtS(a.rec)}</span><span class="n">misma cantidad a costo receta</span></div>
      <div class="card cp-kpi"><span class="l">Desviación ponderada</span><span class="v ${cpCls(a.dev)}">${cpFmtP(a.dev)}</span>
        <span class="n">${CP_SEM[s] ? `<span class="cp-dot" style="background:${CP_SEM[s].color}"></span> ${CP_SEM[s].label} · ${a.dev >= 0 ? 'bajo' : 'sobre'} receta` : 'sin datos'}</span></div>
      <div class="card cp-kpi"><span class="l">${a.imp >= 0 ? 'Ahorro neto' : 'Sobrecosto neto'}</span><span class="v ${cpCls(a.imp)}">${cpFmtS(Math.abs(a.imp))}</span><span class="n">(receta − real) × cantidad</span></div>
      <div class="card cp-kpi"><span class="l">Ítems por semáforo</span>
        <span class="cp-lights">${['g', 'y', 'r'].map(k => `<span title="${CP_SEM[k].label}"><span class="cp-dot" style="background:${CP_SEM[k].color}"></span>${cnt[k]}</span>`).join('')}</span>
        <span class="n">verde · amarillo · rojo</span></div>`;
  }

  function renderTendencia() {
    const M = D.meses, W = 640, H = 270, L = 46, R = 16, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
    const areas = st.area === 'ALL' ? D.areas : [st.area];
    const series = areas.map(a => ({ name: cpAreaNombre(a), color: D.color[a], vals: M.map(m => cpAgg(D.items.filter(it => it.area === a), [m])) }));
    if (st.area === 'ALL' && D.areas.length > 1) series.push({ name: 'Planta total', color: 'var(--text)', dash: true, vals: M.map(m => cpAgg(D.items, [m])) });
    const todos = series.flatMap(s => s.vals.map(v => v.dev)).filter(v => v != null);
    let lo = Math.min(0, ...todos), hi = Math.max(0.10, ...todos);
    lo = Math.floor(lo / 0.05) * 0.05; hi = Math.ceil(hi / 0.05) * 0.05;
    const paso = (hi - lo) / 0.05 > 8 ? 0.10 : 0.05;
    const x = i => M.length === 1 ? L + iw / 2 : L + iw * (i / (M.length - 1));
    const y = v => T + ih * (1 - (v - lo) / (hi - lo));
    let g = '';
    if (hi > 0.10) g += `<rect x="${L}" y="${y(hi)}" width="${iw}" height="${y(0.10) - y(hi)}" fill="${CP_SEM.g.color}" opacity=".06"/>`;
    for (let v = Math.ceil(lo / paso - 1e-9) * paso; v <= hi + 1e-9; v += paso) {
      const cero = Math.abs(v) < 1e-9;
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${cero ? '#c4c7cf' : '#e8eaf0'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`;
    }
    M.forEach((m, i) => g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" ${m === st.mes ? 'style="fill:var(--text);font-weight:700"' : ''}>${CP_MESES[m]}</text>`);
    if (st.mes) g += `<line x1="${x(M.indexOf(st.mes))}" x2="${x(M.indexOf(st.mes))}" y1="${T}" y2="${T + ih}" stroke="#c4c7cf" stroke-dasharray="3 3"/>`;
    for (const s of series) {
      let d = '', pen = false;
      s.vals.forEach((v, i) => { if (v.dev == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v.dev).toFixed(1)}`; pen = true; });
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
      const u = s.vals.length - 1;
      if (s.vals[u].dev != null) g += `<circle cx="${x(u)}" cy="${y(s.vals[u].dev)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
    }
    g += `<line class="cp-xh" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="#6b7280" opacity="0"/>`;
    const ancho = M.length > 1 ? iw / (M.length - 1) : iw;
    M.forEach((m, i) => g += `<rect class="cp-hit" data-i="${i}" x="${x(i) - ancho / 2}" y="${T}" width="${ancho}" height="${ih}" fill="transparent" style="cursor:pointer"/>`);
    const el = document.getElementById('cp-trend');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Desviación ponderada mensual por área">${g}</svg>`;
    document.getElementById('cp-leg').innerHTML = series.map(s => `<span><i style="background:${s.dash ? `repeating-linear-gradient(90deg,${s.color} 0 5px,transparent 5px 8px)` : s.color}"></i>${esc(s.name)}</span>`).join('');
    const xh = el.querySelector('.cp-xh');
    el.querySelectorAll('.cp-hit').forEach(r => {
      const i = Number(r.dataset.i);
      r.addEventListener('mousemove', e => {
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', '.5');
        showTip(e, `<b>${CP_MESES_L[M[i]]}</b>` + series.map(s => `<div class="r"><span>${esc(s.name)}</span><span>${cpFmtP(s.vals[i].dev)} · ${cpFmtS(s.vals[i].imp)}</span></div>`).join(''));
      });
      r.addEventListener('mouseleave', () => { xh.setAttribute('opacity', '0'); hideTip(); });
      r.addEventListener('click', () => { hideTip(); setMes(M[i]); });
    });
  }

  function renderSemaforo() {
    const M = D.meses, W = 520, H = 270, L = 34, R = 8, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
    const items = itemsSel();
    const data = M.map(m => { const c = { g: 0, y: 0, r: 0 }; items.forEach(it => { const d = cpDevMes(it, m); if (d != null) c[cpSem(d)]++; }); return c; });
    const max = Math.max(1, ...data.map(c => c.g + c.y + c.r));
    const paso = max > 100 ? 40 : max > 40 ? 20 : max > 10 ? 10 : 2;
    const tope = Math.ceil(max / paso) * paso;
    const bw = iw / M.length, bar = Math.min(bw * 0.62, 48), y = v => T + ih * (1 - v / tope);
    let g = '';
    for (let v = 0; v <= tope; v += paso) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? '#e8eaf0' : '#c4c7cf'}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    data.forEach((c, i) => {
      const x0 = L + bw * i + (bw - bar) / 2;
      const segs = ['r', 'y', 'g'].filter(k => c[k] > 0);
      let acc = 0;
      segs.forEach((k, j) => {
        const yy = y(acc + c[k]), h = y(acc) - yy - (j > 0 ? 2 : 0); // 2px de separación entre tramos
        if (j === segs.length - 1) {
          const rr = Math.min(4, h / 2, bar / 2);
          g += `<path d="M${x0} ${yy + h} V${yy + rr} Q${x0} ${yy} ${x0 + rr} ${yy} H${x0 + bar - rr} Q${x0 + bar} ${yy} ${x0 + bar} ${yy + rr} V${yy + h} Z" fill="${CP_SEM[k].color}"/>`;
        } else g += `<rect x="${x0}" y="${yy}" width="${bar}" height="${Math.max(0, h)}" fill="${CP_SEM[k].color}"/>`;
        acc += c[k];
      });
      g += `<text x="${x0 + bar / 2}" y="${H - 8}" text-anchor="middle" ${M[i] === st.mes ? 'style="fill:var(--text);font-weight:700"' : ''}>${CP_MESES[M[i]]}</text>`;
      g += `<rect class="cp-hit" data-i="${i}" x="${L + bw * i}" y="${T}" width="${bw}" height="${ih}" fill="transparent" style="cursor:pointer"/>`;
    });
    const el = document.getElementById('cp-stack');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ítems por semáforo por mes">${g}</svg>`;
    el.querySelectorAll('.cp-hit').forEach(r => {
      const i = Number(r.dataset.i), c = data[i];
      r.addEventListener('mousemove', e => showTip(e, `<b>${CP_MESES_L[M[i]]}</b> · ${c.g + c.y + c.r} ítems` +
        ['g', 'y', 'r'].map(k => `<div class="r"><span><span class="cp-dot" style="background:${CP_SEM[k].color}"></span> ${CP_SEM[k].label}</span><span>${c[k]}</span></div>`).join('')));
      r.addEventListener('mouseleave', hideTip);
      r.addEventListener('click', () => { hideTip(); setMes(M[i]); });
    });
  }

  const filasItems = () => itemsSel().map(it => ({ it, ...cpAgg([it], mesesSel()) }));

  function renderTops() {
    const filas = filasItems().filter(f => f.q > 0);
    const over = filas.filter(f => f.imp < 0).sort((a, b) => a.imp - b.imp).slice(0, 8);
    const under = filas.filter(f => f.imp > 0).sort((a, b) => b.imp - a.imp).slice(0, 8);
    document.getElementById('cp-top-h').textContent = `(Costo real − costo receta) × cantidad · ${periodo()}`;
    document.getElementById('cp-bot-h').textContent = `(Costo receta − costo real) × cantidad · ${periodo()}`;
    barras('cp-top', over, CP_SEM.r.color);
    barras('cp-bot', under, CP_SEM.g.color);
  }
  function barras(id, filas, color) {
    const el = document.getElementById(id);
    if (!filas.length) { el.innerHTML = '<p class="cp-hint">Sin ítems en este periodo.</p>'; return; }
    const max = Math.max(...filas.map(f => Math.abs(f.imp)));
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${filas.map((f, i) => `
      <div class="cp-hb" data-i="${i}"><div class="nm">${esc(f.it.nombre)}</div><div class="vl">${cpFmtS(Math.abs(f.imp))}</div>
        <div class="tr"><div style="width:${Math.max(1, Math.abs(f.imp) / max * 100)}%;background:${color}"></div></div></div>`).join('')}</div>`;
    el.querySelectorAll('.cp-hb').forEach(d => {
      const f = filas[Number(d.dataset.i)];
      d.addEventListener('mousemove', e => showTip(e, `<b>${esc(f.it.nombre)}</b>
        <div class="r"><span>Código · Área</span><span>${esc(f.it.item)} · ${esc(cpAreaNombre(f.it.area))}</span></div>
        <div class="r"><span>Costo receta</span><span>${cpFmtS2(f.it.costoReceta)}</span></div>
        <div class="r"><span>Costo real prom.</span><span>${cpFmtS2(f.real / f.q)}</span></div>
        <div class="r"><span>Cantidad</span><span>${cpFmtN(f.q)} ${esc(f.it.unidad)}</span></div>
        <div class="r"><span>Desviación</span><span>${cpFmtP(f.dev)}</span></div>`));
      d.addEventListener('mouseleave', hideTip);
    });
  }

  const COLS = [['item', 'Código'], ['nombre', 'Ítem'], ['q', 'Cantidad'], ['receta', 'Costo receta'], ['c', 'Costo real prom.'], ['dev', 'Desviación'], ['imp', 'Impacto S/'], ['hist', 'Por mes']];
  function renderTabla() {
    document.querySelectorAll('#cp-sem button').forEach(b => b.classList.toggle('on', b.dataset.v === st.sem));
    // Todas las filas del ítem (aunque no haya producido en el periodo), para saber qué pasó.
    let filas = filasItems().map(f => {
      const tieneMes = mesesSel().some(m => f.it.meses[m]);
      const s = !(f.it.costoReceta > 0) ? 'x' : f.q > 0 ? cpSem(f.dev) : 'n';
      return { ...f, item: f.it.item, nombre: f.it.nombre, receta: f.it.costoReceta || 0, c: f.q ? f.real / f.q : 0, s, tieneMes };
    }).filter(f => f.tieneMes);
    if (st.sem !== 'ALL') filas = filas.filter(f => f.s === st.sem);
    if (st.q) filas = filas.filter(f => f.nombre.toLowerCase().includes(st.q) || String(f.item).includes(st.q));
    const k = st.sort === 'hist' ? 'dev' : st.sort, dir = st.dir;
    const rango = f => f.s === 'x' ? 2 : f.s === 'n' ? 1 : 0;
    filas.sort((a, b) => rango(a) - rango(b) || (typeof a[k] === 'string'
      ? a[k].localeCompare(b[k], 'es', { numeric: true }) * dir
      : ((a[k] ?? -9) - (b[k] ?? -9)) * dir));

    document.getElementById('cp-thead').innerHTML = '<tr>' + COLS.map(([c, l]) =>
      `<th data-k="${c}" class="${st.sort === c ? 'on' : ''}">${l}${st.sort === c ? (st.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('') + '</tr>';
    document.querySelectorAll('#cp-thead th').forEach(th => th.addEventListener('click', () => {
      const c = th.dataset.k;
      if (st.sort === c) st.dir *= -1; else { st.sort = c; st.dir = ['nombre', 'item', 'imp', 'dev', 'hist'].includes(c) ? 1 : -1; }
      renderTabla();
    }));

    document.getElementById('cp-tbody').innerHTML = filas.map(f => {
      const strip = D.meses.map(m => {
        const d = cpDevMes(f.it, m), x = f.it.meses[m];
        const t = d == null ? `${CP_MESES[m]}: ${x ? 'sin costo receta' : 'sin producción'}` : `${CP_MESES[m]}: ${cpFmtP(d)} · ${cpFmtN(x.cantidad)} ${f.it.unidad}`;
        const bg = d == null ? '' : `background:${CP_SEM[cpSem(d)].color};`;
        return `<span title="${esc(t)}" style="${bg}${m === st.mes ? 'outline:1.5px solid var(--text);outline-offset:1px' : ''}"></span>`;
      }).join('');
      const chip = f.s === 'x' ? '<span class="cp-chip">Sin costo receta</span>'
        : f.s === 'n' ? '<span class="cp-chip">Sin dato</span>'
        : `<span class="cp-chip"><span class="cp-dot" style="background:${CP_SEM[f.s].color}"></span>${cpFmtP(f.dev)}</span>`;
      const conDato = f.s !== 'x' && f.q > 0;
      return `<tr><td>${esc(f.item)}</td><td class="nm">${esc(f.nombre)}<small>${esc(cpAreaNombre(f.it.area))} · ${esc(f.it.unidad)}</small></td>
        <td>${conDato ? cpFmtN(f.q) : '—'}</td><td>${f.it.costoReceta ? cpFmtS2(f.it.costoReceta) : '—'}</td><td>${conDato ? cpFmtS2(f.c) : '—'}</td>
        <td>${chip}</td><td class="${conDato ? cpCls(f.imp) : ''}">${conDato ? cpFmtS(f.imp) : '—'}</td><td><span class="cp-strip">${strip}</span></td></tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Ningún ítem coincide con los filtros.</td></tr>';

    document.getElementById('cp-tbl-h').textContent = `${filas.length} ítems · ${periodo()} · clic en un encabezado para ordenar`;
    const sinReceta = itemsSel().filter(it => !(it.costoReceta > 0)).length;
    document.getElementById('cp-foot').innerHTML = `<span>Fuente: EBC COSTO DE PRODUCCION.xlsx (hoja "Datos"), se actualiza todos los días a las 6:00 a. m.</span>
      ${sinReceta ? `<span>${sinReceta} ítems no tienen costo receta en el Excel: se muestran, pero quedan fuera de los totales y del semáforo.</span>` : ''}
      <span>Los meses sin producción no cuentan (en el Excel aparecen como 100% de desviación).</span>`;
  }

  await cargar();
}

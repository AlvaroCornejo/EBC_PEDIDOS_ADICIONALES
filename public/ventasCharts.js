// Gráficos del módulo Ventas — SVG propio, sin librerías (prefijo vc*). Se usa desde viewVentas (app.js).

const VC = { grid: '#e1e0d9', base: '#c3c2b7' };
// Orden fijo de categorías (validado: azul, naranja, aqua, amarillo, magenta, verde, violeta, rojo).
const VC_CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const VC_OTROS = '#a8a79f';

function vcEstilos() {
  if (document.getElementById('vc-style')) return;
  const st = document.createElement('style');
  st.id = 'vc-style';
  st.textContent = `
  .vc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .vc-head-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .vc-seg{display:inline-flex;gap:2px;background:var(--bg);border-radius:8px;padding:3px}
  .vc-seg button{border:0;background:none;padding:4px 10px;border-radius:6px;font-size:12px;color:var(--text-muted);cursor:pointer;white-space:nowrap}
  .vc-seg button:hover{background:var(--white)}
  .vc-seg button.on{background:var(--sidebar);color:#fff}
  .vc-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--text-muted);margin-bottom:8px}
  .vc-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
  .vc-chart svg{display:block;width:100%;height:auto;overflow:visible}
  .vc-chart svg text{font-size:11px;fill:#6b7280;font-variant-numeric:tabular-nums}
  .vc-chart svg text.vc-lbl{fill:var(--text);font-size:12px}
  .vc-chart svg text.vc-val{fill:var(--text);font-size:11px;font-weight:600}
  .vc-hit{cursor:default}
  .vc-tip{position:fixed;pointer-events:none;background:var(--sidebar);color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5;z-index:3000;max-width:320px;box-shadow:var(--shadow-md)}
  .vc-tip .r{display:flex;justify-content:space-between;gap:14px;font-variant-numeric:tabular-nums}
  .vc-tip i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
  .vc-tip .t{border-top:1px solid rgba(255,255,255,.25);margin-top:4px;padding-top:4px;font-weight:700}`;
  document.head.appendChild(st);
}

function vcSeg(key, opciones, sel) {
  return `<div class="vc-seg">${opciones.map(([v, l]) =>
    `<button type="button" data-vc-k="${esc(key)}" data-vc-v="${esc(v)}" class="${v === sel ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}

function vcLeyenda(series) {
  if (series.length < 2) return '';
  return `<div class="vc-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function vcShowTip(e, html) {
  let t = document.getElementById('vc-tip');
  if (!t) { t = document.createElement('div'); t.id = 'vc-tip'; t.className = 'vc-tip'; t.hidden = true; document.body.appendChild(t); }
  t.innerHTML = html; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
}
function vcHideTip() { const t = document.getElementById('vc-tip'); if (t) t.hidden = true; }

function vcTicks(max, n = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(v);
  return { top, ticks };
}

const vcCompacto = v => Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' M'
  : Math.abs(v) >= 1e3 ? (v / 1e3).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' k' : String(Math.round(v * 100) / 100);

// Barra vertical anclada al eje, extremo de datos (arriba) redondeado.
function vcPathBarraV(x, yBase, w, h, redondear) {
  const r = redondear ? Math.min(3, w / 2, h) : 0, y = yBase - h;
  return `M${x} ${yBase} V${y + r} ${r ? `Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r}` : `H${x + w}`} V${yBase} Z`;
}

const vcVar = (a, b) => (b > 0 && a != null) ? ` <span style="opacity:.8">(${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%)</span>` : '';

/**
 * Columnas agrupadas: una columna por serie dentro de cada categoría (eje X).
 * cfg: { filas:[{label, vals:[...]}], series:[{name,color}], fmt, fmtAxis?, aria }
 * La 1ª serie es la "actual": las demás se comparan contra ella en el tooltip.
 */
function vcBarrasH(el, cfg) {
  const { filas, series, fmt, fmtAxis, aria } = cfg;
  if (!filas.length) { el.innerHTML = '<div class="text-muted" style="padding:16px">Sin datos para graficar.</div>'; return; }
  const W = 720, H = 300, L = 56, R = 8, T = 10, B = 44, iw = W - L - R, ih = H - T - B;
  const { top, ticks } = vcTicks(Math.max(0, ...filas.flatMap(f => f.vals.map(v => v || 0))));
  const y = v => T + ih * (1 - v / top), paso = iw / filas.length;
  const bw = Math.min(22, paso * 0.8 / series.length), gw = bw * series.length + (series.length - 1) * 2;
  let g = '';
  ticks.forEach(t => { g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? VC.grid : VC.base}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc((fmtAxis || fmt)(t))}</text>`; });
  filas.forEach((f, i) => {
    const x0 = L + paso * i + (paso - gw) / 2;
    f.vals.forEach((v, j) => {
      const h = Math.max(0, y(0) - y(v || 0));
      if (h > 0) g += `<path d="${vcPathBarraV(x0 + j * (bw + 2), y(0), bw, h, true)}" fill="${series[j].color}"/>`;
    });
    // Etiqueta del eje X: en 2 líneas si tiene espacios ("EN EL LOCAL" → "EN EL" / "LOCAL").
    const pal = String(f.label).split(' '), mid = Math.ceil(pal.length / 2);
    const lineas = pal.length > 1 && paso < 90 ? [pal.slice(0, mid).join(' '), pal.slice(mid).join(' ')] : [f.label];
    lineas.forEach((t, k) => { g += `<text x="${L + paso * i + paso / 2}" y="${H - B + 16 + k * 13}" text-anchor="middle" class="vc-lbl" style="font-size:11px">${esc(t)}</text>`; });
    g += `<rect class="vc-hit" data-i="${i}" x="${L + paso * i}" y="${T}" width="${paso}" height="${ih + B}" fill="transparent"/>`;
  });
  el.innerHTML = vcLeyenda(series) + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria || '')}">${g}</svg>`;
  el.querySelectorAll('.vc-hit').forEach(r => {
    const f = filas[Number(r.dataset.i)];
    r.addEventListener('mousemove', e => vcShowTip(e, `<b>${esc(f.label)}</b>` + series.map((s, j) =>
      `<div class="r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><span>${esc(fmt(f.vals[j] || 0))}${j > 0 ? vcVar(f.vals[0], f.vals[j]) : ''}</span></div>`).join('')));
    r.addEventListener('mouseleave', vcHideTip);
  });
}

/**
 * Columnas apiladas al 100%: una columna por categoría (eje X), segmentos = partes del todo.
 * cfg: { filas:[{label, segs:[{name,color,ink,val}], extra?}], fmtVal, aria }
 */
function vcApilado100H(el, cfg) {
  const { filas, fmtVal, aria } = cfg;
  const W = 720, H = 300, L = 44, R = 8, T = 10, B = 28, iw = W - L - R, ih = H - T - B;
  const paso = iw / filas.length, bw = Math.min(90, paso * 0.62);
  let g = '';
  [0, 25, 50, 75, 100].forEach(p => { const yy = T + ih * (1 - p / 100); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${p ? VC.grid : VC.base}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${p}%</text>`; });
  filas.forEach((f, i) => {
    const tot = f.segs.reduce((s, q) => s + (q.val || 0), 0), x0 = L + paso * i + (paso - bw) / 2;
    const activos = f.segs.filter(q => (q.val || 0) > 0);
    let acc = 0;
    activos.forEach((q, k) => {
      const frac = q.val / tot, hh = Math.max(0, ih * frac - (k > 0 ? 2 : 0)), yb = T + ih * (1 - acc);
      g += `<path d="${vcPathBarraV(x0, yb, bw, hh, k === activos.length - 1)}" fill="${q.color}"/>`;
      if (frac >= 0.07) g += `<text x="${x0 + bw / 2}" y="${yb - hh / 2 + 4}" text-anchor="middle" style="fill:${q.ink || '#fff'};font-weight:600">${(frac * 100).toFixed(0)}%</text>`;
      acc += frac;
    });
    g += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" class="vc-lbl" style="font-size:11px">${esc(f.label)}</text>`;
    g += `<rect class="vc-hit" data-i="${i}" x="${L + paso * i}" y="${T}" width="${paso}" height="${ih + B}" fill="transparent"/>`;
  });
  const leyenda = filas.length ? filas[0].segs : [];
  el.innerHTML = vcLeyenda(leyenda) + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria || '')}">${g}</svg>`;
  el.querySelectorAll('.vc-hit').forEach(r => {
    const f = filas[Number(r.dataset.i)], tot = f.segs.reduce((s, q) => s + (q.val || 0), 0);
    r.addEventListener('mousemove', e => vcShowTip(e, `<b>${esc(f.label)}</b>` + f.segs.map(q =>
      `<div class="r"><span><i style="background:${q.color}"></i>${esc(q.name)}</span><span>${esc(fmtVal(q.val || 0))} · ${tot > 0 ? ((q.val || 0) / tot * 100).toFixed(1) : '0.0'}%</span></div>`).join('')
      + `<div class="r t"><span>Total</span><span>${esc(fmtVal(tot))}</span></div>` + (f.extra || '')));
    r.addEventListener('mouseleave', vcHideTip);
  });
}

/**
 * Columnas apiladas: una columna por categoría (eje X), segmentos = series.
 * cfg: { cats:[...], series:[{name,color,vals:[...]}], fmt, aria }
 */
function vcColsApiladas(el, cfg) {
  const { cats, series, fmt, aria } = cfg;
  if (!cats.length) { el.innerHTML = '<div class="text-muted" style="padding:16px">Sin datos para graficar.</div>'; return; }
  const W = 720, H = 280, L = 52, R = 8, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
  const totales = cats.map((_, i) => series.reduce((s, q) => s + (q.vals[i] || 0), 0));
  const { top, ticks } = vcTicks(Math.max(0, ...totales));
  const y = v => T + ih * (1 - v / top), paso = iw / cats.length, bw = Math.min(38, paso * 0.66), cada = Math.ceil(cats.length / 14);
  let g = '';
  ticks.forEach(t => { g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? VC.grid : VC.base}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(vcCompacto(t))}</text>`; });
  cats.forEach((c, i) => {
    const x0 = L + paso * i + (paso - bw) / 2;
    let acc = 0;
    const activas = series.filter(q => (q.vals[i] || 0) > 0);
    activas.forEach((q, k) => {
      const v = q.vals[i], yy = y(acc + v), h = y(acc) - yy - (k > 0 ? 2 : 0);
      g += `<path d="${vcPathBarraV(x0, yy + h, bw, Math.max(0, h), k === activas.length - 1)}" fill="${q.color}"/>`;
      acc += v;
    });
    if (i % cada === 0 || i === cats.length - 1) g += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
    g += `<rect class="vc-hit" data-i="${i}" x="${L + paso * i}" y="${T}" width="${paso}" height="${ih}" fill="transparent"/>`;
  });
  el.innerHTML = vcLeyenda(series) + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria || '')}">${g}</svg>`;
  el.querySelectorAll('.vc-hit').forEach(r => {
    const i = Number(r.dataset.i);
    r.addEventListener('mousemove', e => vcShowTip(e, `<b>${esc(cats[i])}</b>` + series.filter(q => (q.vals[i] || 0) > 0).slice().reverse().map(q =>
      `<div class="r"><span><i style="background:${q.color}"></i>${esc(q.name)}</span><span>${esc(fmt(q.vals[i]))}</span></div>`).join('')
      + `<div class="r t"><span>Total</span><span>${esc(fmt(totales[i]))}</span></div>`));
    r.addEventListener('mouseleave', vcHideTip);
  });
}

/**
 * Líneas sobre un eje X categórico (meses). vals con null = sin dato (corta la línea).
 * cfg: { cats:[...], series:[{name,color,w,vals:[...]}], fmt, aria }
 */
function vcLineas(el, cfg) {
  const { cats, series, fmt, aria } = cfg;
  const W = 720, H = 280, L = 52, R = 12, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
  const { top, ticks } = vcTicks(Math.max(0, ...series.flatMap(s => s.vals.map(v => v || 0))));
  const x = i => L + iw * (cats.length === 1 ? 0.5 : i / (cats.length - 1)), y = v => T + ih * (1 - v / top);
  let g = '';
  ticks.forEach(t => { g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? VC.grid : VC.base}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(vcCompacto(t))}</text>`; });
  cats.forEach((c, i) => { g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`; });
  g += `<line class="vc-xh" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="#898781" opacity="0"/>`;
  // La serie resaltada (primera de la lista) va encima: se dibuja al final.
  series.slice().reverse().forEach(s => {
    let d = '', pen = false;
    s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  series.forEach((s, j) => { g += `<circle class="vc-dot" data-j="${j}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2" opacity="0"/>`; });
  const paso = cats.length > 1 ? iw / (cats.length - 1) : iw;
  cats.forEach((c, i) => { g += `<rect class="vc-hit" data-i="${i}" x="${x(i) - paso / 2}" y="${T}" width="${paso}" height="${ih}" fill="transparent"/>`; });
  el.innerHTML = vcLeyenda(series) + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria || '')}">${g}</svg>`;
  const xh = el.querySelector('.vc-xh'), dots = el.querySelectorAll('.vc-dot');
  el.querySelectorAll('.vc-hit').forEach(r => {
    const i = Number(r.dataset.i);
    r.addEventListener('mousemove', e => {
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', '.6');
      dots.forEach(dt => { const v = series[Number(dt.dataset.j)].vals[i]; if (v == null) dt.setAttribute('opacity', '0'); else { dt.setAttribute('cx', x(i)); dt.setAttribute('cy', y(v)); dt.setAttribute('opacity', '1'); } });
      vcShowTip(e, `<b>${esc(cats[i])}</b>` + series.filter(s => s.vals[i] != null).map(s =>
        `<div class="r"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><span>${esc(fmt(s.vals[i]))}</span></div>`).join(''));
    });
    r.addEventListener('mouseleave', () => { xh.setAttribute('opacity', '0'); dots.forEach(dt => dt.setAttribute('opacity', '0')); vcHideTip(); });
  });
}

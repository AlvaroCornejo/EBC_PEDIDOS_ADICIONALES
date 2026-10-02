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

// Barra horizontal anclada al eje, extremo de datos redondeado.
function vcPathBarraH(x0, y, w, h) {
  const r = Math.min(3, w / 2, h / 2);
  return `M${x0} ${y} H${x0 + w - r} Q${x0 + w} ${y} ${x0 + w} ${y + r} V${y + h - r} Q${x0 + w} ${y + h} ${x0 + w - r} ${y + h} H${x0} Z`;
}
// Barra vertical anclada al eje, extremo de datos (arriba) redondeado.
function vcPathBarraV(x, yBase, w, h, redondear) {
  const r = redondear ? Math.min(3, w / 2, h) : 0, y = yBase - h;
  return `M${x} ${yBase} V${y + r} ${r ? `Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r}` : `H${x + w}`} V${yBase} Z`;
}

const vcVar = (a, b) => (b > 0 && a != null) ? ` <span style="opacity:.8">(${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%)</span>` : '';

/**
 * Barras horizontales agrupadas: una fila por categoría, una barra por serie.
 * cfg: { filas:[{label, vals:[...]}], series:[{name,color}], fmt, fmtAxis?, aria }
 * La 1ª serie es la "actual": las demás se comparan contra ella en el tooltip.
 */
function vcBarrasH(el, cfg) {
  const { filas, series, fmt, fmtAxis, aria } = cfg;
  if (!filas.length) { el.innerHTML = '<div class="text-muted" style="padding:16px">Sin datos para graficar.</div>'; return; }
  const W = 720, L = 112, R = 84, T = 6, B = 24, bh = 11, ig = 2, gg = 14;
  const gh = series.length * bh + (series.length - 1) * ig;
  const H = T + filas.length * (gh + gg) - gg + B, iw = W - L - R;
  const { top, ticks } = vcTicks(Math.max(0, ...filas.flatMap(f => f.vals.map(v => v || 0))));
  const x = v => L + iw * (v / top);
  let g = '';
  ticks.forEach(t => { g += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" stroke="${t ? VC.grid : VC.base}"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle">${esc((fmtAxis || fmt)(t))}</text>`; });
  filas.forEach((f, i) => {
    const y0 = T + i * (gh + gg);
    g += `<text x="${L - 8}" y="${y0 + gh / 2 + 4}" text-anchor="end" class="vc-lbl">${esc(f.label)}</text>`;
    f.vals.forEach((v, j) => {
      const w = Math.max(0, x(v || 0) - L), y = y0 + j * (bh + ig);
      if (w > 0) g += `<path d="${vcPathBarraH(L, y, w, bh)}" fill="${series[j].color}"/>`;
      if (j === 0) g += `<text x="${L + w + 5}" y="${y + bh - 2}" class="vc-val">${esc(fmt(v || 0))}</text>`;
    });
    g += `<rect class="vc-hit" data-i="${i}" x="0" y="${y0 - gg / 2}" width="${W}" height="${gh + gg}" fill="transparent"/>`;
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
 * Barras horizontales apiladas al 100%: una fila por categoría, segmentos = partes del todo.
 * cfg: { filas:[{label, segs:[{name,color,ink,val}], extra?}], fmtVal, aria }
 */
function vcApilado100H(el, cfg) {
  const { filas, fmtVal, aria } = cfg;
  const W = 720, L = 112, R = 12, T = 4, bh = 26, gg = 14, iw = W - L - R, H = T + filas.length * (bh + gg) - gg + 4;
  let g = '';
  filas.forEach((f, i) => {
    const y = T + i * (bh + gg), tot = f.segs.reduce((s, q) => s + (q.val || 0), 0);
    g += `<text x="${L - 8}" y="${y + bh / 2 + 4}" text-anchor="end" class="vc-lbl">${esc(f.label)}</text>`;
    let acc = 0;
    f.segs.filter(q => (q.val || 0) > 0).forEach((q, k, arr) => {
      const frac = q.val / tot, gap = k < arr.length - 1 ? 2 : 0, w = Math.max(0, iw * frac - gap), xs = L + iw * acc;
      g += `<rect x="${xs}" y="${y}" width="${w}" height="${bh}" fill="${q.color}" ${k === arr.length - 1 ? 'rx="3"' : ''}/>`;
      if (frac >= 0.07) g += `<text x="${xs + w / 2}" y="${y + bh / 2 + 4}" text-anchor="middle" style="fill:${q.ink || '#fff'};font-weight:600">${(frac * 100).toFixed(0)}%</text>`;
      acc += frac;
    });
    g += `<rect class="vc-hit" data-i="${i}" x="0" y="${y - gg / 2}" width="${W}" height="${bh + gg}" fill="transparent"/>`;
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

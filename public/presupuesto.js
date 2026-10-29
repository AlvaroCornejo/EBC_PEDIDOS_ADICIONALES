/* ═══════════════════════════════════════════════════════════════
   Presupuesto anual por operación — presupuesto.js
   Módulo separado de app.js (se carga después y usa sus helpers:
   GET, api, esc, toast, S, PL_ESTRUCTURA, ALL_OPS). Prefijo pr* / _pr*.
   - Meses en columnas (enero a diciembre) + total.
   - Cada rubro del PL (planilla, SSPP, ...) se desglosa en sus ítems (electricidad, agua, ...) y cada ítem tiene partidas: filas con nombre y un importe por mes.
   - Costo de venta: se presupuesta el % por mes; el importe = % × venta neta A&B.
   - Los renglones calculados (margen, EBITDA, utilidades) salen de la misma estructura del PL.
   - Opcional: PL real de otro año debajo de cada renglón, para comparar.
   Convención: se ingresa en positivo; el signo (ingreso o gasto) lo da el rubro. Financieros se
   trata como gasto: un valor negativo significa un ingreso neto.
═══════════════════════════════════════════════════════════════ */

const PR_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const PR_AYB = 'VENTA NETA A&B';

// Renglones del presupuesto, en el orden del PL: rubros (subtotales y líneas sueltas) y calculados.
function prEstructura() {
  const enSub = new Set(PL_ESTRUCTURA.filter(r => r.type === 'subtotal').flatMap(r => r.grupos));
  return PL_ESTRUCTURA.filter(r => r.type !== 'header' && !(r.type === 'item' && enSub.has(r.grupo))).map(r =>
    r.type === 'item' ? { tipo: 'rubro', key: r.grupo, label: r.grupo, grupos: [r.grupo] }
    : r.type === 'subtotal' ? { tipo: 'rubro', key: r.key, label: r.label.replace(/^TOTAL\s+/i, ''), grupos: r.grupos }
    : { tipo: 'calc', key: r.key, label: r.label, fn: r.fn });
}

// t[clave] con signo del PL (ingreso +, gasto −) para un mes, y los calculados encadenados.
function prSignado(rubros, magnitudDe) {
  const t = {};
  rubros.forEach(r => { if (r.tipo === 'rubro') t[r.key] = (r.key === 'VENTA_NETA' ? 1 : -1) * magnitudDe(r); });
  rubros.forEach(r => { if (r.tipo === 'calc') t[r.key] = r.fn(t); });
  return t;
}

async function viewPresupuesto(container) {
  const rubros = prEstructura();
  const esAdmin = S.user.role === 'ADMIN';
  const opsLista = esAdmin ? [...ALL_OPS] : [...(S.user.operations || [])];
  const hoy = new Date();
  let operacion = opsLista[0] || '', anio = Math.max(hoy.getFullYear() + 1, 2027), verReal = false, anioReal = anio - 1;
  let pres = { cvPct: Array(12).fill(0), partidas: [] }, real = null, puedeEditar = false, dirty = false, meta = '';
  // rubros con sus ítems contraídos (por omisión todos cerrados)
  const cerrados = new Set(rubros.filter(r => r.tipo === 'rubro' && r.key !== 'COSTO_VENTA' && (r.grupos.length > 1 || r.grupos[0] !== r.key)).map(r => r.key));

  const fN = v => (v < 0 ? '(' : '') + Math.abs(v).toLocaleString('es-PE', { maximumFractionDigits: 0 }) + (v < 0 ? ')' : '');
  const fP = v => (Number(v) || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 }) + '%';
  const nuevoId = () => (typeof uuidv4 === 'function' ? uuidv4() : 'p' + Date.now() + Math.random().toString(36).slice(2, 7));
  const suma12 = a => a.reduce((s, v) => s + (Number(v) || 0), 0);

  container.innerHTML = `
    <div class="page-header"><div class="page-title">💼 Presupuesto</div>
      <span id="pr-estado" style="font-size:12px;color:var(--text-muted)"></span></div>
    <div class="page-body">
      <div class="card mb-16 pr-sticky" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <select id="pr-op" class="form-control" style="width:150px">${opsLista.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Año del presupuesto</label>
            <select id="pr-anio" class="form-control" style="width:110px">${[2026, 2027, 2028, 2029].map(a => `<option value="${a}"${a === anio ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding-bottom:7px"><input type="checkbox" id="pr-ver-real"> Ver PL real de</label>
          <div><select id="pr-anio-real" class="form-control" style="width:100px">${[2024, 2025, 2026, 2027].map(a => `<option value="${a}"${a === anioReal ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
          <button class="btn btn-primary" id="pr-guardar" style="display:none">💾 Guardar presupuesto</button>
        </div>
      </div>
      <div id="pr-cuerpo"></div>
    </div>`;

  const $ = id => document.getElementById(id);
  const cuerpo = $('pr-cuerpo');

  // ── carga ────────────────────────────────────────────────────────────────
  async function cargar() {
    if (!operacion) { cuerpo.innerHTML = '<p class="text-muted">No tienes operaciones asignadas.</p>'; return; }
    cuerpo.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const [p, r] = await Promise.all([
        GET(`/presupuesto?operacion=${encodeURIComponent(operacion)}&anio=${anio}`),
        verReal ? GET(`/presupuesto/real?operacion=${encodeURIComponent(operacion)}&anio=${anioReal}`) : Promise.resolve(null),
      ]);
      pres = { cvPct: p.cvPct, partidas: p.partidas.map(x => ({ ...x, montos: [...x.montos] })) };
      puedeEditar = p.puedeEditar; real = r ? r.datos : null; dirty = false;
      meta = p.actualizadoEn ? `Última actualización: ${p.actualizadoPor || '—'} · ${new Date(p.actualizadoEn).toLocaleString('es-PE')}` : 'Sin presupuesto guardado todavía';
      // La venta neta A&B siempre existe: es la base del costo de venta.
      pres.partidas.forEach(x => { if (x.esAyB) { x.rubro = PR_AYB; x.id = 'L:' + PR_AYB; } });   // presupuestos antiguos la guardaban en el subtotal
      if (!pres.partidas.some(x => x.esAyB)) pres.partidas.unshift({ id: 'L:' + PR_AYB, rubro: PR_AYB, nombre: PR_AYB, esAyB: true, montos: Array(12).fill(0) });
      pintar();
    } catch (e) { cuerpo.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }

  // ── cálculo ──────────────────────────────────────────────────────────────
  const partidasDe = key => pres.partidas.filter(p => p.rubro === key);
  const ayb = m => partidasDe(PR_AYB).filter(p => p.esAyB).reduce((s, p) => s + (Number(p.montos[m]) || 0), 0);
  // magnitud presupuestada del rubro en el mes m (positiva)
  const magPres = (r, m) => r.key === 'COSTO_VENTA' ? ayb(m) * (Number(pres.cvPct[m]) || 0) / 100 : [...new Set([r.key, ...r.grupos])].reduce((t, k) => t + partidasDe(k).reduce((s, p) => s + (Number(p.montos[m]) || 0), 0), 0);
  const magItem = (g, m) => partidasDe(g).reduce((s, p) => s + (Number(p.montos[m]) || 0), 0);
  const magItemReal = (r, g, m) => { const v = real?.[g]?.[String(m + 1).padStart(2, '0')] || 0; return r.key === 'VENTA_NETA' ? v : -v; };
  // Ítems que se desglosan en partidas; en los demás el importe se presupuesta en la misma línea del ítem (partida 'L:ítem').
  const ITEMS_CON_PARTIDAS = new Set(['ASESORIA ADMINISTRATIVA', 'ASESORIA CONTABLE', 'ASESORIA LEGAL', 'MANTENIMIENTO', 'FUMIGACION', 'JARDINERIA',
    ...rubros.filter(r => r.key === 'SERV_TERCEROS' || r.key === 'OTROS_GASTOS').flatMap(r => r.grupos)]);
  const linea = g => pres.partidas.find(p => p.id === 'L:' + g);
  const partidasLista = g => partidasDe(g).filter(p => !p.id.startsWith('L:'));
  const conItems = r => r.tipo === 'rubro' && r.key !== 'COSTO_VENTA' && (r.grupos.length > 1 || r.grupos[0] !== r.key);
  const magReal = (r, m) => { const mm = String(m + 1).padStart(2, '0'); const s = r.grupos.reduce((t, g) => t + (real?.[g]?.[mm] || 0), 0); return r.key === 'VENTA_NETA' ? s : -s; };
  const signadoMes = (m, real_) => prSignado(rubros, r => real_ ? magReal(r, m) : magPres(r, m));

  function calcular() {
    const pr = {}, rl = {}, cp = {}, cr = {}, pi = {}, ri = {};
    for (let m = 0; m < 12; m++) {
      const t = signadoMes(m, false), tr = real ? signadoMes(m, true) : null;
      rubros.forEach(r => {
        if (r.tipo === 'rubro') { (pr[r.key] = pr[r.key] || [])[m] = magPres(r, m); if (tr) (rl[r.key] = rl[r.key] || [])[m] = magReal(r, m);
          if (conItems(r)) r.grupos.forEach(g => { (pi[g] = pi[g] || [])[m] = magItem(g, m); if (tr) (ri[g] = ri[g] || [])[m] = magItemReal(r, g, m); }); }
        else { (cp[r.key] = cp[r.key] || [])[m] = t[r.key]; if (tr) (cr[r.key] = cr[r.key] || [])[m] = tr[r.key]; }
      });
    }
    return { pr, rl, cp, cr, pi, ri };
  }

  // ── pintado ──────────────────────────────────────────────────────────────
  const celdas = (key, tipo) => PR_MESES.map((_, m) => `<td class="pr-n" data-k="${esc(key)}" data-t="${tipo}" data-m="${m}"></td>`).join('') + `<td class="pr-n pr-tot" data-k="${esc(key)}" data-t="${tipo}" data-m="t"></td>`;

  function filaPartida(p) {
    const ed = puedeEditar;
    const nombre = p.esAyB ? `<strong>${esc(PR_AYB)}</strong> <span class="pr-chip" title="Base del costo de venta">base CV</span>`
      : ed ? `<input class="pr-nombre" data-id="${esc(p.id)}" value="${esc(p.nombre)}" placeholder="Nombre de la partida" maxlength="120">` : esc(p.nombre || '(sin nombre)');
    const acciones = ed ? `<button class="pr-ico" data-acc="repetir" data-id="${esc(p.id)}" title="Repetir el importe de enero en todos los meses">⇥</button>${p.esAyB ? '' : `<button class="pr-ico" data-acc="borrar" data-id="${esc(p.id)}" title="Eliminar partida">✕</button>`}` : '';
    const meses = PR_MESES.map((_, m) => ed
      ? `<td><input class="pr-in" type="number" step="any" data-id="${esc(p.id)}" data-m="${m}" value="${p.montos[m] || ''}" placeholder="0"></td>`
      : `<td class="pr-n">${p.montos[m] ? fN(p.montos[m]) : '—'}</td>`).join('');
    return `<tr class="pr-partida"><td class="pr-c1"><div class="pr-c1i">${nombre}<span class="pr-acc">${acciones}</span></div></td>${meses}<td class="pr-n pr-tot" data-pt="${esc(p.id)}"></td></tr>`;
  }

  function pintar() {
    const ed = puedeEditar;
    let h = `<div class="pr-wrap"><table class="pr-tabla"><thead><tr><th class="pr-c1">Concepto (importes en S/)</th>${PR_MESES.map(m => `<th>${m}</th>`).join('')}<th>Total ${anio}</th></tr></thead><tbody>`;
    rubros.forEach(r => {
      if (r.tipo === 'calc') {
        h += `<tr class="pr-calc"><td class="pr-c1">${esc(r.label)}</td>${celdas(r.key, 'cp')}</tr>`;
        if (real) h += `<tr class="pr-real"><td class="pr-c1">Real ${anioReal}</td>${celdas(r.key, 'cr')}</tr>`;
        return;
      }
      const simple = r.key !== 'COSTO_VENTA' && !conItems(r);   // rubro de una sola línea: se presupuesta directo en su fila
      if (simple) {
        const l = linea(r.key);
        const meses = PR_MESES.map((_, m) => ed
          ? `<td><input class="pr-in" type="number" step="any" data-linea="${esc(r.key)}" data-m="${m}" value="${l?.montos[m] || ''}" placeholder="0"></td>`
          : `<td class="pr-n">${l?.montos[m] ? fN(l.montos[m]) : '—'}</td>`).join('');
        h += `<tr class="pr-rubro"><td class="pr-c1"><div class="pr-c1i"><span>${esc(r.label)}</span>${ed ? `<span class="pr-acc"><button class="pr-ico" data-acc="repetir-linea" data-g="${esc(r.key)}" title="Repetir el importe de enero en todos los meses">⇥</button></span>` : ''}</div></td>${meses}<td class="pr-n pr-tot" data-t="pr" data-k="${esc(r.key)}" data-m="t"></td></tr>`;
      } else h += `<tr class="pr-rubro"><td class="pr-c1"><div class="pr-c1i"><span>${conItems(r) ? `<button class="pr-tog" data-tog="${esc(r.key)}" title="Abrir / cerrar">${cerrados.has(r.key) ? '▸' : '▾'}</button>` : ''}${esc(r.label)}</span></div></td>${celdas(r.key, 'pr')}</tr>`;
      if (r.key === 'COSTO_VENTA') {
        h += `<tr class="pr-partida"><td class="pr-c1"><div class="pr-c1i"><span>% de costo de venta sobre la venta neta A&amp;B</span></div></td>${PR_MESES.map((_, m) => ed
          ? `<td><input class="pr-in pr-pct" type="number" step="any" min="0" max="100" data-cv="${m}" value="${pres.cvPct[m] || ''}" placeholder="0"></td>`
          : `<td class="pr-n">${pres.cvPct[m] ? fP(pres.cvPct[m]) : '—'}</td>`).join('')}<td class="pr-n pr-tot" data-cvprom></td></tr>`;
        if (real) h += `<tr class="pr-real"><td class="pr-c1">% real ${anioReal} (sobre venta neta A&amp;B)</td>${PR_MESES.map((_, m) => `<td class="pr-n" data-cvreal="${m}"></td>`).join('')}<td class="pr-n pr-tot" data-cvreal="t"></td></tr>`;
      } else if (conItems(r)) {
        h += partidasLista(r.key).map(filaPartida).join('');   // partidas antiguas sin ítem asignado
        if (!cerrados.has(r.key)) r.grupos.forEach(g => {
          if (ITEMS_CON_PARTIDAS.has(g)) {
            h += `<tr class="pr-item"><td class="pr-c1"><div class="pr-c1i"><span>${esc(g)}</span>${ed ? `<button class="pr-add" data-acc="agregar" data-rubro="${esc(g)}">＋ Partida</button>` : ''}</div></td>${celdas(g, 'pi')}</tr>`;
          } else {
            const l = linea(g);
            const meses = PR_MESES.map((_, m) => ed
              ? `<td><input class="pr-in" type="number" step="any" data-linea="${esc(g)}" data-m="${m}" value="${l?.montos[m] || ''}" placeholder="0"></td>`
              : `<td class="pr-n">${l?.montos[m] ? fN(l.montos[m]) : '—'}</td>`).join('');
            h += `<tr class="pr-item"><td class="pr-c1"><div class="pr-c1i"><span>${esc(g)}</span>${ed ? `<span class="pr-acc"><button class="pr-ico" data-acc="repetir-linea" data-g="${esc(g)}" title="Repetir el importe de enero en todos los meses">⇥</button></span>` : ''}</div></td>${meses}<td class="pr-n pr-tot" data-t="pi" data-k="${esc(g)}" data-m="t"></td></tr>`;
          }
          h += partidasLista(g).map(filaPartida).join('');
          if (real) h += `<tr class="pr-real"><td class="pr-c1">Real ${anioReal}</td>${celdas(g, 'ri')}</tr>`;
        });
      } else {
        h += partidasLista(r.key).map(filaPartida).join('');
      }
      if (real) h += `<tr class="pr-real"><td class="pr-c1">Real ${anioReal} · total ${esc(r.label)}</td>${celdas(r.key, 'rl')}</tr>`;
    });
    h += '</tbody></table></div>';
    cuerpo.innerHTML = h;
    $('pr-guardar').style.display = ed ? '' : 'none';
    actualizarTotales();
  }

  function actualizarTotales() {
    const { pr, rl, cp, cr, pi, ri } = calcular();
    const fuentes = { pr, rl, cp, cr, pi, ri };
    cuerpo.querySelectorAll('td[data-t]').forEach(td => {
      const arr = fuentes[td.dataset.t]?.[td.dataset.k]; if (!arr) { td.textContent = ''; return; }
      const v = td.dataset.m === 't' ? suma12(arr) : arr[Number(td.dataset.m)];
      td.textContent = v === undefined ? '' : fN(v);
      td.classList.toggle('pr-neg', v < 0);
    });
    cuerpo.querySelectorAll('td[data-pt]').forEach(td => { const p = pres.partidas.find(x => x.id === td.dataset.pt); td.textContent = p ? fN(suma12(p.montos)) : ''; });
    // costo de venta: % anual ponderado = importe CV anual / venta neta A&B anual
    const totAyB = suma12(Array.from({ length: 12 }, (_, m) => ayb(m)));
    const tdProm = cuerpo.querySelector('td[data-cvprom]'); if (tdProm) tdProm.textContent = totAyB ? fP(suma12(pr.COSTO_VENTA || []) / totAyB * 100) : '—';
    if (real) {
      const mmAyB = m => real[PR_AYB]?.[String(m + 1).padStart(2, '0')] || 0;
      const cvReal = m => -(rubros.find(r => r.key === 'COSTO_VENTA').grupos.reduce((t, g) => t + (real[g]?.[String(m + 1).padStart(2, '0')] || 0), 0));
      cuerpo.querySelectorAll('td[data-cvreal]').forEach(td => {
        if (td.dataset.cvreal === 't') { const a = suma12(Array.from({ length: 12 }, (_, m) => mmAyB(m))), c = suma12(Array.from({ length: 12 }, (_, m) => cvReal(m))); td.textContent = a ? fP(c / a * 100) : '—'; }
        else { const m = Number(td.dataset.cvreal), a = mmAyB(m); td.textContent = a ? fP(cvReal(m) / a * 100) : '—'; }
      });
    }
    $('pr-estado').textContent = (dirty ? '● Cambios sin guardar · ' : '') + meta + (puedeEditar ? '' : ' · Solo lectura');
    $('pr-estado').style.color = dirty ? '#b45309' : '';
  }

  // ── eventos ──────────────────────────────────────────────────────────────
  cuerpo.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('pr-in')) {
      const v = t.value === '' ? 0 : parseFloat(t.value);
      if (t.dataset.linea !== undefined) {
        const g = t.dataset.linea; let l = linea(g);
        if (!l) { l = { id: 'L:' + g, rubro: g, nombre: g, esAyB: g === PR_AYB, montos: Array(12).fill(0) }; pres.partidas.push(l); }
        l.montos[Number(t.dataset.m)] = Number.isFinite(v) ? v : 0;
      } else if (t.dataset.cv !== undefined) pres.cvPct[Number(t.dataset.cv)] = Number.isFinite(v) ? v : 0;
      else { const p = pres.partidas.find(x => x.id === t.dataset.id); if (p) p.montos[Number(t.dataset.m)] = Number.isFinite(v) ? v : 0; }
    } else if (t.classList.contains('pr-nombre')) {
      const p = pres.partidas.find(x => x.id === t.dataset.id); if (p) p.nombre = t.value;
    } else return;
    dirty = true; actualizarTotales();
  });
  cuerpo.addEventListener('click', e => {
    const tg = e.target.closest('[data-tog]');
    if (tg) { const k = tg.dataset.tog; if (cerrados.has(k)) cerrados.delete(k); else cerrados.add(k); const sc = cuerpo.querySelector('.pr-wrap')?.scrollLeft || 0; pintar(); const w = cuerpo.querySelector('.pr-wrap'); if (w) w.scrollLeft = sc; return; }
    const b = e.target.closest('[data-acc]'); if (!b || !puedeEditar) return;
    const acc = b.dataset.acc;
    if (acc === 'repetir-linea') { const g = b.dataset.g; let l = linea(g); if (!l) { l = { id: 'L:' + g, rubro: g, nombre: g, esAyB: g === PR_AYB, montos: Array(12).fill(0) }; pres.partidas.push(l); } l.montos = Array(12).fill(Number(l.montos[0]) || 0); }
    else if (acc === 'agregar') pres.partidas.push({ id: nuevoId(), rubro: b.dataset.rubro, nombre: '', esAyB: false, montos: Array(12).fill(0) });
    else if (acc === 'borrar') { const p = pres.partidas.find(x => x.id === b.dataset.id); if (!p || (suma12(p.montos) && !confirm(`¿Eliminar la partida "${p.nombre || '(sin nombre)'}" con sus importes?`))) return; pres.partidas = pres.partidas.filter(x => x.id !== b.dataset.id); }
    else if (acc === 'repetir') { const p = pres.partidas.find(x => x.id === b.dataset.id); if (p) p.montos = Array(12).fill(Number(p.montos[0]) || 0); }
    dirty = true; pintar();
  });

  async function confirmarDescarte() { return !dirty || confirm('Hay cambios sin guardar que se perderán. ¿Continuar?'); }
  $('pr-op').addEventListener('change', async e => { if (!(await confirmarDescarte())) { e.target.value = operacion; return; } operacion = e.target.value; cargar(); });
  $('pr-anio').addEventListener('change', async e => { if (!(await confirmarDescarte())) { e.target.value = anio; return; } anio = Number(e.target.value); cargar(); });
  $('pr-ver-real').addEventListener('change', async e => {
    verReal = e.target.checked;
    if (verReal && !real) { try { real = (await GET(`/presupuesto/real?operacion=${encodeURIComponent(operacion)}&anio=${anioReal}`)).datos; } catch (err) { toast(err.message, 'error'); verReal = false; e.target.checked = false; return; } }
    if (!verReal) real = null;
    pintar();
  });
  $('pr-anio-real').addEventListener('change', async e => { anioReal = Number(e.target.value); if (verReal) { real = null; await cargarReal(); } });
  async function cargarReal() { try { real = (await GET(`/presupuesto/real?operacion=${encodeURIComponent(operacion)}&anio=${anioReal}`)).datos; pintar(); } catch (err) { toast(err.message, 'error'); } }

  $('pr-guardar').addEventListener('click', async () => {
    const vacias = pres.partidas.filter(p => !p.esAyB && !p.nombre.trim() && suma12(p.montos));
    if (vacias.length) return toast('Hay partidas con importes pero sin nombre: ponles un nombre antes de guardar', 'error');
    const btn = $('pr-guardar'); btn.disabled = true;
    try {
      const r = await api('PUT', `/presupuesto?operacion=${encodeURIComponent(operacion)}&anio=${anio}`, { cvPct: pres.cvPct, partidas: pres.partidas.filter(p => p.esAyB || !p.id.startsWith('L:') || suma12(p.montos)) });
      dirty = false; meta = `Última actualización: ${r.actualizadoPor || '—'} · ${new Date(r.actualizadoEn).toLocaleString('es-PE')}`;
      toast('Presupuesto guardado', 'success'); actualizarTotales();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });

  await cargar();
}

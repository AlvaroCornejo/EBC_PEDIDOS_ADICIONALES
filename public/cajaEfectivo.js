/* ═══════════════════════════════════════════════════════════════
   Cierre de Caja — cajaEfectivo.js
   Módulo separado de app.js (se carga después y usa sus helpers:
   GET/POST/PUT/DEL, esc, toast, openModal, closeModal, S, today, fmt,
   ROLES). Prefijo cje* / _cje*.

   Negocio: Tienda (1-2 turnos/día) → [Oficina central] → Banco, o Tienda →
   Banco directo. Fondo fijo de referencia + conteo físico de apertura/cierre
   por turno (Tienda) o por día (Oficina), en PEN y USD por separado. Ingresos
   de Tienda: VENTA y TIP (PEN o USD). Único egreso-movimiento: VUELTO
   (siempre PEN, el negocio solo vende en soles). El egreso de custodia es
   "Enviar a Oficina" (si tieneOficina) o "Depositar al Banco" directo (si
   no) — el depósito final (desde Caja u Oficina) cubre, por selección
   manual, uno o más turnos/envíos completos. Conteo del supervisor
   independiente del cajero, al cierre. Contabilidad y Gerencia son de solo
   lectura.
═══════════════════════════════════════════════════════════════ */

// ─── Helpers de conteo por denominación ────────────────────────────────────
const CJE_DENOMS = {
  pen: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  usd: [100, 50, 20, 10, 5, 1],
};

function cjeDenomTableHtml(prefix) {
  return ['pen', 'usd'].map(mon => `
    <div style="margin-bottom:10px">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px">${mon.toUpperCase()}</div>
      <table style="font-size:12px">
        ${CJE_DENOMS[mon].map(d => `
          <tr>
            <td style="padding:2px 8px 2px 0;color:var(--text-muted)">${mon==='pen'?'S/':'US$'} ${d}</td>
            <td style="padding:2px"><input type="number" min="0" step="1" class="form-control cje-denom-input" data-prefix="${prefix}" data-mon="${mon}" data-denom="${d}" value="0" style="width:80px"></td>
            <td style="padding:2px 0 2px 8px;color:var(--text-muted)" class="cje-denom-subtotal" data-prefix="${prefix}" data-mon="${mon}" data-denom="${d}">0.00</td>
          </tr>`).join('')}
      </table>
      <div style="text-align:right;font-weight:700;font-size:13px;margin-top:4px">Total ${mon.toUpperCase()}: <span class="cje-denom-total" data-prefix="${prefix}" data-mon="${mon}">0.00</span></div>
    </div>`).join('');
}

function cjeDenomListener(root, prefix) {
  root.querySelectorAll(`.cje-denom-input[data-prefix="${prefix}"]`).forEach(inp => {
    inp.addEventListener('input', () => cjeDenomRecalc(root, prefix, inp.dataset.mon));
  });
}

function cjeDenomRecalc(root, prefix, mon) {
  let total = 0;
  root.querySelectorAll(`.cje-denom-input[data-prefix="${prefix}"][data-mon="${mon}"]`).forEach(inp => {
    const subtotal = Number(inp.dataset.denom) * (Number(inp.value) || 0);
    total += subtotal;
    const cell = root.querySelector(`.cje-denom-subtotal[data-prefix="${prefix}"][data-mon="${mon}"][data-denom="${inp.dataset.denom}"]`);
    if (cell) cell.textContent = subtotal.toFixed(2);
  });
  const totalEl = root.querySelector(`.cje-denom-total[data-prefix="${prefix}"][data-mon="${mon}"]`);
  if (totalEl) totalEl.textContent = total.toFixed(2);
}

function cjeDenomValores(root, prefix) {
  const out = { pen: {}, usd: {} };
  root.querySelectorAll(`.cje-denom-input[data-prefix="${prefix}"]`).forEach(inp => {
    const qty = Number(inp.value) || 0;
    if (qty > 0) out[inp.dataset.mon][inp.dataset.denom] = qty;
  });
  return out;
}

function cjeSumaConteo(conteo, moneda) {
  if (!conteo || !conteo[moneda]) return 0;
  return Object.entries(conteo[moneda]).reduce((s, [denom, qty]) => s + Number(denom) * Number(qty || 0), 0);
}

// Tabla de denominación de UNA sola moneda (para el envío a Oficina: se desglosa el
// billetaje de lo que se envía, no un conteo de las 2 monedas a la vez). Reusa las
// mismas clases cje-denom-* — cjeDenomListener/cjeDenomValores funcionan igual.
function cjeDenomTableUnaMoneda(prefix, moneda) {
  const mon = moneda.toLowerCase();
  return `
    <table style="font-size:12px">
      ${CJE_DENOMS[mon].map(d => `
        <tr>
          <td style="padding:2px 8px 2px 0;color:var(--text-muted)">${mon==='pen'?'S/':'US$'} ${d}</td>
          <td style="padding:2px"><input type="number" min="0" step="1" class="form-control cje-denom-input" data-prefix="${prefix}" data-mon="${mon}" data-denom="${d}" value="0" style="width:80px"></td>
          <td style="padding:2px 0 2px 8px;color:var(--text-muted)" class="cje-denom-subtotal" data-prefix="${prefix}" data-mon="${mon}" data-denom="${d}">0.00</td>
        </tr>`).join('')}
    </table>
    <div style="text-align:right;font-weight:700;font-size:13px;margin-top:4px">Total: <span class="cje-denom-total" data-prefix="${prefix}" data-mon="${mon}">0.00</span></div>`;
}

const CJE_TIPO_LABEL = { VENTA: 'Venta', TIP: 'TIP', VUELTO: 'Vuelto' };

// Fila(s) de la tabla "saldo teórico vs. conteo real" (Gerencia y Contabilidad) —
// una por moneda, comparando contra AMBOS conteos: el del cajero/oficina al cerrar
// (operativo) y el del supervisor (independiente). `fecha` es opcional — se agrega
// una columna de fecha al inicio para la vista de rango (Contabilidad).
function cjeFilaSaldo(label, saldo, fecha) {
  const colFecha = fecha != null ? `<td>${esc(fecha)}</td>` : '';
  return ['PEN', 'USD'].map(m => {
    const s = saldo[m];
    const colorCajero = s.diferenciaCajero == null ? '' : (Math.abs(s.diferenciaCajero) < 0.01 ? 'color:#16a34a' : 'color:#ef4444;font-weight:700');
    const colorSup = s.diferenciaSupervisor == null ? '' : (Math.abs(s.diferenciaSupervisor) < 0.01 ? 'color:#16a34a' : 'color:#ef4444;font-weight:700');
    return `<tr>
      ${colFecha}
      <td>${esc(label)} — ${m}</td>
      <td class="text-right">${fmt(s.saldoCalculado)}</td>
      <td class="text-right">${s.conteoCajero == null ? '—' : fmt(s.conteoCajero)}</td>
      <td class="text-right" style="${colorCajero}">${s.diferenciaCajero == null ? '—' : fmt(s.diferenciaCajero)}</td>
      <td class="text-right">${s.conteoSupervisor == null ? '—' : fmt(s.conteoSupervisor)}</td>
      <td class="text-right" style="${colorSup}">${s.diferenciaSupervisor == null ? '—' : fmt(s.diferenciaSupervisor)}</td>
    </tr>`;
  }).join('');
}

// ─── Comprobantes imprimibles (envío a Oficina / depósito al banco) ───────
// Ventana aparte con su propio HTML/CSS para impresión — no reutiliza imprimirVista
// (app.js) porque esto es un comprobante puntual, no una tabla ya visible en pantalla.
function cjeImprimirRecibo(titulo, info, denomRows, totales) {
  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family: Arial, sans-serif; font-size:13px; color:#111; padding:20px; }
      h2 { font-size:16px; margin-bottom:10px; }
      .meta div { font-size:12px; color:#374151; margin-bottom:3px; }
      table { width:100%; border-collapse:collapse; margin:14px 0; }
      th { background:#1a1f3a; color:#fff; padding:5px 8px; text-align:left; font-size:11px; }
      td { padding:4px 8px; border-bottom:1px solid #e5e7eb; font-size:12px; }
      .totales td { font-weight:700; border-top:2px solid #111; border-bottom:none; }
      @media print { @page { margin: 1.2cm; } body { padding:0; } }
    </style>
  </head><body>
    <h2>${esc(titulo)}</h2>
    <div class="meta">${info.map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v ?? '—')}</div>`).join('')}</div>
    ${denomRows ? `<table><thead><tr><th>Denominación</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>${denomRows.map(r => `<tr><td>${esc(r.denom)}</td><td style="text-align:right">${r.qty}</td><td style="text-align:right">${fmt(r.subtotal)}</td></tr>`).join('')}</tbody></table>` : ''}
    <table class="totales"><tbody>
      ${totales.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${esc(v)}</td></tr>`).join('')}
    </tbody></table>
  </body></html>`;
  const win = window.open('', '_blank', 'width=480,height=700');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function cjeImprimirEnvio(envio, operacion) {
  const denomRows = Object.entries(envio.denominacion || {})
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([d, q]) => ({ denom: `${envio.moneda === 'PEN' ? 'S/' : 'US$'} ${d}`, qty: q, subtotal: Number(d) * Number(q) }));
  cjeImprimirRecibo('Envío a Oficina', [
    ['Operación', operacion],
    ['Fecha', fmtDate(envio.fechaEnvio)],
    ['Moneda', envio.moneda],
    ['Enviado por', envio.enviadoPor],
    ['Comentario', envio.comentario],
  ], denomRows, [
    ['Venta', fmt(envio.montoVenta)],
    ['TIP', fmt(envio.montoTip)],
    ['Total enviado', fmt(envio.montoEnviado)],
  ]);
}

function cjeImprimirDeposito(dep) {
  cjeImprimirRecibo('Depósito al Banco', [
    ['Operación', dep.operacion],
    ['Fecha de depósito', fmtDate(dep.fechaDeposito)],
    ['Moneda', dep.moneda],
    ['Origen', dep.origen === 'OFICINA' ? 'Oficina' : 'Caja (directo)'],
    ['Cubre', dep.cubre.map(c => fmtDate(c.fecha)).join(', ')],
    ['Registrado por', dep.registradoPor],
    ['Comentario', dep.comentario],
  ], null, [
    ['Venta', fmt(dep.montoVenta)],
    ['TIP', fmt(dep.montoTip)],
    ['Monto depositado', fmt(dep.montoDepositado)],
    ['Diferencia', fmt(dep.diferencia)],
  ]);
}

function cjeSelectOperacionHtml(id, operaciones) {
  return `<select id="${id}" class="form-control" style="width:180px"><option value="">— Seleccionar —</option>${operaciones.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
}

// ─── Dispatcher por rol(es) ────────────────────────────────────────────────
// Un usuario puede tener varios roles a la vez (ej. Oficina + Supervisor). ADMIN
// ve los 5. Con un solo rol se muestra esa vista directamente; con varios, pestañas.
const CJE_VISTAS = {
  CAJA: { label: '🧾 Caja', fn: viewCajaEfectivoCaja },
  OFICINA: { label: '🏢 Oficina', fn: viewCajaEfectivoOficina },
  SUPERVISOR: { label: '🔎 Supervisor', fn: viewCajaEfectivoSupervisor },
  CONTABILIDAD: { label: '📒 Contabilidad', fn: viewCajaEfectivoContabilidad },
  GERENCIA: { label: '📊 Gerencia', fn: viewCajaEfectivoGerencia },
};

async function viewCajaEfectivo(container) {
  const roles = S.user.role === ROLES.ADMIN ? Object.keys(CJE_VISTAS) : (S.user.rolesCajaEfectivo || []);
  if (!roles.length) { container.innerHTML = '<div class="empty-state"><p>Sin acceso a Cierre de Caja.</p></div>'; return; }
  if (roles.length === 1) return CJE_VISTAS[roles[0]].fn(container);
  viewCajaEfectivoMultiRol(container, roles);
}

function viewCajaEfectivoMultiRol(container, roles) {
  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja</div></div>
    <div class="page-body">
      <div class="tabs mb-16">
        ${roles.map((r, i) => `<button class="tab-btn${i === 0 ? ' active' : ''}" data-vista="${r}">${CJE_VISTAS[r].label}</button>`).join('')}
      </div>
      <div id="cja-sub"></div>
    </div>`;
  const sub = document.getElementById('cja-sub');
  const activar = id => {
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === id));
    CJE_VISTAS[id].fn(sub);
  };
  container.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => activar(b.dataset.vista)));
  activar(roles[0]);
}

// ─── Modal de depósito al banco (compartido por Caja y Oficina) ───────────
// `origen` CAJA|OFICINA, `disponibles` = [{tipo,id,fecha,monto,turno?}] ya filtrados
// por moneda. `onDone` se llama al guardar con éxito.
function cjeAbrirModalDeposito(operacion, moneda, disponibles, onDone) {
  const fmtFecha = f => String(f).slice(0, 10);
  openModal(`🏦 Depositar al Banco — ${moneda}`, `
    <p class="text-muted" style="font-size:13px">Selecciona los turnos u envíos completos que cubre este depósito (no se puede elegir una parte). No hace falta desglose de billetes aquí — ya se contó al enviar/cerrar.</p>
    <table class="data-table" style="font-size:13px">
      <thead><tr><th></th><th>Fecha</th><th>${disponibles[0]?.turno !== undefined ? 'Turno' : 'Origen'}</th><th class="text-right">Venta</th><th class="text-right">TIP</th><th class="text-right">Monto</th></tr></thead>
      <tbody>
        ${disponibles.map(d => `<tr>
          <td><input type="checkbox" class="cje-dep-chk" value="${d.id}" data-monto="${d.monto}" data-venta="${d.venta}" data-tip="${d.tip}"></td>
          <td>${esc(fmtFecha(d.fecha))}</td>
          <td>${esc(d.turno || (d.tipo === 'ENVIO' ? 'Envío de Caja' : ''))}</td>
          <td class="text-right">${fmt(d.venta)}</td>
          <td class="text-right">${fmt(d.tip)}</td>
          <td class="text-right">${fmt(d.monto)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="text-muted text-center">Nada disponible para depositar en esta moneda</td></tr>'}
      </tbody>
    </table>
    <div style="text-align:right;font-size:13px;margin-top:8px">
      Venta seleccionada: <strong id="cje-dep-venta">0.00</strong> &nbsp;
      TIP seleccionado: <strong id="cje-dep-tip">0.00</strong> &nbsp;
      Total seleccionado: <strong id="cje-dep-total">0.00</strong>
    </div>
    <div class="form-group mt-16"><label>Monto depositado (según voucher)</label>
      <input type="number" min="0" step="0.1" id="cje-dep-monto" class="form-control" style="width:160px"></div>
    <div class="form-group"><label>Fecha del depósito</label>
      <input type="date" id="cje-dep-fecha" class="form-control" value="${today()}" style="width:160px"></div>
    <div class="form-group"><label>Comentario</label>
      <input type="text" id="cje-dep-comentario" class="form-control"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
      <button class="btn btn-primary" id="cje-dep-btn">💾 Registrar Depósito</button>
    </div>`, null, { medium: true });

  const modal = document.getElementById('modal');
  const recalc = () => {
    const chk = [...modal.querySelectorAll('.cje-dep-chk:checked')];
    modal.querySelector('#cje-dep-total').textContent = chk.reduce((s, c) => s + Number(c.dataset.monto), 0).toFixed(2);
    modal.querySelector('#cje-dep-venta').textContent = chk.reduce((s, c) => s + Number(c.dataset.venta), 0).toFixed(2);
    modal.querySelector('#cje-dep-tip').textContent = chk.reduce((s, c) => s + Number(c.dataset.tip), 0).toFixed(2);
  };
  modal.querySelectorAll('.cje-dep-chk').forEach(c => c.addEventListener('change', recalc));

  document.getElementById('cje-dep-btn').addEventListener('click', async () => {
    const cubre = [...modal.querySelectorAll('.cje-dep-chk:checked')].map(c => ({ id: c.value }));
    if (!cubre.length) { toast('Selecciona al menos un ítem', 'error'); return; }
    const montoDepositado = Number(document.getElementById('cje-dep-monto').value);
    if (!montoDepositado) { toast('Ingresa el monto depositado', 'error'); return; }
    try {
      const deposito = await POST('/caja-efectivo/depositos', {
        operacion, moneda, montoDepositado,
        fechaDeposito: document.getElementById('cje-dep-fecha').value,
        cubre, comentario: document.getElementById('cje-dep-comentario').value.trim(),
      });
      toast('Depósito registrado', 'success');
      onDone?.();
      document.getElementById('modal-body').innerHTML = `
        <p>✅ Depósito registrado correctamente.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cerrar</button>
          <button class="btn btn-primary" id="cje-dep-print-btn">🖨️ Imprimir</button>
        </div>`;
      document.getElementById('cje-dep-print-btn').addEventListener('click', () => cjeImprimirDeposito(deposito));
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function cjeRenderSeccionDepositos(root, operacion, origen) {
  root.innerHTML = `
    <div class="card"><div class="card-body">
      <div style="font-weight:700;margin-bottom:10px">Depósitos al Banco</div>
      <div id="cje-dep-pen"></div>
      <div id="cje-dep-usd" class="mt-16"></div>
    </div></div>`;

  async function cargarMoneda(moneda, elId) {
    const el = document.getElementById(elId);
    try {
      const disponibles = await GET(`/caja-efectivo/depositos/disponibles?operacion=${encodeURIComponent(operacion)}&moneda=${moneda}`);
      const total = disponibles.reduce((s, d) => s + d.monto, 0);
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${moneda}</strong> — ${disponibles.length} pendiente(s) de depositar, total ${fmt(total)}</div>
          <button class="btn btn-outline btn-sm cje-dep-abrir" ${!disponibles.length ? 'disabled' : ''}>🏦 Depositar</button>
        </div>`;
      el.querySelector('.cje-dep-abrir')?.addEventListener('click', () => {
        cjeAbrirModalDeposito(operacion, moneda, disponibles, () => cjeRenderSeccionDepositos(root, operacion, origen));
      });
    } catch (e) { el.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }
  await cargarMoneda('PEN', 'cje-dep-pen');
  await cargarMoneda('USD', 'cje-dep-usd');
}

// ─── Vista CAJA (Tienda) ────────────────────────────────────────────────────
async function viewCajaEfectivoCaja(container) {
  let operacionActual = '';
  let cfg = { tieneOficina: false, turnos: [] };
  let turnoActual = null;

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja — Tienda</div></div>
    <div class="page-body">
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <div id="cje-op-wrap"></div>
          </div>
        </div>
      </div>
      <div id="cje-content"></div>
      <div id="cje-depositos" class="mt-16"></div>
    </div>`;

  const root = document.getElementById('cje-content');
  let operaciones = [];
  try {
    operaciones = await GET('/caja-efectivo/operaciones');
    document.getElementById('cje-op-wrap').innerHTML = cjeSelectOperacionHtml('cje-operacion', operaciones);
    const sel = document.getElementById('cje-operacion');
    sel.addEventListener('change', async e => { operacionActual = e.target.value; await cargar(); });
    if (operaciones.length === 1) { sel.value = operaciones[0]; operacionActual = operaciones[0]; await cargar(); }
  } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }

  async function cargar() {
    if (!operacionActual) { root.innerHTML = ''; document.getElementById('cje-depositos').innerHTML = ''; return; }
    root.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      cfg = await GET(`/caja-efectivo/config/propio?operacion=${encodeURIComponent(operacionActual)}`);
      const turnos = await GET(`/caja-efectivo/turnos?operacion=${encodeURIComponent(operacionActual)}`);
      turnoActual = turnos.find(t => t.estado === 'ABIERTO') || null;
      if (turnoActual) await renderTurnoAbierto(turnos);
      else renderAbrirTurno(turnos);
      if (!cfg.tieneOficina) await cjeRenderSeccionDepositos(document.getElementById('cje-depositos'), operacionActual, 'CAJA');
      else document.getElementById('cje-depositos').innerHTML = '';
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }

  function historialHtml(turnos) {
    const recientes = turnos.slice(0, 8);
    if (!recientes.length) return '';
    return `
      <div class="card mt-16"><div class="card-body">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px">Turnos recientes</div>
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Fecha</th><th>Turno</th><th>Estado</th></tr></thead>
          <tbody>${recientes.map(t => `<tr><td>${esc(fmtDate(t.fecha))}</td><td>${esc(t.turno)}</td><td>${t.estado === 'ABIERTO' ? '🟢 Abierto' : '✔️ Cerrado'}</td></tr>`).join('')}</tbody>
        </table>
      </div></div>`;
  }

  function renderAbrirTurno(turnos) {
    root.innerHTML = `
      <div class="card"><div class="card-body">
        <div style="font-weight:700;margin-bottom:10px">Abrir Turno</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Fecha</label>
            <input type="date" id="cje-ab-fecha" class="form-control" value="${today()}" style="width:160px"></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Turno</label>
            ${cfg.turnos.length
              ? `<select id="cje-ab-turno" class="form-control" style="width:160px">${cfg.turnos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>`
              : `<input type="text" id="cje-ab-turno" class="form-control" style="width:160px" placeholder="ej. Único">`}
          </div>
        </div>
        <div style="font-weight:600;font-size:13px;margin-bottom:6px">Conteo de apertura (fondo fijo: S/ ${fmt(cfg.fondoFijoCaja?.pen||0)} / US$ ${fmt(cfg.fondoFijoCaja?.usd||0)})</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">${cjeDenomTableHtml('ab')}</div>
        <button class="btn btn-primary mt-16" id="cje-ab-btn">🔓 Abrir Turno</button>
      </div></div>
      ${historialHtml(turnos)}`;
    cjeDenomListener(root, 'ab');
    document.getElementById('cje-ab-btn').addEventListener('click', async () => {
      const fecha = document.getElementById('cje-ab-fecha').value;
      const turno = document.getElementById('cje-ab-turno').value.trim();
      if (!fecha || !turno) { toast('Completa fecha y turno', 'error'); return; }
      try {
        await POST('/caja-efectivo/turnos', { operacion: operacionActual, fecha, turno, conteoApertura: cjeDenomValores(root, 'ab') });
        toast('Turno abierto', 'success');
        await cargar();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function renderTurnoAbierto(turnos) {
    const { movimientos, envios } = await GET(`/caja-efectivo/turnos/${turnoActual._id}`);

    root.innerHTML = `
      <div class="card mb-16"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-weight:700">Turno ${esc(turnoActual.turno)} — ${esc(fmtDate(turnoActual.fecha))}</div>
          <div style="font-size:12px;color:var(--text-muted)">Abierto por ${esc(turnoActual.abiertoPor)}</div>
        </div>
        <button class="btn btn-outline btn-sm" id="cje-cerrar-btn">🔒 Cerrar Turno</button>
      </div></div>

      <div class="card mb-16"><div class="card-body">
        <div style="font-weight:700;margin-bottom:10px">Registrar Venta, TIP o Vuelto</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Tipo</label>
            <select id="cje-mov-tipo" class="form-control" style="width:140px">
              <option value="VENTA">Venta</option>
              <option value="TIP">TIP</option>
              <option value="VUELTO">Vuelto</option>
            </select>
          </div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Moneda</label>
            <select id="cje-mov-moneda" class="form-control" style="width:90px"><option value="PEN">PEN</option><option value="USD">USD</option></select>
          </div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Monto</label>
            <input type="number" min="0" step="0.1" id="cje-mov-monto" class="form-control" style="width:110px"></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Comentario</label>
            <input type="text" id="cje-mov-comentario" class="form-control" style="width:200px"></div>
          <button class="btn btn-primary" id="cje-mov-btn">+ Agregar</button>
        </div>
      </div></div>

      <div class="card mb-16"><div class="card-body">
        <div style="font-weight:700;margin-bottom:8px">Movimientos del turno</div>
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Tipo</th><th>Moneda</th><th class="text-right">Monto</th><th>Comentario</th><th></th></tr></thead>
          <tbody>
            ${movimientos.map(m => `<tr>
              <td>${CJE_TIPO_LABEL[m.tipo]}</td><td>${m.moneda}</td><td class="text-right">${fmt(m.monto)}</td>
              <td>${esc(m.comentario)}</td>
              <td><button class="btn btn-outline btn-xs cje-mov-del" data-id="${m._id}">🗑️</button></td>
            </tr>`).join('') || '<tr><td colspan="5" class="text-muted text-center">Sin movimientos aún</td></tr>'}
          </tbody>
        </table>
      </div></div>

      ${cfg.tieneOficina ? `
      <div class="card mb-16"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:700">Envíos a Oficina</div>
          <button class="btn btn-outline" id="cje-env-btn">📤 Enviar a Oficina</button>
        </div>
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Moneda</th><th class="text-right">Venta</th><th class="text-right">TIP</th><th class="text-right">Total enviado</th><th>Estado</th><th></th></tr></thead>
          <tbody>${envios.map(e => `<tr>
            <td>${e.moneda}</td><td class="text-right">${fmt(e.montoVenta)}</td><td class="text-right">${fmt(e.montoTip)}</td>
            <td class="text-right">${fmt(e.montoEnviado)}</td><td>${e.estado === 'ENVIADO' ? '⏳ Enviado' : '✔️ Confirmado'}</td>
            <td><button class="btn btn-outline btn-xs cje-env-print" data-id="${e._id}">🖨️</button></td>
          </tr>`).join('') || '<tr><td colspan="6" class="text-muted text-center">Sin envíos aún</td></tr>'}</tbody>
        </table>
      </div></div>` : `
      <div class="card mb-16"><div class="card-body">
        <div style="font-size:13px;color:var(--text-muted)">Esta operación no tiene oficina — el depósito al banco se registra directo
        desde la sección "Depósitos al Banco" más abajo, una vez cerrado el turno.</div>
      </div></div>`}
      ${historialHtml(turnos)}`;

    document.getElementById('cje-mov-tipo').addEventListener('change', e => {
      const monedaSel = document.getElementById('cje-mov-moneda');
      if (e.target.value === 'VUELTO') { monedaSel.value = 'PEN'; monedaSel.disabled = true; } else { monedaSel.disabled = false; }
    });

    document.getElementById('cje-mov-btn').addEventListener('click', async () => {
      const tipo = document.getElementById('cje-mov-tipo').value;
      const moneda = document.getElementById('cje-mov-moneda').value;
      const monto = Number(document.getElementById('cje-mov-monto').value);
      const comentario = document.getElementById('cje-mov-comentario').value.trim();
      if (!monto) { toast('Ingresa un monto', 'error'); return; }
      try {
        await POST(`/caja-efectivo/turnos/${turnoActual._id}/movimientos`, { tipo, moneda, monto, comentario });
        toast('Movimiento agregado', 'success');
        await cargar();
      } catch (e) { toast(e.message, 'error'); }
    });

    root.querySelectorAll('.cje-mov-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este movimiento?')) return;
        try { await DEL(`/caja-efectivo/movimientos/${btn.dataset.id}`); await cargar(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });

    document.getElementById('cje-env-btn')?.addEventListener('click', () => abrirModalEnvio());

    root.querySelectorAll('.cje-env-print').forEach(btn => {
      btn.addEventListener('click', () => {
        const envio = envios.find(e => e._id === btn.dataset.id);
        if (envio) cjeImprimirEnvio(envio, operacionActual);
      });
    });

    document.getElementById('cje-cerrar-btn').addEventListener('click', () => abrirModalCierre());
  }

  function abrirModalEnvio() {
    const render = moneda => `
      <div class="form-group"><label>Moneda</label>
        <select id="cje-env-moneda" class="form-control" style="width:110px">
          <option value="PEN" ${moneda==='PEN'?'selected':''}>PEN</option>
          <option value="USD" ${moneda==='USD'?'selected':''}>USD</option>
        </select>
      </div>
      <div style="font-weight:600;font-size:13px;margin:10px 0 6px">Desglose de billetes/monedas enviados</div>
      <div id="cje-env-denom">${cjeDenomTableUnaMoneda('env', moneda)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <div class="form-group"><label>Monto de Venta</label>
          <input type="number" min="0" step="0.1" id="cje-env-venta" class="form-control" style="width:140px" value="0"></div>
        <div class="form-group"><label>Monto de TIP</label>
          <input type="number" min="0" step="0.1" id="cje-env-tip" class="form-control" style="width:140px" value="0"></div>
      </div>
      <div id="cje-env-check" style="font-size:12px;margin-top:4px"></div>
      <div class="form-group mt-16"><label>Comentario</label>
        <input type="text" id="cje-env-comentario" class="form-control"></div>`;

    openModal('📤 Enviar a Oficina', `
      ${render('PEN')}
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
        <button class="btn btn-primary" id="cje-env-guardar-btn">💾 Enviar</button>
      </div>`, null, { medium: true });

    const modal = document.getElementById('modal');
    let monedaActual = 'PEN';

    function totalDenom() {
      const valores = cjeDenomValores(modal, 'env');
      return cjeSumaConteo(valores, monedaActual.toLowerCase());
    }

    function actualizarCheck() {
      const total = totalDenom();
      const venta = Number(document.getElementById('cje-env-venta').value) || 0;
      const tip = Number(document.getElementById('cje-env-tip').value) || 0;
      const el = document.getElementById('cje-env-check');
      const cuadra = Math.abs(venta + tip - total) < 0.01;
      el.innerHTML = `Total desglose: ${fmt(total)} — Venta + TIP: ${fmt(venta + tip)} ${cuadra ? '✔️' : '⚠️ no cuadra'}`;
      el.style.color = cuadra ? '#16a34a' : '#ef4444';
    }

    // Re-ata solo los inputs de denominación (se recrean al cambiar de moneda);
    // venta/TIP/comentario son fijos en el DOM, se atan una sola vez más abajo.
    function wireDenom() {
      cjeDenomListener(modal, 'env');
      modal.querySelectorAll('.cje-denom-input[data-prefix="env"]').forEach(inp => inp.addEventListener('input', actualizarCheck));
      actualizarCheck();
    }

    wireDenom();
    document.getElementById('cje-env-venta').addEventListener('input', actualizarCheck);
    document.getElementById('cje-env-tip').addEventListener('input', actualizarCheck);

    document.getElementById('cje-env-moneda').addEventListener('change', e => {
      monedaActual = e.target.value;
      document.getElementById('cje-env-denom').innerHTML = cjeDenomTableUnaMoneda('env', monedaActual);
      wireDenom();
    });

    document.getElementById('cje-env-guardar-btn').addEventListener('click', async () => {
      const denominacion = cjeDenomValores(modal, 'env')[monedaActual.toLowerCase()];
      if (!Object.keys(denominacion || {}).length) { toast('Ingresa el desglose de billetes/monedas', 'error'); return; }
      const montoVenta = Number(document.getElementById('cje-env-venta').value) || 0;
      const montoTip = Number(document.getElementById('cje-env-tip').value) || 0;
      if (Math.abs(montoVenta + montoTip - totalDenom()) > 0.01) {
        toast('Venta + TIP debe sumar el mismo total que el desglose', 'error'); return;
      }
      try {
        const envio = await POST('/caja-efectivo/envios', {
          operacion: operacionActual, origenTurnoId: turnoActual._id, moneda: monedaActual,
          denominacion, montoVenta, montoTip,
          comentario: document.getElementById('cje-env-comentario').value.trim(),
        });
        toast('Enviado a Oficina', 'success');
        await cargar();
        document.getElementById('modal-body').innerHTML = `
          <p>✅ Envío registrado correctamente.</p>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cerrar</button>
            <button class="btn btn-primary" id="cje-env-print-btn">🖨️ Imprimir</button>
          </div>`;
        document.getElementById('cje-env-print-btn').addEventListener('click', () => cjeImprimirEnvio(envio, operacionActual));
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function abrirModalCierre() {
    openModal('🔒 Cerrar Turno', `
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">Conteo de cierre</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">${cjeDenomTableHtml('ci')}</div>
      <div class="form-group mt-16"><label>Comentario</label>
        <input type="text" id="cje-ci-comentario" class="form-control"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
        <button class="btn btn-primary" id="cje-ci-btn">💾 Cerrar Turno</button>
      </div>`, null, { medium: true });
    const modal = document.getElementById('modal');
    cjeDenomListener(modal, 'ci');
    document.getElementById('cje-ci-btn').addEventListener('click', async () => {
      try {
        await PUT(`/caja-efectivo/turnos/${turnoActual._id}/cerrar`, {
          conteoCierre: cjeDenomValores(modal, 'ci'),
          comentario: document.getElementById('cje-ci-comentario').value.trim(),
        });
        closeModal();
        toast('Turno cerrado', 'success');
        await cargar();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}

// ─── Vista OFICINA ──────────────────────────────────────────────────────────
async function viewCajaEfectivoOficina(container) {
  let operacionActual = '';
  let fechaActual = today();
  let cfg = { fondoFijoOficina: { pen: 0, usd: 0 } };

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja — Oficina</div></div>
    <div class="page-body">
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <div id="cjo-op-wrap"></div></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Fecha</label>
            <input type="date" id="cjo-fecha" class="form-control" value="${fechaActual}" style="width:160px"></div>
        </div>
      </div>
      <div id="cjo-content"></div>
      <div id="cjo-depositos" class="mt-16"></div>
    </div>`;

  const root = document.getElementById('cjo-content');
  try {
    const operaciones = await GET('/caja-efectivo/operaciones');
    document.getElementById('cjo-op-wrap').innerHTML = cjeSelectOperacionHtml('cjo-operacion', operaciones);
    document.getElementById('cjo-operacion').addEventListener('change', async e => { operacionActual = e.target.value; await cargar(); });
    if (operaciones.length === 1) { document.getElementById('cjo-operacion').value = operaciones[0]; operacionActual = operaciones[0]; await cargar(); }
  } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }

  document.getElementById('cjo-fecha').addEventListener('change', async e => { fechaActual = e.target.value; await cargar(); });

  async function cargar() {
    if (!operacionActual) { root.innerHTML = ''; document.getElementById('cjo-depositos').innerHTML = ''; return; }
    root.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      cfg = await GET(`/caja-efectivo/config/propio?operacion=${encodeURIComponent(operacionActual)}`);
      const [dia, pendientes] = await Promise.all([
        GET(`/caja-efectivo/oficina/dia?operacion=${encodeURIComponent(operacionActual)}&fecha=${fechaActual}`),
        GET(`/caja-efectivo/envios/pendientes?operacion=${encodeURIComponent(operacionActual)}`),
      ]);
      render(dia, pendientes);
      await cjeRenderSeccionDepositos(document.getElementById('cjo-depositos'), operacionActual, 'OFICINA');
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }

  function render(dia, pendientes) {
    root.innerHTML = `
      <div class="card mb-16"><div class="card-body">
        <div style="font-weight:700;margin-bottom:8px">Envíos de Tienda pendientes de confirmar</div>
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Moneda</th><th class="text-right">Venta</th><th class="text-right">TIP</th><th class="text-right">Total enviado</th><th>Confirmar</th></tr></thead>
          <tbody>
            ${pendientes.map(p => `<tr>
              <td>${p.moneda}</td><td class="text-right">${fmt(p.montoVenta)}</td><td class="text-right">${fmt(p.montoTip)}</td>
              <td class="text-right">${fmt(p.montoEnviado)}</td>
              <td style="display:flex;gap:6px;align-items:center">
                <input type="number" step="0.1" class="form-control cjo-conf-monto" data-id="${p._id}" value="${p.montoEnviado}" style="width:100px">
                <button class="btn btn-primary btn-xs cjo-conf-btn" data-id="${p._id}">✔️ Confirmar</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="5" class="text-muted text-center">Sin envíos pendientes</td></tr>'}
          </tbody>
        </table>
      </div></div>

      <div class="card"><div class="card-body">
        <div style="font-weight:700;margin-bottom:10px">Día ${esc(fechaActual)} ${dia?.fechaCierre ? '(cerrado)' : dia?.fechaApertura ? '(abierto)' : '(sin abrir)'}</div>
        ${!dia?.fechaApertura ? `
          <div style="font-weight:600;font-size:13px;margin-bottom:6px">Conteo de apertura (fondo fijo: S/ ${fmt(cfg.fondoFijoOficina?.pen||0)} / US$ ${fmt(cfg.fondoFijoOficina?.usd||0)})</div>
          <div style="display:flex;gap:24px;flex-wrap:wrap">${cjeDenomTableHtml('cjoab')}</div>
          <button class="btn btn-primary mt-16" id="cjo-abrir-btn">🔓 Abrir Día</button>
        ` : !dia?.fechaCierre ? `
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Abierto por ${esc(dia.abiertoPor)} — conteo apertura: PEN ${fmt(cjeSumaConteo(dia.conteoApertura,'pen'))}, USD ${fmt(cjeSumaConteo(dia.conteoApertura,'usd'))}</div>
          <div style="font-weight:600;font-size:13px;margin-bottom:6px">Conteo de cierre</div>
          <div style="display:flex;gap:24px;flex-wrap:wrap">${cjeDenomTableHtml('cjoci')}</div>
          <button class="btn btn-primary mt-16" id="cjo-cerrar-btn">🔒 Cerrar Día</button>
        ` : `
          <div style="font-size:13px">✔️ Cerrado por ${esc(dia.cerradoPor)} — conteo: PEN ${fmt(cjeSumaConteo(dia.conteoCierre,'pen'))}, USD ${fmt(cjeSumaConteo(dia.conteoCierre,'usd'))}</div>
        `}
      </div></div>`;

    root.querySelectorAll('.cjo-conf-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const input = root.querySelector(`.cjo-conf-monto[data-id="${btn.dataset.id}"]`);
        try {
          await PUT(`/caja-efectivo/envios/${btn.dataset.id}/confirmar`, { montoConfirmado: Number(input.value) });
          toast('Confirmado', 'success');
          await cargar();
        } catch (e) { toast(e.message, 'error'); }
      });
    });

    if (!dia?.fechaApertura) {
      cjeDenomListener(root, 'cjoab');
      document.getElementById('cjo-abrir-btn').addEventListener('click', async () => {
        try {
          await PUT('/caja-efectivo/oficina/dia/abrir', { operacion: operacionActual, fecha: fechaActual, conteoApertura: cjeDenomValores(root, 'cjoab') });
          toast('Día abierto', 'success');
          await cargar();
        } catch (e) { toast(e.message, 'error'); }
      });
    } else if (!dia?.fechaCierre) {
      cjeDenomListener(root, 'cjoci');
      document.getElementById('cjo-cerrar-btn').addEventListener('click', async () => {
        try {
          await PUT('/caja-efectivo/oficina/dia/cerrar', { operacion: operacionActual, fecha: fechaActual, conteoCierre: cjeDenomValores(root, 'cjoci') });
          toast('Día cerrado', 'success');
          await cargar();
        } catch (e) { toast(e.message, 'error'); }
      });
    }
  }
}

// ─── Vista SUPERVISOR ───────────────────────────────────────────────────────
async function viewCajaEfectivoSupervisor(container) {
  let operacionActual = '';

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja — Supervisor</div></div>
    <div class="page-body">
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <div id="cjs-op-wrap"></div></div>
        </div>
      </div>
      <div id="cjs-content"></div>
    </div>`;

  const root = document.getElementById('cjs-content');
  try {
    const operaciones = await GET('/caja-efectivo/operaciones');
    document.getElementById('cjs-op-wrap').innerHTML = cjeSelectOperacionHtml('cjs-operacion', operaciones);
    document.getElementById('cjs-operacion').addEventListener('change', async e => { operacionActual = e.target.value; await cargar(); });
    if (operaciones.length === 1) { document.getElementById('cjs-operacion').value = operaciones[0]; operacionActual = operaciones[0]; await cargar(); }
  } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }

  async function cargar() {
    if (!operacionActual) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const { tienda, oficina } = await GET(`/caja-efectivo/supervisor/pendientes?operacion=${encodeURIComponent(operacionActual)}`);
      render(tienda, oficina);
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }

  function render(tienda, oficina) {
    root.innerHTML = `
      <div class="card mb-16"><div class="card-body">
        <div style="font-weight:700;margin-bottom:8px">Turnos de Tienda pendientes de conteo</div>
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Fecha</th><th>Turno</th><th></th></tr></thead>
          <tbody>${tienda.map(t => `<tr><td>${esc(fmtDate(t.fecha))}</td><td>${esc(t.turno)}</td><td><button class="btn btn-primary btn-xs cjs-contar" data-ubicacion="TIENDA" data-id="${t._id}">Contar</button></td></tr>`).join('') || '<tr><td colspan="3" class="text-muted text-center">Sin pendientes</td></tr>'}</tbody>
        </table>
      </div></div>
      <div class="card"><div class="card-body">
        <div style="font-weight:700;margin-bottom:8px">Días de Oficina pendientes de conteo</div>
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Fecha</th><th></th></tr></thead>
          <tbody>${oficina.map(d => `<tr><td>${esc(fmtDate(d.fecha))}</td><td><button class="btn btn-primary btn-xs cjs-contar" data-ubicacion="OFICINA" data-id="${d._id}">Contar</button></td></tr>`).join('') || '<tr><td colspan="2" class="text-muted text-center">Sin pendientes</td></tr>'}</tbody>
        </table>
      </div></div>`;

    root.querySelectorAll('.cjs-contar').forEach(btn => {
      btn.addEventListener('click', () => abrirModalConteo(btn.dataset.ubicacion, btn.dataset.id));
    });
  }

  function abrirModalConteo(ubicacion, refId) {
    openModal(`🔎 Conteo de Supervisor — ${ubicacion === 'TIENDA' ? 'Tienda' : 'Oficina'}`, `
      <div style="display:flex;gap:24px;flex-wrap:wrap">${cjeDenomTableHtml('sup')}</div>
      <div class="form-group mt-16"><label>Comentario</label>
        <input type="text" id="cjs-comentario" class="form-control"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.add('hidden')">Cancelar</button>
        <button class="btn btn-primary" id="cjs-guardar-btn">💾 Guardar Conteo</button>
      </div>`, null, { medium: true });
    const modal = document.getElementById('modal');
    cjeDenomListener(modal, 'sup');
    document.getElementById('cjs-guardar-btn').addEventListener('click', async () => {
      try {
        await POST('/caja-efectivo/supervisor/conteo', {
          operacion: operacionActual, ubicacion, refId,
          conteo: cjeDenomValores(modal, 'sup'),
          comentario: document.getElementById('cjs-comentario').value.trim(),
        });
        closeModal();
        toast('Conteo registrado', 'success');
        await cargar();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}

// ─── Vista CONTABILIDAD (solo lectura) ─────────────────────────────────────
async function viewCajaEfectivoContabilidad(container) {
  let operacionActual = '';
  let desde = today().slice(0, 8) + '01';
  let hasta = today();

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja — Contabilidad</div></div>
    <div class="page-body">
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <div id="cjb-op-wrap"></div></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Desde</label>
            <input type="date" id="cjb-desde" class="form-control" value="${desde}" style="width:150px"></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Hasta</label>
            <input type="date" id="cjb-hasta" class="form-control" value="${hasta}" style="width:150px"></div>
        </div>
      </div>
      <div id="cjb-content"></div>
    </div>`;

  const root = document.getElementById('cjb-content');
  try {
    const operaciones = await GET('/caja-efectivo/operaciones');
    document.getElementById('cjb-op-wrap').innerHTML = cjeSelectOperacionHtml('cjb-operacion', operaciones);
    document.getElementById('cjb-operacion').addEventListener('change', async e => { operacionActual = e.target.value; await cargar(); });
    if (operaciones.length === 1) { document.getElementById('cjb-operacion').value = operaciones[0]; operacionActual = operaciones[0]; await cargar(); }
  } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }

  document.getElementById('cjb-desde').addEventListener('change', async e => { desde = e.target.value; await cargar(); });
  document.getElementById('cjb-hasta').addEventListener('change', async e => { hasta = e.target.value; await cargar(); });

  async function cargar() {
    if (!operacionActual) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const params = `operacion=${encodeURIComponent(operacionActual)}&desde=${desde}&hasta=${hasta}`;
      const [dias, depositos, teorico] = await Promise.all([
        GET(`/caja-efectivo/contabilidad/movimientos?${params}`),
        GET(`/caja-efectivo/contabilidad/depositos?${params}`),
        GET(`/caja-efectivo/gerencia/teorico?${params}`),
      ]);
      render(dias, depositos, teorico);
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }

  function render(dias, depositos, teorico) {
    root.innerHTML = `
      <div class="card mb-16"><div class="card-body" id="cjb-tabla-movimientos">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:700">Movimiento de efectivo por día</div>
          <button class="btn btn-outline btn-sm" onclick="imprimirVista('cjb-tabla-movimientos','Movimiento de Efectivo')">🖨️ Imprimir</button>
        </div>
        <div class="table-wrap">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Fecha</th><th class="text-right">Venta PEN</th><th class="text-right">Venta USD</th><th class="text-right">TIP PEN</th><th class="text-right">TIP USD</th><th class="text-right">Vuelto PEN</th><th class="text-right">Turnos cerrados</th></tr></thead>
          <tbody>
            ${dias.map(d => `<tr>
              <td>${esc(d.fecha)}</td><td class="text-right">${fmt(d.VENTA_PEN)}</td><td class="text-right">${fmt(d.VENTA_USD)}</td>
              <td class="text-right">${fmt(d.TIP_PEN)}</td><td class="text-right">${fmt(d.TIP_USD)}</td><td class="text-right">${fmt(d.VUELTO_PEN)}</td>
              <td class="text-right">${d.turnosCerrados}/${d.turnos}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="text-muted text-center">Sin movimientos en el rango</td></tr>'}
          </tbody>
        </table>
        </div>
      </div></div>

      <div class="card mb-16" id="cjb-tabla-teorico"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:700">Saldo teórico vs. conteo real (cajero y supervisor)</div>
          <button class="btn btn-outline btn-sm" onclick="imprimirVista('cjb-tabla-teorico','Saldo Teórico vs. Real')">🖨️ Imprimir</button>
        </div>
        <div class="table-wrap">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Fecha</th><th>Caja</th><th class="text-right">Saldo calculado</th><th class="text-right">Conteo cajero</th><th class="text-right">Dif. cajero</th><th class="text-right">Conteo supervisor</th><th class="text-right">Dif. supervisor</th></tr></thead>
          <tbody>
            ${teorico.flatMap(d => [
              ...d.tienda.map(t => cjeFilaSaldo(`Turno ${t.turno.turno}`, t.saldo, d.fecha)),
              ...(d.oficina ? [cjeFilaSaldo('Oficina', d.oficina.saldo, d.fecha)] : []),
            ]).join('') || '<tr><td colspan="7" class="text-muted text-center">Sin datos en el rango</td></tr>'}
          </tbody>
        </table>
        </div>
      </div></div>

      <div class="card" id="cjb-tabla-depositos"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:700">Depósitos al banco</div>
          <button class="btn btn-outline btn-sm" onclick="imprimirVista('cjb-tabla-depositos','Depósitos al Banco')">🖨️ Imprimir</button>
        </div>
        <div class="table-wrap">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Fecha depósito</th><th>Origen</th><th>Moneda</th><th class="text-right">Venta</th><th class="text-right">TIP</th><th class="text-right">Monto depositado</th><th>Fechas que cubre</th><th class="text-right">Diferencia</th></tr></thead>
          <tbody>
            ${depositos.map(d => `<tr>
              <td>${esc(fmtDate(d.fechaDeposito))}</td><td>${d.origen}</td><td>${d.moneda}</td>
              <td class="text-right">${fmt(d.montoVenta)}</td><td class="text-right">${fmt(d.montoTip)}</td>
              <td class="text-right">${fmt(d.montoDepositado)}</td>
              <td>${d.cubre.map(c => esc(fmtDate(c.fecha))).join(', ')}</td>
              <td class="text-right" style="${Math.abs(d.diferencia) < 0.01 ? 'color:#16a34a' : 'color:#ef4444;font-weight:700'}">${fmt(d.diferencia)}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="text-muted text-center">Sin depósitos en el rango</td></tr>'}
          </tbody>
        </table>
        </div>
      </div></div>`;
  }
}

// ─── Vista GERENCIA (solo lectura: saldo teórico vs conteo del supervisor) ──
async function viewCajaEfectivoGerencia(container) {
  let operacionActual = '';
  let fechaActual = today();

  container.innerHTML = `
    <div class="page-header"><div class="page-title">🧾 Cierre de Caja — Gerencia</div></div>
    <div class="page-body">
      <div class="card mb-16" style="padding:14px">
        <div class="filter-bar" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Operación</label>
            <div id="cjg-op-wrap"></div></div>
          <div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Fecha</label>
            <input type="date" id="cjg-fecha" class="form-control" value="${fechaActual}" style="width:160px"></div>
        </div>
      </div>
      <div id="cjg-content"></div>
      <div id="cjg-depositos" class="mt-16"></div>
    </div>`;

  const root = document.getElementById('cjg-content');
  try {
    const operaciones = await GET('/caja-efectivo/operaciones');
    document.getElementById('cjg-op-wrap').innerHTML = cjeSelectOperacionHtml('cjg-operacion', operaciones);
    document.getElementById('cjg-operacion').addEventListener('change', async e => { operacionActual = e.target.value; await cargar(); });
    if (operaciones.length === 1) { document.getElementById('cjg-operacion').value = operaciones[0]; operacionActual = operaciones[0]; await cargar(); }
  } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }

  document.getElementById('cjg-fecha').addEventListener('change', async e => { fechaActual = e.target.value; await cargar(); });

  async function cargar() {
    if (!operacionActual) { root.innerHTML = ''; document.getElementById('cjg-depositos').innerHTML = ''; return; }
    root.innerHTML = '<div class="text-muted text-center py-24">⏳ Cargando...</div>';
    try {
      const dias = await GET(`/caja-efectivo/gerencia/teorico?operacion=${encodeURIComponent(operacionActual)}&desde=${fechaActual}&hasta=${fechaActual}`);
      const { tienda, oficina } = dias[0] || { tienda: [], oficina: null };
      root.innerHTML = `
        <div class="card mb-16" id="cjg-tabla-teorico"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:700">Saldo teórico vs. conteo real (cajero y supervisor) — ${esc(fechaActual)}</div>
            <button class="btn btn-outline btn-sm" onclick="imprimirVista('cjg-tabla-teorico','Saldo Teórico vs. Real')">🖨️ Imprimir</button>
          </div>
          <table class="data-table" style="font-size:13px">
            <thead><tr><th>Caja</th><th class="text-right">Saldo calculado</th><th class="text-right">Conteo cajero</th><th class="text-right">Dif. cajero</th><th class="text-right">Conteo supervisor</th><th class="text-right">Dif. supervisor</th></tr></thead>
            <tbody>
              ${tienda.map(t => cjeFilaSaldo(`Turno ${t.turno.turno}`, t.saldo)).join('')}
              ${oficina ? cjeFilaSaldo('Oficina', oficina.saldo) : ''}
              ${!tienda.length && !oficina ? '<tr><td colspan="6" class="text-muted text-center">Sin datos para esa fecha</td></tr>' : ''}
            </tbody>
          </table>
        </div></div>`;
      const dep = document.getElementById('cjg-depositos');
      // El depósito puede haberse hecho otro día y aun así cubrir esta fecha (cubre
      // varios turnos/envíos de días distintos) — se trae todo y se filtra por
      // `cubre[].fecha`, no por `fechaDeposito` (cuándo se llevó al banco).
      const todos = await GET(`/caja-efectivo/contabilidad/depositos?operacion=${encodeURIComponent(operacionActual)}`);
      const depositos = todos.filter(d => d.cubre.some(c => String(c.fecha).slice(0, 10) === fechaActual));
      dep.innerHTML = `
        <div class="card" id="cjg-tabla-depositos"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:700">Cuadre de depósitos que incluyen esta fecha</div>
            <button class="btn btn-outline btn-sm" onclick="imprimirVista('cjg-tabla-depositos','Cuadre de Depósitos')">🖨️ Imprimir</button>
          </div>
          <table class="data-table" style="font-size:12px">
            <thead><tr><th>Fecha depósito</th><th>Origen</th><th>Moneda</th><th class="text-right">Venta</th><th class="text-right">TIP</th><th class="text-right">Monto</th><th class="text-right">Diferencia</th></tr></thead>
            <tbody>${depositos.map(d => `<tr>
              <td>${esc(fmtDate(d.fechaDeposito))}</td><td>${d.origen}</td><td>${d.moneda}</td>
              <td class="text-right">${fmt(d.montoVenta)}</td><td class="text-right">${fmt(d.montoTip)}</td>
              <td class="text-right">${fmt(d.montoDepositado)}</td>
              <td class="text-right" style="${Math.abs(d.diferencia) < 0.01 ? 'color:#16a34a' : 'color:#ef4444;font-weight:700'}">${fmt(d.diferencia)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="text-muted text-center">Sin depósitos que cubran esta fecha</td></tr>'}</tbody>
          </table>
        </div></div>`;
    } catch (e) { root.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; }
  }
}

// ─── Admin: config por operación (Oficina, turnos, fondo fijo) ─────────────
async function renderAdminCajaEfectivo(container) {
  container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando...</div>`;
  let configs = [];
  try { configs = await GET('/caja-efectivo/config'); } catch (err) { container.innerHTML = `<div class="msg-error">${esc(err.message)}</div>`; return; }

  container.innerHTML = `
    <p class="mb-8 text-muted" style="font-size:13px">
      Por operación: si el efectivo pasa por una Oficina central antes del banco, los
      turnos disponibles en Tienda, y el fondo fijo de referencia (PEN/USD) de cada caja.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${configs.map(c => `
        <div class="card" style="padding:12px 16px">
          <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:10px">
            <div style="font-weight:700;font-size:13px;min-width:160px">${esc(c.operacion)} <span style="color:var(--text-muted);font-weight:400">${esc(c.nombre||'')}</span></div>
            <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
              <input type="checkbox" class="cje-oficina" data-op="${esc(c.operacion)}" ${c.tieneOficina?'checked':''} style="width:15px;height:15px;accent-color:var(--primary)">
              Tiene Oficina
            </label>
            <div style="flex:1;min-width:220px">
              <label class="form-label" style="font-size:11px">Turnos (separados por coma)</label>
              <input type="text" class="form-control cje-turnos" data-op="${esc(c.operacion)}" value="${esc((c.turnos||[]).join(', '))}" placeholder="Mañana, Noche">
            </div>
          </div>
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div><label class="form-label" style="font-size:11px">Fondo fijo Tienda — PEN</label>
              <input type="number" min="0" step="0.1" class="form-control cje-ff" data-op="${esc(c.operacion)}" data-campo="fondoFijoCaja" data-mon="pen" value="${c.fondoFijoCaja?.pen||0}" style="width:110px"></div>
            <div><label class="form-label" style="font-size:11px">Fondo fijo Tienda — USD</label>
              <input type="number" min="0" step="0.1" class="form-control cje-ff" data-op="${esc(c.operacion)}" data-campo="fondoFijoCaja" data-mon="usd" value="${c.fondoFijoCaja?.usd||0}" style="width:110px"></div>
            <div><label class="form-label" style="font-size:11px">Fondo fijo Oficina — PEN</label>
              <input type="number" min="0" step="0.1" class="form-control cje-ff" data-op="${esc(c.operacion)}" data-campo="fondoFijoOficina" data-mon="pen" value="${c.fondoFijoOficina?.pen||0}" style="width:110px"></div>
            <div><label class="form-label" style="font-size:11px">Fondo fijo Oficina — USD</label>
              <input type="number" min="0" step="0.1" class="form-control cje-ff" data-op="${esc(c.operacion)}" data-campo="fondoFijoOficina" data-mon="usd" value="${c.fondoFijoOficina?.usd||0}" style="width:110px"></div>
          </div>
        </div>`).join('')}
    </div>`;

  async function guardar(op, campo, valor) {
    try {
      await PUT(`/caja-efectivo/config/${encodeURIComponent(op)}`, { [campo]: valor });
      toast(`Configuración de ${op} actualizada`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  container.querySelectorAll('.cje-oficina').forEach(chk => {
    chk.addEventListener('change', () => guardar(chk.dataset.op, 'tieneOficina', chk.checked));
  });
  container.querySelectorAll('.cje-turnos').forEach(inp => {
    inp.addEventListener('change', () => guardar(inp.dataset.op, 'turnos', inp.value.split(',').map(s => s.trim()).filter(Boolean)));
  });
  container.querySelectorAll('.cje-ff').forEach(inp => {
    inp.addEventListener('change', () => {
      const op = inp.dataset.op, campo = inp.dataset.campo, mon = inp.dataset.mon;
      const otraMon = mon === 'pen' ? 'usd' : 'pen';
      const otroInput = container.querySelector(`.cje-ff[data-op="${CSS.escape(op)}"][data-campo="${campo}"][data-mon="${otraMon}"]`);
      guardar(op, campo, { [mon]: Number(inp.value) || 0, [otraMon]: Number(otroInput?.value) || 0 });
    });
  });
}

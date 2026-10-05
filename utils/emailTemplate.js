/**
 * emailTemplate.js — genera HTML para los correos de Pedidos Adicionales
 */

const COLORS = {
  nueva:    { bg: '#4361ee', label: '📝 NUEVA SOLICITUD' },
  aprobado: { bg: '#16a34a', label: '✅ PEDIDO APROBADO' },
  rechazado:{ bg: '#dc2626', label: '❌ PEDIDO RECHAZADO' },
  revisar:  { bg: '#d97706', label: '🔄 PEDIDO A REVISAR' },
  atender:  { bg: '#0891b2', label: '🛒 LISTO PARA ATENDER' },
  planta:   { bg: '#7c3aed', label: '🏭 LISTO PARA ATENDER' },
  atendido: { bg: '#16a34a', label: '📦 PEDIDO ATENDIDO'   },
};

const fmt = (n, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtMoney = n =>
  n == null ? '—' : 'S/ ' + Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const BADGE_COLORS = {
  APROBADO:  { bg: '#dcfce7', color: '#166534' },
  RECHAZADO: { bg: '#fee2e2', color: '#991b1b' },
  REVISAR:   { bg: '#fef3c7', color: '#92400e' },
  PENDIENTE: { bg: '#f3f4f6', color: '#374151' },
  ATENDIDO:  { bg: '#dbeafe', color: '#1e40af' },
};

function badgeHtml(estado) {
  const c = BADGE_COLORS[estado] || BADGE_COLORS.PENDIENTE;
  return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">${esc(estado)}</span>`;
}

/**
 * Construye el HTML completo del correo.
 *
 * @param {object} opts
 *   tipo        - clave de COLORS (nueva | aprobado | rechazado | revisar | atender | planta | atendido)
 *   titulo      - texto principal del banner
 *   mensaje     - párrafo de texto debajo del banner
 *   pedido      - objeto pedido (puede ser null para correos sin detalle)
 *   linkUrl     - URL del botón CTA (ej. /#aprobar)
 *   linkLabel   - texto del botón
 *   appUrl      - URL base de la aplicación (process.env.APP_URL o '')
 */
function buildEmailHtml({ tipo, titulo, mensaje, pedido, linkUrl, linkLabel, appUrl = '' }) {
  const color = COLORS[tipo] || COLORS.nueva;
  const total = pedido
    ? pedido.lineas.reduce((s, l) => s + (l.cantidadSolicitada || 0) * (l.costoUnitario || 0), 0)
    : 0;

  const lineasHtml = pedido && pedido.lineas?.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;font-size:13px">
      <thead>
        <tr style="background:#1a1f3a;color:#fff">
          <th style="padding:8px 10px;text-align:left;border-radius:4px 0 0 0">Item</th>
          <th style="padding:8px 10px;text-align:left">Nombre</th>
          <th style="padding:8px 10px;text-align:left">Grupo</th>
          <th style="padding:8px 10px;text-align:right">Cantidad</th>
          <th style="padding:8px 10px;text-align:right">Costo U.</th>
          <th style="padding:8px 10px;text-align:right">Total</th>
          <th style="padding:8px 10px;text-align:center;border-radius:0 4px 0 0">Estado</th>
        </tr>
      </thead>
      <tbody>
        ${pedido.lineas.map((l, i) => {
          const bg = i % 2 === 0 ? '#f8faff' : '#ffffff';
          const ct = (l.cantidadSolicitada || 0) * (l.costoUnitario || 0);
          return `<tr style="background:${bg}">
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#4361ee">${esc(l.item || '')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${esc(l.itemNombre || '')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280">${esc(l.grupoCompra || '')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${fmt(l.cantidadSolicitada)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${fmtMoney(l.costoUnitario)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${fmtMoney(ct)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${badgeHtml(l.estadoLinea || 'PENDIENTE')}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f0f4ff">
          <td colspan="5" style="padding:8px 10px;font-weight:700;text-align:right;border-top:2px solid #4361ee">TOTAL</td>
          <td style="padding:8px 10px;font-weight:700;text-align:right;border-top:2px solid #4361ee;color:#1a1f3a">${fmtMoney(total)}</td>
          <td style="border-top:2px solid #4361ee"></td>
        </tr>
      </tfoot>
    </table>` : '';

  const metaHtml = pedido ? `
    <table cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151;margin-bottom:4px">
      <tr>
        <td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap">Operación</td>
        <td style="padding:3px 0;font-weight:700">${esc(pedido.operacion)}</td>
      </tr>
      <tr>
        <td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap">Fecha pedido</td>
        <td style="padding:3px 0">${esc((pedido.fechaPedido || '').slice(0,10))}</td>
      </tr>
      <tr>
        <td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap">Solicitado por</td>
        <td style="padding:3px 0">${esc(pedido.solicitadoPorNombre || '')}</td>
      </tr>
      ${pedido.aprobadoPorNombre ? `<tr>
        <td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap">Aprobado por</td>
        <td style="padding:3px 0">${esc(pedido.aprobadoPorNombre)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap">N° líneas</td>
        <td style="padding:3px 0">${pedido.lineas?.length || 0}</td>
      </tr>
    </table>` : '';

  const ctaUrl = appUrl ? `${appUrl}${linkUrl}` : linkUrl;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">

        <!-- HEADER -->
        <tr>
          <td style="background:#1a1f3a;border-radius:10px 10px 0 0;padding:20px 28px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:1px">📦 Pedidos Adicionales</div>
            <div style="font-size:12px;color:#a5b4fc;margin-top:4px">Sistema de Gestión Operacional</div>
          </td>
        </tr>

        <!-- BANNER DE ESTADO -->
        <tr>
          <td style="background:${color.bg};padding:14px 28px;text-align:center">
            <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:.5px">${color.label}</div>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="background:#fff;padding:28px 28px 20px">
            <p style="margin:0 0 18px;font-size:15px;color:#111827;font-weight:600">${esc(titulo)}</p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6">${mensaje}</p>
            ${metaHtml}
            ${lineasHtml}
          </td>
        </tr>

        <!-- BOTÓN CTA -->
        <tr>
          <td style="background:#fff;padding:0 28px 28px;text-align:center">
            <a href="${esc(ctaUrl)}"
               style="display:inline-block;margin-top:8px;padding:12px 32px;background:${color.bg};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:.3px">
              ${esc(linkLabel)} →
            </a>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f8faff;border-top:1px solid #e5e7eb;border-radius:0 0 10px 10px;padding:16px 28px;text-align:center">
            <p style="margin:0;font-size:11px;color:#9ca3af">
              Este correo fue generado automáticamente por el Sistema de Pedidos Adicionales.<br>
              Por favor no responda directamente a este mensaje.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildEmailHtml };

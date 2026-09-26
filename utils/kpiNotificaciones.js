const User            = require('../models/User');
const Config          = require('../models/Config');
const KpiNotificacion = require('../models/KpiNotificacion');
const push  = require('./sendPush');   // como objetos: las pruebas los reemplazan
const email = require('./sendEmail');
const { buildEmailHtml } = require('./emailTemplate');
const { accesoSistema, resolverAcceso } = require('./kpiAcceso');
const { pendientesDeCaptura } = require('./kpiTablero');
const P = require('./kpiPeriodo');

// Notificaciones de Indicadores GAF — mismo modelo que Pedidos Adicionales: push (in-app /
// celular, utils/sendPush.js) + correo (utils/sendEmail.js, plantilla emailTemplate.js).
//   1. KPI en ROJO al registrar o corregir → aviso inmediato a los destinatarios de alertas.
//   2. Tarea diaria (scripts/kpiNotificaciones.js, paso de sync-master.bat):
//      - RECORDATORIO al responsable cuando faltan ≤ kpiDiasAviso días para el vencimiento.
//      - VENCIDO: resumen a los destinatarios de alertas de lo que venció sin dato.
//      Cada aviso se registra en KpiNotificacion y no se repite.
// Destinatarios de alertas: admins de Indicadores (rol ADMIN de la app o kpiRol admin)
// + los usuarios elegidos en Configuración (kpiAlertaUsuarios, ej. la GAF como lectora).

const APP_URL = process.env.APP_URL || '';
const URL_MODULO = '/#indicadores';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fecha = (ymd) => ymd.split('-').reverse().join('/');
const numero = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function config() {
  const docs = await Config.find({ key: { $in: ['kpiDiasAviso', 'kpiAlertaUsuarios'] } }).lean();
  const v = Object.fromEntries(docs.map(d => [d.key, d.value]));
  return {
    diasAviso: Number.isInteger(Number(v.kpiDiasAviso)) ? Number(v.kpiDiasAviso) : 3,
    alertaUsuarios: Array.isArray(v.kpiAlertaUsuarios) ? v.kpiAlertaUsuarios : [],
  };
}

async function destinatariosAlertas() {
  const { alertaUsuarios } = await config();
  const users = await User.find({
    activo: { $ne: false },
    $or: [{ role: 'ADMIN' }, { kpiRol: 'admin' }, { id: { $in: alertaUsuarios } }],
  }, { id: 1 }).lean();
  return users.map(u => u.id);
}

// Cada destinatario solo recibe lo de las áreas que puede ver en la app (un destinatario
// adicional con acceso parcial no debe enterarse por correo de otras áreas).
async function areasVisibles(userIds) {
  const mapa = new Map();
  for (const id of userIds) mapa.set(id, (await resolverAcceso(id))?.lectura || new Set());
  return mapa;
}

// Envía a una lista de usuarios por los dos canales. Nunca lanza: un aviso fallido no
// debe romper el registro de un KPI ni la tarea diaria.
async function enviar(userIds, { titulo, mensajeHtml, asunto, tipo, pushTitulo, pushTexto }) {
  if (!userIds.length) return;
  try {
    await push.sendPush({ userId: { $in: userIds } }, { title: pushTitulo, body: pushTexto, url: URL_MODULO });
    const body = buildEmailHtml({
      tipo, titulo, mensaje: mensajeHtml, pedido: null, linkUrl: URL_MODULO, linkLabel: 'Abrir Indicadores GAF',
      appUrl: APP_URL, sistema: 'Indicadores GAF', icono: '🎯',
    });
    for (const id of userIds) await email.sendEmail({ userId: id }, { subject: asunto, body });
  } catch (err) {
    console.error('[kpiNotificaciones] Error enviando:', err.message);
  }
}

async function yaEnviados(tipo, claves, destinatarioId) {
  const docs = await KpiNotificacion.find({ tipo, destinatarioId, clave: { $in: claves } }, { clave: 1 }).lean();
  return new Set(docs.map(d => d.clave));
}

async function marcarEnviados(tipo, claves, destinatarioId) {
  if (!claves.length) return;
  await KpiNotificacion.insertMany(claves.map(clave => ({ tipo, clave, destinatarioId })), { ordered: false })
    .catch(err => { if (err.code !== 11000 && !err.writeErrors) throw err; });
}

const clave = (it) => `${it.kpiId}|${it.unidad}|${it.periodo}`;

const tablaItems = (items, conAtraso) => `
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;margin-top:6px">
    <tr style="background:#1a1f3a;color:#fff">
      <th style="padding:6px 8px;text-align:left">KPI</th><th style="padding:6px 8px;text-align:left">Unidad</th>
      <th style="padding:6px 8px;text-align:left">Periodo</th><th style="padding:6px 8px;text-align:left">${conAtraso ? 'Venció' : 'Vence'}</th>
    </tr>
    ${items.map((i, n) => `<tr style="background:${n % 2 ? '#fff' : '#f8faff'}">
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb"><strong>${esc(i.codigo)}</strong> ${esc(i.nombre)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(i.unidad)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(i.etiqueta)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${fecha(i.vence)}${conAtraso ? ` (${i.diasAtraso} d)` : ''}</td>
    </tr>`).join('')}
  </table>`;

// 1. Aviso inmediato de un registro en rojo (al guardar o al corregir).
async function avisarRojo(registro, kpiNombre, { correccion = false, usuario = '' } = {}) {
  const todos = await destinatariosAlertas();
  const visibles = await areasVisibles(todos);
  const ids = todos.filter(id => visibles.get(id).has(registro.areaCodigo));
  const k = `${registro.kpiId}|${registro.unidadCodigo}|${registro.periodo}`;
  // Una corrección que vuelve a dejarlo en rojo se avisa siempre; el registro original, una vez.
  const pendientes = [];
  for (const id of ids) if (correccion || !(await yaEnviados('ROJO', [k], id)).has(k)) pendientes.push(id);
  const periodo = P.etiqueta(registro.periodo);
  const meta = registro.meta?.meta != null ? ` (meta ${numero(registro.meta.meta)})`
    : registro.meta?.rangoMin != null ? ` (rango ${numero(registro.meta.rangoMin)} a ${numero(registro.meta.rangoMax)})` : '';
  await enviar(pendientes, {
    tipo: 'kpiRojo',
    asunto: `🔴 ${registro.kpiCodigo} en rojo — ${registro.unidadCodigo} ${periodo}`,
    titulo: `${registro.kpiCodigo} ${kpiNombre} quedó en rojo`,
    mensajeHtml: `<strong>${esc(registro.unidadCodigo)}</strong> · ${esc(periodo)}: valor <strong>${numero(registro.valor)}</strong>${esc(meta)}.<br>
      ${correccion ? `Resultado tras una corrección de ${esc(usuario)}.` : `Registrado por ${esc(registro.registradoPorNombre)}.`}<br>
      ${registro.comentario ? `Comentario: “${esc(registro.comentario)}”` : ''}`,
    pushTitulo: `🔴 ${registro.kpiCodigo} en rojo`,
    pushTexto: `${registro.unidadCodigo} · ${periodo}: ${numero(registro.valor)}`,
  });
  for (const id of pendientes) await marcarEnviados('ROJO', [k], id);
  return pendientes.length;
}

// 2. Tarea diaria: recordatorios a responsables y resumen de vencidos a los de alertas.
async function ejecutarDiario({ hoy = P.hoyLima() } = {}) {
  const { diasAviso } = await config();
  const acc = await accesoSistema();
  const { grupos } = await pendientesDeCaptura(acc, { hoy, incluirPorVencer: true });
  const resumen = { hoy, recordatorios: 0, vencidos: 0, correos: 0 };

  // Recordatorios: cada responsable recibe solo lo suyo que vence dentro de diasAviso días.
  const limite = P.sumarDias(hoy, diasAviso);
  for (const g of grupos.filter(g => g.responsableId)) {
    const items = g.items.filter(i => !i.vencido && i.vence <= limite);
    const enviados = await yaEnviados('RECORDATORIO', items.map(clave), g.responsableId);
    const nuevos = items.filter(i => !enviados.has(clave(i)));
    if (!nuevos.length) continue;
    await enviar([g.responsableId], {
      tipo: 'kpiRecordatorio',
      asunto: `⏰ Indicadores GAF: ${nuevos.length} captura${nuevos.length === 1 ? '' : 's'} por vencer`,
      titulo: `Tienes ${nuevos.length} captura${nuevos.length === 1 ? '' : 's'} por vencer`,
      mensajeHtml: `Registra estos valores antes de su fecha de vencimiento:${tablaItems(nuevos, false)}`,
      pushTitulo: '⏰ Capturas por vencer',
      pushTexto: `${nuevos.length} KPI${nuevos.length === 1 ? '' : 's'} vence${nuevos.length === 1 ? '' : 'n'} pronto`,
    });
    await marcarEnviados('RECORDATORIO', nuevos.map(clave), g.responsableId);
    resumen.recordatorios += nuevos.length; resumen.correos++;
  }

  // Vencidos sin dato: un resumen por destinatario con lo que no se le había avisado.
  const vencidos = [...new Map(grupos.flatMap(g => g.items).filter(i => i.vencido).map(i => [clave(i), i])).values()];
  const destinatarios = await destinatariosAlertas();
  const visibles = await areasVisibles(destinatarios);
  for (const id of destinatarios) {
    const suyos = vencidos.filter(i => visibles.get(id).has(i.areaCodigo));
    const enviados = await yaEnviados('VENCIDO', suyos.map(clave), id);
    const nuevos = suyos.filter(i => !enviados.has(clave(i)));
    if (!nuevos.length) continue;
    await enviar([id], {
      tipo: 'kpiVencido',
      asunto: `⚪ Indicadores GAF: ${nuevos.length} captura${nuevos.length === 1 ? '' : 's'} vencida${nuevos.length === 1 ? '' : 's'} sin dato`,
      titulo: `${nuevos.length} KPI${nuevos.length === 1 ? '' : 's'} siguen sin dato después del plazo`,
      mensajeHtml: `Capturas vencidas sin registro:${tablaItems(nuevos, true)}`,
      pushTitulo: '⚪ Capturas vencidas sin dato',
      pushTexto: `${nuevos.length} KPI${nuevos.length === 1 ? '' : 's'} sin dato`,
    });
    await marcarEnviados('VENCIDO', nuevos.map(clave), id);
    resumen.vencidos += nuevos.length; resumen.correos++;
  }
  return resumen;
}

module.exports = { avisarRojo, ejecutarDiario, destinatariosAlertas };

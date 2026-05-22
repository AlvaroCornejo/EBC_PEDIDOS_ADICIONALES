const express  = require('express');
const ExcelJS  = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const Pedido = require('../models/Pedido');
const Config = require('../models/Config');
const { sendPush }       = require('../utils/sendPush');
const { sendEmail }      = require('../utils/sendEmail');
const { buildEmailHtml } = require('../utils/emailTemplate');
const APP_URL = process.env.APP_URL || '';

const router = express.Router();
router.use(authMiddleware);

// ─── Helper: leer config ──────────────────────────────────────────
async function getConfig() {
  const docs = await Config.find({}).lean();
  const cfg = { maxVariacion: 10 };
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

// ─── Helper: auto-aprobación por línea ───────────────────────────
function aplicarAutoAprobacion(lineas, maxVariacion) {
  const factor = (maxVariacion || 10) / 100;
  for (const linea of lineas) {
    if (linea.estadoLinea === 'APROBADO' || linea.estadoLinea === 'RECHAZADO') continue;
    const varA = (linea.semanaAnterior || {}).variacion || 0;
    if (varA <= 0) continue;
    const lote = linea.loteCompra || 0;
    const sugerido = lote > 0 ? Math.ceil(varA / lote) * lote : varA;
    const limite = sugerido * (1 + factor);
    const cant = linea.cantidadSolicitada || 0;
    if (cant > 0 && cant <= limite) {
      linea.estadoLinea = 'APROBADO';
      linea.autoAprobado = true;
      linea.comentarioAprobador = `Auto-aprobado (cant. ${cant} ≤ límite ${limite.toFixed(2)})`;
    }
  }
}

// ─── Helper: estado del pedido según líneas ───────────────────────
function calcEstadoPedido(lineas) {
  const estados = lineas.map(l => l.estadoLinea || 'PENDIENTE');
  if (estados.some(e => e === 'REVISAR'))    return 'REVISAR';
  if (estados.every(e => e === 'RECHAZADO')) return 'RECHAZADO';
  return 'APROBADO';
}

// GET /api/pedidos?vista=aprobar|atender|admin
router.get('/', async (req, res) => {
  try {
    const { role, id: userId, operations } = req.user;
    const { vista } = req.query;

    let query = {};
    if (role === 'OPERADOR_SOLICITUD') {
      query.solicitadoPorId = userId;
    } else if (role === 'OPERADOR_APROBACION') {
      query.operacion = { $in: operations };
    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      query.operacion = { $in: operations };
      query.estado = { $in: ['APROBADO', 'ATENDIDO'] };
    }
    // ADMIN: sin filtro

    if (vista === 'aprobar') query.estado = { $in: ['SOLICITADO', 'REVISAR'] };
    if (vista === 'atender') query.estado = { $in: ['APROBADO', 'ATENDIDO'] };

    const pedidos = await Pedido.find(query).lean();
    pedidos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(pedidos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pedidos
router.post('/', async (req, res) => {
  try {
    const { role } = req.user;
    if (!['ADMIN', 'OPERADOR_SOLICITUD'].includes(role)) return res.status(403).json({ error: 'No autorizado' });
    const { operacion, fechaPedido, lineas } = req.body;
    if (!operacion || !fechaPedido || !lineas?.length) return res.status(400).json({ error: 'Datos incompletos' });

    const cfg = await getConfig();
    const lineasMapped = lineas.map(l => ({
      ...l,
      id:                  l.id || uuidv4(),
      estadoLinea:         'PENDIENTE',
      autoAprobado:        false,
      comentarioAprobador: '',
      estadoAtencion:      'PENDIENTE',
      loteCompra:          l.loteCompra || 0
    }));

    // Aplicar auto-aprobación (#6)
    aplicarAutoAprobacion(lineasMapped, cfg.maxVariacion);

    const todosAprobados = lineasMapped.every(l => l.estadoLinea === 'APROBADO');

    const pedido = new Pedido({
      id: uuidv4(),
      operacion,
      fechaPedido,
      estado:               todosAprobados ? 'APROBADO' : 'SOLICITADO',
      solicitadoPorId:      req.user.id,
      solicitadoPorNombre:  req.user.username,
      aprobadoPorId:        todosAprobados ? req.user.id : null,
      aprobadoPorNombre:    todosAprobados ? 'Auto-aprobado' : null,
      atendidoPorId:        null,
      atendidoPorNombre:    null,
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),
      lineas:               lineasMapped
    });

    await pedido.save();
    res.json(pedido.toObject());

    // Notificar aprobadores si el pedido no fue auto-aprobado totalmente
    if (pedido.estado === 'SOLICITADO') {
      const pushBody = `${operacion} — ${req.user.username} (${lineasMapped.length} línea${lineasMapped.length !== 1 ? 's' : ''})`;
      sendPush(
        { role: 'OPERADOR_APROBACION', operations: operacion },
        { title: '📝 Nueva solicitud pendiente', body: pushBody, url: '/#aprobar' }
      );
      sendPush(
        { role: 'ADMIN' },
        { title: '📝 Nueva solicitud pendiente', body: `${operacion} — ${req.user.username}`, url: '/#aprobar' }
      );
      const emailNueva = buildEmailHtml({
        tipo: 'nueva', appUrl: APP_URL,
        titulo: `Nueva solicitud de ${req.user.username}`,
        mensaje: `Se ha generado una nueva solicitud de pedido adicional para la operación <strong>${operacion}</strong> con ${lineasMapped.length} línea${lineasMapped.length !== 1 ? 's' : ''}. Por favor revisa y aprueba a la brevedad.`,
        pedido: pedido.toObject(),
        linkUrl: '/#aprobar', linkLabel: 'Ver solicitudes pendientes'
      });
      sendEmail(
        { role: 'OPERADOR_APROBACION', operations: operacion },
        { subject: `📝 Nueva solicitud pendiente — ${operacion}`, body: emailNueva }
      );
      sendEmail(
        { role: 'ADMIN' },
        { subject: `📝 Nueva solicitud pendiente — ${operacion}`, body: emailNueva }
      );
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pedidos/:id
router.put('/:id', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ id: req.params.id });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { role } = req.user;
    const { lineas, resubmit } = req.body;

    if (role === 'OPERADOR_SOLICITUD' || (role === 'ADMIN' && req.body.accion === 'editar')) {
      if (!['SOLICITADO', 'REVISAR'].includes(pedido.estado)) {
        return res.status(403).json({ error: 'No se puede editar en este estado' });
      }
      if (lineas) {
        if (pedido.estado === 'REVISAR') {
          // Preservar líneas bloqueadas (APROBADO/RECHAZADO)
          const lockedIds = new Set(
            pedido.lineas.filter(l => ['APROBADO', 'RECHAZADO'].includes(l.estadoLinea)).map(l => l.id)
          );
          const updatedMap = Object.fromEntries(lineas.map(l => [l.id, l]));
          pedido.lineas = pedido.lineas.map(existing => {
            if (lockedIds.has(existing.id)) return existing;
            const upd = updatedMap[existing.id];
            if (!upd) return existing;
            return {
              ...existing.toObject(), ...upd,
              id:                  existing.id,
              estadoLinea:         existing.estadoLinea,
              autoAprobado:        existing.autoAprobado,
              comentarioAprobador: existing.comentarioAprobador,
              costoUnitario:       existing.costoUnitario  // Preservar costo original (#10)
            };
          });
          // Agregar nuevas líneas
          const existingIds = new Set(pedido.lineas.map(l => l.id));
          lineas.filter(l => !existingIds.has(l.id)).forEach(l => {
            pedido.lineas.push({ ...l, id: l.id || uuidv4(), estadoLinea: 'PENDIENTE', autoAprobado: false, comentarioAprobador: '', estadoAtencion: 'PENDIENTE', loteCompra: l.loteCompra || 0 });
          });
        } else {
          // Estado SOLICITADO: reemplazar lineas preservando costo original (#10)
          const existingMap = Object.fromEntries(pedido.lineas.map(l => [l.id, l]));
          pedido.lineas = lineas.map(l => ({
            ...l,
            id:                  l.id || uuidv4(),
            estadoLinea:         l.estadoLinea || 'PENDIENTE',
            autoAprobado:        l.autoAprobado || false,
            comentarioAprobador: l.comentarioAprobador || '',
            estadoAtencion:      l.estadoAtencion || 'PENDIENTE',
            loteCompra:          l.loteCompra || 0,
            costoUnitario:       existingMap[l.id]?.costoUnitario ?? l.costoUnitario  // #10
          }));
        }
      }
      if (resubmit && pedido.estado === 'REVISAR') {
        const cfg = await getConfig();
        // Re-aplicar auto-aprobación a líneas PENDIENTE/REVISAR
        const lineasParaAprobar = pedido.lineas.filter(l => !['APROBADO', 'RECHAZADO'].includes(l.estadoLinea));
        aplicarAutoAprobacion(lineasParaAprobar, cfg.maxVariacion);
        pedido.estado = 'SOLICITADO';
        const todosAprobados = pedido.lineas.every(l => l.estadoLinea === 'APROBADO');
        if (todosAprobados) {
          pedido.estado = 'APROBADO';
          pedido.aprobadoPorId = req.user.id;
          pedido.aprobadoPorNombre = 'Auto-aprobado';
        }
      }

    } else if (role === 'OPERADOR_APROBACION' || role === 'ADMIN') {
      if (!lineas?.length) return res.status(400).json({ error: 'Se requieren las líneas con estados' });
      const invalid = lineas.some(l => !['APROBADO', 'RECHAZADO', 'REVISAR'].includes(l.estadoLinea));
      if (invalid) return res.status(400).json({ error: 'Todas las líneas deben tener un estado asignado' });

      pedido.lineas = pedido.lineas.map(existing => {
        // Líneas auto-aprobadas: el aprobador no puede cambiarlas (#6)
        if (existing.autoAprobado) return existing;
        const upd = lineas.find(l => l.id === existing.id);
        return upd
          ? { ...existing.toObject(), estadoLinea: upd.estadoLinea, comentarioAprobador: upd.comentarioAprobador || '' }
          : existing;
      });

      pedido.estado = calcEstadoPedido(pedido.lineas);
      pedido.aprobadoPorId = req.user.id;
      pedido.aprobadoPorNombre = req.user.username;

    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      if (pedido.estado !== 'APROBADO') return res.status(403).json({ error: 'Solo se atienden pedidos aprobados' });
      if (!lineas?.length) return res.status(400).json({ error: 'Se requieren las líneas con estado de atención' });

      const gestionRol = role === 'OPERADOR_PLANTA' ? 'PLANTA' : 'COMPRAS';
      const lineaMap = Object.fromEntries(lineas.map(l => [l.id, l]));
      pedido.lineas = pedido.lineas.map(existing => {
        if ((existing.gestion || 'COMPRAS') !== gestionRol) return existing;
        const upd = lineaMap[existing.id];
        if (!upd) return existing;
        // No se puede des-atender (#7)
        const nuevoEstado = existing.estadoAtencion === 'ATENDIDO'
          ? 'ATENDIDO'
          : (upd.estadoAtencion || existing.estadoAtencion || 'PENDIENTE');
        return { ...existing.toObject(), estadoAtencion: nuevoEstado };
      });

      const lineasAprobadas = pedido.lineas.filter(l => l.estadoLinea === 'APROBADO');
      const todasAtendidas = lineasAprobadas.length > 0 && lineasAprobadas.every(l => l.estadoAtencion === 'ATENDIDO');
      pedido.estado = todasAtendidas ? 'ATENDIDO' : 'APROBADO';
      pedido.atendidoPorId = req.user.id;
      pedido.atendidoPorNombre = req.user.username;

    } else {
      return res.status(403).json({ error: 'No autorizado' });
    }

    pedido.updatedAt = new Date().toISOString();
    pedido.markModified('lineas');
    await pedido.save();
    res.json(pedido.toObject());

    // ── Push notifications post-guardado ──────────────────────────
    const op    = pedido.operacion;
    const solId = pedido.solicitadoPorId;
    const lineasAprobadas = pedido.lineas.filter(l => l.estadoLinea === 'APROBADO');
    const tieneCompras = lineasAprobadas.some(l => (l.gestion || 'COMPRAS') === 'COMPRAS');
    const tienePlanta  = lineasAprobadas.some(l => l.gestion === 'PLANTA');

    // 1. Solicitante crea pedido → notificar aprobadores (en POST, ver abajo)
    // 2. Aprobador actúa → notificar solicitante + compras/planta según gestión
    if (role === 'OPERADOR_APROBACION' || (role === 'ADMIN' && req.body.lineas?.[0]?.estadoLinea)) {
      const nuevoEstado = pedido.estado;
      const pedidoObj   = pedido.toObject();

      if (nuevoEstado === 'APROBADO') {
        // Al solicitante
        sendPush({ userId: solId },
          { title: '✅ Pedido aprobado', body: `Tu solicitud de ${op} fue aprobada`, url: '/#mis-pedidos' });
        sendEmail({ userId: solId }, {
          subject: `✅ Pedido aprobado — ${op}`,
          body: buildEmailHtml({
            tipo: 'aprobado', appUrl: APP_URL,
            titulo: `Tu solicitud de ${op} fue aprobada`,
            mensaje: `Nos complace informarte que tu pedido adicional para la operación <strong>${op}</strong> ha sido <strong>aprobado</strong>. A continuación el detalle de las líneas aprobadas.`,
            pedido: pedidoObj, linkUrl: '/#mis-pedidos', linkLabel: 'Ver mis pedidos'
          })
        });
        // A compras
        if (tieneCompras) {
          sendPush({ role: 'OPERADOR_ATENCION', operations: op },
            { title: '🛒 Pedido listo para atender', body: `${op} — tiene ítems de Compras`, url: '/#atender' });
          sendEmail({ role: 'OPERADOR_ATENCION', operations: op }, {
            subject: `🛒 Pedido listo para atender — ${op}`,
            body: buildEmailHtml({
              tipo: 'atender', appUrl: APP_URL,
              titulo: `Pedido de ${op} aprobado — requiere atención de Compras`,
              mensaje: `Se ha aprobado un pedido adicional de la operación <strong>${op}</strong> que contiene ítems gestionados por <strong>Compras</strong>. Por favor procede a atenderlos.`,
              pedido: pedidoObj, linkUrl: '/#atender', linkLabel: 'Ver pedidos a atender'
            })
          });
        }
        // A planta
        if (tienePlanta) {
          sendPush({ role: 'OPERADOR_PLANTA', operations: op },
            { title: '🏭 Pedido listo para atender', body: `${op} — tiene ítems de Planta`, url: '/#atender' });
          sendEmail({ role: 'OPERADOR_PLANTA', operations: op }, {
            subject: `🏭 Pedido listo para atender — ${op}`,
            body: buildEmailHtml({
              tipo: 'planta', appUrl: APP_URL,
              titulo: `Pedido de ${op} aprobado — requiere atención de Planta`,
              mensaje: `Se ha aprobado un pedido adicional de la operación <strong>${op}</strong> que contiene ítems gestionados por <strong>Planta</strong>. Por favor procede a atenderlos.`,
              pedido: pedidoObj, linkUrl: '/#atender', linkLabel: 'Ver pedidos a atender'
            })
          });
        }

      } else if (nuevoEstado === 'RECHAZADO') {
        sendPush({ userId: solId },
          { title: '❌ Pedido rechazado', body: `Tu solicitud de ${op} fue rechazada`, url: '/#mis-pedidos' });
        sendEmail({ userId: solId }, {
          subject: `❌ Pedido rechazado — ${op}`,
          body: buildEmailHtml({
            tipo: 'rechazado', appUrl: APP_URL,
            titulo: `Tu solicitud de ${op} fue rechazada`,
            mensaje: `Lamentablemente tu pedido adicional para la operación <strong>${op}</strong> ha sido <strong>rechazado</strong>. Revisa los comentarios del aprobador para más detalle.`,
            pedido: pedidoObj, linkUrl: '/#mis-pedidos', linkLabel: 'Ver mis pedidos'
          })
        });

      } else if (nuevoEstado === 'REVISAR') {
        sendPush({ userId: solId },
          { title: '🔄 Pedido a revisar', body: `Tu solicitud de ${op} necesita ajustes`, url: '/#solicitar' });
        sendEmail({ userId: solId }, {
          subject: `🔄 Pedido a revisar — ${op}`,
          body: buildEmailHtml({
            tipo: 'revisar', appUrl: APP_URL,
            titulo: `Tu solicitud de ${op} necesita ajustes`,
            mensaje: `Tu pedido adicional para la operación <strong>${op}</strong> ha sido enviado a <strong>revisión</strong>. Por favor revisa los comentarios del aprobador, realiza los ajustes necesarios y re-envía.`,
            pedido: pedidoObj, linkUrl: '/#solicitar', linkLabel: 'Ir a mis solicitudes'
          })
        });
      }

    // 3. Compras/Planta atiende → notificar al solicitante
    } else if (role === 'OPERADOR_ATENCION' || role === 'OPERADOR_PLANTA') {
      if (pedido.estado === 'ATENDIDO') {
        const pedidoObj = pedido.toObject();
        sendPush({ userId: solId },
          { title: '📦 Pedido atendido', body: `Tu solicitud de ${op} fue atendida`, url: '/#mis-pedidos' });
        sendEmail({ userId: solId }, {
          subject: `📦 Pedido atendido — ${op}`,
          body: buildEmailHtml({
            tipo: 'atendido', appUrl: APP_URL,
            titulo: `Tu solicitud de ${op} fue atendida`,
            mensaje: `Tu pedido adicional para la operación <strong>${op}</strong> ha sido completamente <strong>atendido</strong>. A continuación el resumen final.`,
            pedido: pedidoObj, linkUrl: '/#mis-pedidos', linkLabel: 'Ver mis pedidos'
          })
        });
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pedidos/export — descarga Excel con pedidos seleccionados
router.post('/export', async (req, res) => {
  try {
    const { role, id: userId, operations } = req.user;
    const { ids, gestion } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'Se requieren IDs de pedidos' });

    // Cargar pedidos autorizados
    let query = { id: { $in: ids } };
    if (role === 'OPERADOR_SOLICITUD') query.solicitadoPorId = userId;
    else if (['OPERADOR_APROBACION', 'OPERADOR_ATENCION', 'OPERADOR_PLANTA'].includes(role)) {
      query.operacion = { $in: operations };
    }
    let pedidos = await Pedido.find(query).lean();

    // Filtrar líneas por gestión si se especifica
    if (gestion) {
      pedidos = pedidos.map(p => ({
        ...p,
        lineas: (p.lineas || []).filter(l => (l.gestion || 'COMPRAS') === gestion)
      })).filter(p => p.lineas.length > 0);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Pedidos Adicionales';
    wb.created = new Date();

    const ws = wb.addWorksheet('Pedidos', { views: [{ state: 'frozen', ySplit: 2 }] });

    // ── Estilo helpers ──
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4361EE' } };
    const subFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E0FF' } };
    const boldWhite  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const boldBlue   = { bold: true, color: { argb: 'FF1E3A8A' }, size: 10 };
    const thin = { style: 'thin', color: { argb: 'FFB0B8D0' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    // ── Columnas ──
    ws.columns = [
      { key: 'pedidoId',     width: 14 },
      { key: 'operacion',    width: 10 },
      { key: 'fecha',        width: 12 },
      { key: 'estado',       width: 12 },
      { key: 'solicitado',   width: 20 },
      { key: 'aprobado',     width: 20 },
      // Semana Anterior (5 cols)
      { key: 'ceA',  width: 11 },
      { key: 'rvA',  width: 11 },
      { key: 'rcA',  width: 11 },
      { key: 'varA', width: 11 },
      { key: 'ajA',  width: 11 },
      // Semana Actual (5 cols)
      { key: 'ceC',  width: 11 },
      { key: 'rvC',  width: 11 },
      { key: 'rcC',  width: 11 },
      { key: 'varC', width: 11 },
      { key: 'ajC',  width: 11 },
      // Item
      { key: 'item',         width: 14 },
      { key: 'itemNombre',   width: 30 },
      { key: 'grupo',        width: 14 },
      { key: 'gestion',      width: 10 },
      { key: 'saldo',        width: 11 },
      { key: 'costoU',       width: 12 },
      { key: 'cantidad',     width: 11 },
      { key: 'despacho',     width: 13 },
      { key: 'oportunidad',  width: 13 },
      { key: 'costoTotal',   width: 13 },
      { key: 'comentarios',  width: 30 },
      { key: 'estadoLinea',  width: 12 },
      { key: 'comentApr',    width: 30 },
    ];

    // ── Fila 1: grupos de cabecera ──
    const r1 = ws.getRow(1);
    const baseHeaders = [
      { label: 'Pedido',          span: 5 },
      { label: 'Semana Anterior', span: 5 },
      { label: 'Semana Actual',   span: 5 },
      { label: 'Ítem',            span: 4 },
      { label: 'Cantidades',      span: 5 },
      { label: 'Detalle',         span: 4 },
    ];
    let col = 1;
    for (const h of baseHeaders) {
      const cell = r1.getCell(col);
      cell.value = h.label;
      cell.fill  = headerFill;
      cell.font  = boldWhite;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = border;
      if (h.span > 1) ws.mergeCells(1, col, 1, col + h.span - 1);
      col += h.span;
    }
    r1.height = 22;

    // ── Fila 2: sub-cabeceras ──
    const subHeaders = [
      'ID Pedido','Operación','Fecha','Estado','Solicitado por',
      'Cons. Est.','Real Venta','Real Consumo','Variación','Ajuste',
      'Cons. Est.','Real Venta','Real Consumo','Variación','Ajuste',
      'Item','Nombre','Grupo','Gestión',
      'Saldo','Costo U.','Cantidad','Despacho Exceso','Compra Oport.','Costo Total',
      'Comentarios','Estado Línea','Coment. Aprobador'
    ];
    const r2 = ws.getRow(2);
    subHeaders.forEach((h, i) => {
      const cell = r2.getCell(i + 1);
      cell.value = h;
      cell.fill  = subFill;
      cell.font  = boldBlue;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
    });
    r2.height = 30;

    // ── Filas de datos ──
    const numFmt = '#,##0.00';
    let rowIdx = 3;
    for (const p of pedidos) {
      const startRow = rowIdx;
      const lineas = p.lineas || [];
      for (const l of lineas) {
        const sa = l.semanaAnterior || {};
        const sc = l.semanaActual   || {};
        const row = ws.getRow(rowIdx);
        const vals = [
          p.id, p.operacion, p.fechaPedido ? p.fechaPedido.slice(0,10) : '', p.estado,
          p.solicitadoPorNombre || '',
          // sem anterior
          sa.consumoEstimado  || 0, sa.consumoRealVenta || 0, sa.consumoReal || 0, sa.variacion || 0, sa.ajuste || 0,
          // sem actual
          sc.consumoEstimado  || 0, sc.consumoRealVenta || 0, sc.consumoReal || 0, sc.variacion || 0, sc.ajuste || 0,
          // item
          l.item || '', l.itemNombre || '', l.grupoCompra || '', l.gestion || 'COMPRAS',
          // cantidades
          l.saldo || 0, l.costoUnitario || 0, l.cantidadSolicitada || 0,
          l.despachoEnExceso ? 'Sí' : '', l.compraOportunidad ? 'Sí' : '',
          (l.cantidadSolicitada || 0) * (l.costoUnitario || 0),
          // detalle
          l.comentarios || '', l.estadoLinea || '', l.comentarioAprobador || ''
        ];
        vals.forEach((v, i) => {
          const cell = row.getCell(i + 1);
          cell.value = v;
          cell.border = border;
          cell.font   = { size: 10 };
          // Aplicar formato numérico a columnas de cantidades/costo (cols 6-15 + 21-26)
          const numCols = new Set([6,7,8,9,10,11,12,13,14,15,21,22,23,26]);
          if (numCols.has(i + 1) && typeof v === 'number') cell.numFmt = numFmt;
        });
        row.height = 16;
        rowIdx++;
      }
      // Merge celdas del pedido (cols 1-5) si hay > 1 línea
      if (lineas.length > 1) {
        for (let c = 1; c <= 5; c++) {
          ws.mergeCells(startRow, c, rowIdx - 1, c);
          ws.getCell(startRow, c).alignment = { vertical: 'top', wrapText: true };
        }
      }
    }

    // Responder con el archivo
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="pedidos-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/pedidos/:id  — solo ADMIN
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const pedido = await Pedido.findOneAndDelete({ id: req.params.id });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

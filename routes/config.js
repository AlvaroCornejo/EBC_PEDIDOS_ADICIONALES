const express    = require('express');
const nodemailer = require('nodemailer');
const authMiddleware = require('../middleware/auth');
const Config = require('../models/Config');
const User   = require('../models/User');
const { getSmtpConfig, buildTransport, resolveEmails } = require('../utils/sendEmail');
const { buildEmailHtml } = require('../utils/emailTemplate');
const APP_URL = process.env.APP_URL || '';
const router = express.Router();
router.use(authMiddleware);

const DEFAULTS = { maxVariacion: 10 };

async function getConfigObj() {
  const docs = await Config.find({}).lean();
  const cfg = { ...DEFAULTS };
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

// GET /api/config
router.get('/', async (req, res) => {
  try { res.json(await getConfigObj()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/config  (ADMIN only)
router.put('/', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    for (const [key, value] of Object.entries(req.body)) {
      await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
    }
    res.json(await getConfigObj());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/config/smtp-test  — prueba conexión SMTP (con credenciales del form)
router.post('/smtp-test', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpAuthMethod } = req.body;
    if (!smtpHost || !smtpUser || !smtpPass) return res.status(400).json({ error: 'Faltan credenciales SMTP' });
    const transporter = buildTransport({ smtpHost, smtpPort, smtpUser, smtpPass, smtpAuthMethod });
    await transporter.verify();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/config/smtp-diagnose  — diagnóstico completo + envío de prueba real
router.post('/smtp-diagnose', async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
  const { emailDestino } = req.body;
  const pasos = [];
  const ok  = (msg, detail) => pasos.push({ estado: 'ok',    msg, detail: detail ?? null });
  const err = (msg, detail) => pasos.push({ estado: 'error', msg, detail: detail ?? null });
  const warn = (msg, detail) => pasos.push({ estado: 'warn', msg, detail: detail ?? null });

  try {
    // 1. Leer config de la BD
    const cfg = await getSmtpConfig();
    ok('Config leída de BD', {
      smtpEnabled:    cfg.smtpEnabled,
      smtpHost:       cfg.smtpHost       || '(vacío)',
      smtpPort:       cfg.smtpPort       || '(vacío)',
      smtpUser:       cfg.smtpUser       || '(vacío)',
      smtpPass:       cfg.smtpPass       ? '●●●●●●' : '(vacío)',
      smtpFrom:       cfg.smtpFrom       || '(vacío)',
      smtpAuthMethod: cfg.smtpAuthMethod || 'LOGIN (default)',
    });

    // 2. Verificar habilitado
    const enabled = cfg.smtpEnabled === true || cfg.smtpEnabled === 'true';
    if (!enabled) warn('smtpEnabled = false — el envío automático está desactivado', 'Actívalo en Admin → Configuración → SMTP');
    else ok('smtpEnabled = true');

    // 3. Verificar credenciales
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
      err('Credenciales incompletas', 'Falta host, usuario o contraseña');
    } else {
      ok('Credenciales presentes');

      // 4. Probar conexión
      try {
        const transporter = buildTransport(cfg);
        await transporter.verify();
        ok('Conexión SMTP exitosa', `${cfg.smtpHost}:${cfg.smtpPort || 587}`);

        // 5. Enviar correo de prueba si se proporcionó destino
        if (emailDestino) {
          try {
            const info = await transporter.sendMail({
              from:    cfg.smtpFrom || cfg.smtpUser,
              to:      emailDestino,
              subject: '🧪 Prueba de correo — Pedidos Adicionales',
              html:    buildEmailHtml({
                tipo: 'nueva', appUrl: APP_URL,
                titulo: 'Correo de prueba',
                mensaje: `Este es un correo de prueba enviado desde el sistema <strong>Pedidos Adicionales</strong>.<br><br>Si recibes este mensaje, la configuración SMTP está funcionando correctamente.<br><br><span style="color:#6b7280;font-size:12px">Enviado: ${new Date().toLocaleString('es-CL')}</span>`,
                pedido: null, linkUrl: '/', linkLabel: 'Ir al sistema'
              })
            });
            ok(`Correo de prueba enviado a ${emailDestino}`, `messageId: ${info.messageId}`);
          } catch (e) {
            err(`Error al enviar correo de prueba a ${emailDestino}`, e.message);
          }
        } else {
          warn('No se especificó email de destino — sin envío de prueba');
        }
      } catch (e) {
        err('Error de conexión SMTP', e.message);
      }
    }

    // 6. Usuarios sin email
    const allUsers = await User.find({}).lean();
    const sinEmail = allUsers.filter(u => !u.email).map(u => `${u.username} (${u.role})`);
    const conEmail = allUsers.filter(u => u.email).map(u => `${u.username} → ${u.email}`);
    if (sinEmail.length) warn(`${sinEmail.length} usuario(s) sin correo configurado`, sinEmail.join(', '));
    else ok('Todos los usuarios tienen correo');
    ok(`Usuarios con correo (${conEmail.length})`, conEmail.join(' | ') || '—');

    res.json({ pasos });
  } catch (e) {
    err('Error inesperado', e.message);
    res.json({ pasos });
  }
});

module.exports = { router, getConfigObj };

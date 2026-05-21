/**
 * sendEmail.js — envía correos usando configuración SMTP almacenada en Config (Outlook/SMTP).
 *
 * Uso:
 *   const { sendEmail } = require('./sendEmail');
 *   await sendEmail(
 *     { role: 'OPERADOR_APROBACION', operations: 'AASI' },   // mismo filtro que sendPush
 *     { subject: '...', body: '...' }
 *   );
 *
 * filter puede tener:
 *   { role, operations }   → todos los usuarios con ese role cuyas operaciones intersecan
 *   { userId }             → un usuario específico
 *   { role: 'ADMIN' }      → todos los admins
 */

const nodemailer = require('nodemailer');
const User       = require('../models/User');
const Config     = require('../models/Config');

/** Lee la config SMTP desde MongoDB */
async function getSmtpConfig() {
  const docs = await Config.find({ key: { $in: ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom', 'smtpEnabled'] } }).lean();
  const cfg = {};
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

/** Resuelve emails de destinatarios con el mismo esquema de filtro que sendPush */
async function resolveEmails(filter) {
  const query = {};

  if (filter.userId) {
    query.id = filter.userId;
  } else if (filter.role) {
    query.role = filter.role;
    if (filter.role !== 'ADMIN' && filter.operations) {
      const ops = Array.isArray(filter.operations) ? filter.operations : [filter.operations];
      query.operations = { $in: ops };
    }
  }

  const users = await User.find(query).lean();
  return users.map(u => u.email).filter(Boolean);
}

/**
 * Envía un correo a todos los destinatarios que coinciden con el filtro.
 * Es fire-and-forget: no lanza excepciones al caller.
 *
 * @param {object} filter  - { role?, operations?, userId? }
 * @param {object} payload - { subject, body }
 */
async function sendEmail(filter, payload) {
  try {
    const cfg = await getSmtpConfig();

    // Si no está habilitado, salir silenciosamente
    if (!cfg.smtpEnabled || cfg.smtpEnabled === 'false' || !cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) return;

    const emails = await resolveEmails(filter);
    if (!emails.length) return;

    const transporter = nodemailer.createTransport({
      host:   cfg.smtpHost,
      port:   parseInt(cfg.smtpPort, 10) || 587,
      secure: (parseInt(cfg.smtpPort, 10) || 587) === 465,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass
      },
      tls: { rejectUnauthorized: false }  // Outlook a veces tiene cert issues
    });

    await transporter.sendMail({
      from:    cfg.smtpFrom || cfg.smtpUser,
      to:      emails.join(', '),
      subject: payload.subject || 'Pedidos Adicionales',
      html:    payload.body    || payload.subject || ''
    });

  } catch (err) {
    // Fire-and-forget: loguear sin relanzar
    console.error('[sendEmail] Error:', err.message);
  }
}

module.exports = { sendEmail };

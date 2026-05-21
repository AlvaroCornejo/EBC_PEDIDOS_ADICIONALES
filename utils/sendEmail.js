const nodemailer = require('nodemailer');
const User       = require('../models/User');
const Config     = require('../models/Config');

async function getSmtpConfig() {
  const docs = await Config.find({ key: { $in: ['smtpHost','smtpPort','smtpUser','smtpPass','smtpFrom','smtpEnabled'] } }).lean();
  const cfg = {};
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

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

async function sendEmail(filter, payload) {
  try {
    const cfg = await getSmtpConfig();
    const enabled = cfg.smtpEnabled === true || cfg.smtpEnabled === 'true';

    if (!enabled) {
      console.log('[sendEmail] Saltando — smtpEnabled=false');
      return;
    }
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
      console.log('[sendEmail] Saltando — credenciales SMTP incompletas');
      return;
    }

    const emails = await resolveEmails(filter);
    if (!emails.length) {
      console.log('[sendEmail] Sin destinatarios para filtro:', JSON.stringify(filter));
      return;
    }

    console.log(`[sendEmail] Enviando "${payload.subject}" → ${emails.join(', ')}`);

    const transporter = nodemailer.createTransport({
      host:   cfg.smtpHost,
      port:   parseInt(cfg.smtpPort, 10) || 587,
      secure: (parseInt(cfg.smtpPort, 10) || 587) === 465,
      auth:   { user: cfg.smtpUser, pass: cfg.smtpPass },
      tls:    { rejectUnauthorized: false }
    });

    const info = await transporter.sendMail({
      from:    cfg.smtpFrom || cfg.smtpUser,
      to:      emails.join(', '),
      subject: payload.subject || 'Pedidos Adicionales',
      html:    payload.body   || payload.subject || ''
    });

    console.log(`[sendEmail] OK — messageId: ${info.messageId}`);
  } catch (err) {
    console.error('[sendEmail] ERROR:', err.message);
  }
}

module.exports = { sendEmail, getSmtpConfig, resolveEmails };

const nodemailer = require('nodemailer');
const User       = require('../models/User');
const Config     = require('../models/Config');

const SMTP_KEYS = ['smtpHost','smtpPort','smtpUser','smtpPass','smtpFrom','smtpEnabled','smtpAuthMethod'];

async function getSmtpConfig() {
  const docs = await Config.find({ key: { $in: SMTP_KEYS } }).lean();
  const cfg = {};
  docs.forEach(d => { cfg[d.key] = d.value; });
  return cfg;
}

/** Crea un transporter nodemailer a partir de la config */
function buildTransport(cfg) {
  const port   = parseInt(cfg.smtpPort, 10) || 587;
  const secure = port === 465;
  // Exchange suele requerir LOGIN; office365 acepta ambos
  const authMethod = cfg.smtpAuthMethod || 'LOGIN';
  return nodemailer.createTransport({
    host:   cfg.smtpHost,
    port,
    secure,
    auth:   { type: authMethod, user: cfg.smtpUser, pass: cfg.smtpPass },
    tls:    { rejectUnauthorized: false }
  });
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
    const cfg     = await getSmtpConfig();
    const enabled = cfg.smtpEnabled === true || cfg.smtpEnabled === 'true';

    if (!enabled) { console.log('[sendEmail] Saltando — smtpEnabled=false'); return; }
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) { console.log('[sendEmail] Saltando — credenciales SMTP incompletas'); return; }

    const emails = await resolveEmails(filter);
    if (!emails.length) { console.log('[sendEmail] Sin destinatarios para filtro:', JSON.stringify(filter)); return; }

    console.log(`[sendEmail] Enviando "${payload.subject}" → ${emails.join(', ')}`);
    const transporter = buildTransport(cfg);
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

module.exports = { sendEmail, getSmtpConfig, buildTransport, resolveEmails };

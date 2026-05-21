const express  = require('express');
const nodemailer = require('nodemailer');
const authMiddleware = require('../middleware/auth');
const Config = require('../models/Config');
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

// POST /api/config/smtp-test  (ADMIN only) — prueba conexión SMTP sin guardar
router.post('/smtp-test', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No autorizado' });
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = req.body;
    if (!smtpHost || !smtpUser || !smtpPass) return res.status(400).json({ error: 'Faltan credenciales SMTP' });
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   parseInt(smtpPort, 10) || 587,
      secure: (parseInt(smtpPort, 10) || 587) === 465,
      auth:   { user: smtpUser, pass: smtpPass },
      tls:    { rejectUnauthorized: false }
    });
    await transporter.verify();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, getConfigObj };

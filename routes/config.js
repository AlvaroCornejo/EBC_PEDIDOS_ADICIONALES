const express = require('express');
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

module.exports = { router, getConfigObj };

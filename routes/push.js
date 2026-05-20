const express = require('express');
const authMiddleware = require('../middleware/auth');
const PushSub = require('../models/PushSub');

const router = express.Router();
router.use(authMiddleware);

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });
    await PushSub.findOneAndUpdate(
      { 'subscription.endpoint': subscription.endpoint },
      {
        userId:      req.user.id,
        role:        req.user.role,
        operations:  req.user.operations || [],
        subscription
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/push/subscribe
router.delete('/subscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await PushSub.deleteOne({ 'subscription.endpoint': endpoint });
    else          await PushSub.deleteMany({ userId: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

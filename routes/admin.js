const express = require('express');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Pedido = require('../models/Pedido');

const router = express.Router();
router.use(authMiddleware);

const adminOnly = (req, res, next) =>
  req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Solo administradores' });

// GET /api/admin/backup
router.get('/backup', adminOnly, async (req, res) => {
  try {
    const users = await User.find().lean();
    const pedidos = await Pedido.find().lean();
    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="pedidos-backup-${fecha}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json({ exportedAt: new Date().toISOString(), users, pedidos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/restore
router.post('/restore', adminOnly, async (req, res) => {
  try {
    const { users, pedidos } = req.body;
    if (!Array.isArray(users) || !Array.isArray(pedidos))
      return res.status(400).json({ error: 'Formato inválido: se requieren arrays de users y pedidos' });

    await User.deleteMany({});
    await Pedido.deleteMany({});
    if (users.length) await User.insertMany(users);
    if (pedidos.length) await Pedido.insertMany(pedidos);

    res.json({ success: true, users: users.length, pedidos: pedidos.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

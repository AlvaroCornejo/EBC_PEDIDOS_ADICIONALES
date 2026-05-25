const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'pedidos-secret-2024';

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ $or: [{ username }, { email: username }] });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, operations: user.operations, puedeConsultarPrecios: !!user.puedeConsultarPrecios },
      SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      token,
      mustChangePassword: user.mustChangePassword === true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, operations: user.operations, mustChangePassword: user.mustChangePassword === true }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si viene currentPassword (cambio voluntario) lo validamos; si no viene (mustChangePassword) no
    if (currentPassword !== undefined) {
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    user.mustChangePassword = false;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/refresh — renueva el token si todavía es válido
router.get('/refresh', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, operations: user.operations, puedeConsultarPrecios: !!user.puedeConsultarPrecios },
      SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

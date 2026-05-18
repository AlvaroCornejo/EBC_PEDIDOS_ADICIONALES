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
      { id: user.id, username: user.username, role: user.role, operations: user.operations },
      SECRET,
      { expiresIn: '8h' }
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
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ id: req.user.id }, { password: hashed, mustChangePassword: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

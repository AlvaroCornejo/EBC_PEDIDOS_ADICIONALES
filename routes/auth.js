const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, operations: user.operations } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

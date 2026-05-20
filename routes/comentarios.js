const express = require('express');
const authMiddleware = require('../middleware/auth');
const Comentario = require('../models/Comentario');

const router = express.Router();
router.use(authMiddleware);

// GET /api/comentarios  — comentarios generales
router.get('/', async (req, res) => {
  try {
    const comentarios = await Comentario.find({ pedidoId: 'general' })
      .sort({ createdAt: 1 }).lean();
    res.json(comentarios);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/comentarios
router.post('/', async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto?.trim()) return res.status(400).json({ error: 'texto requerido' });
    const c = new Comentario({
      pedidoId: 'general',
      userId:   req.user.id,
      username: req.user.username,
      role:     req.user.role,
      texto:    texto.trim()
    });
    await c.save();
    res.json(c.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

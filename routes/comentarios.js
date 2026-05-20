const express = require('express');
const authMiddleware = require('../middleware/auth');
const Comentario = require('../models/Comentario');

const router = express.Router();
router.use(authMiddleware);

// GET /api/comentarios?pedidoId=xxx
router.get('/', async (req, res) => {
  try {
    const { pedidoId } = req.query;
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId requerido' });
    const comentarios = await Comentario.find({ pedidoId }).sort({ createdAt: 1 }).lean();
    res.json(comentarios);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/comentarios
router.post('/', async (req, res) => {
  try {
    const { pedidoId, fase, texto, parentId } = req.body;
    if (!pedidoId || !texto?.trim()) return res.status(400).json({ error: 'pedidoId y texto son requeridos' });
    const c = new Comentario({
      pedidoId,
      fase:     fase || '',
      userId:   req.user.id,
      username: req.user.username,
      role:     req.user.role,
      texto:    texto.trim(),
      parentId: parentId || null
    });
    await c.save();
    res.json(c.toObject());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

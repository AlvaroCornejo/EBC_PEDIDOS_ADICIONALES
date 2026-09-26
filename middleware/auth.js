const jwt = require('jsonwebtoken');
const { esInactivo } = require('../utils/usuariosInactivos');
const SECRET = process.env.JWT_SECRET || 'pedidos-secret-2024';

module.exports = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(auth.slice(7), SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  try {
    if (await esInactivo(req.user.id)) return res.status(401).json({ error: 'Usuario desactivado' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
};

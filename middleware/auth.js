const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'pedidos-secret-2024';

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(auth.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

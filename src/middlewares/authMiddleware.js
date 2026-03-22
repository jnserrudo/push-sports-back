const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token de autenticación no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET no está definido en las variables de entorno.');
    return res.status(500).json({ message: 'Error de configuración del servidor.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(403).json({ message: 'Token inválido o expirado' });
  }
};

const roleMiddleware = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.user || !req.user.id_rol) {
      return res.status(401).json({ message: 'No se encontró el rol del usuario' });
    }

    if (!rolesPermitidos.includes(req.user.id_rol)) {
      return res.status(403).json({ message: 'No tienes permiso para realizar esta acción' });
    }

    return next();
  };
};

module.exports = { authMiddleware, roleMiddleware };

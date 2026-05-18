const { setAuditContext } = require('../services/auditService');

/**
 * Middleware de impersonación
 * Permite que un admin (rol 1) actúe en nombre de otro usuario
 * Modifica req.user para reflejar el usuario impersonado
 * Preserva req.realUser con los datos del admin
 */
const impersonationMiddleware = (req, res, next) => {
    // Solo procesar si hay usuario autenticado
    if (!req.user) {
        return next();
    }

    // Verificar si hay datos de impersonación en el token
    const impersonation = req.user.impersonation;
    
    if (impersonation && impersonation.realUserId && impersonation.impersonatedUserId) {
        // Validar que el usuario real sea admin (rol 1)
        if (req.user.id_rol !== 1) {
            return res.status(403).json({ 
                error: 'Solo los administradores pueden impersonar usuarios' 
            });
        }

        // Preservar el usuario admin original
        req.realUser = {
            id_usuario: impersonation.realUserId,
            email: impersonation.realUserEmail,
            id_rol: 1,
            nombre: impersonation.realUserName
        };

        // Establecer el usuario impersonado como usuario efectivo
        req.impersonatedUser = {
            id_usuario: impersonation.impersonatedUserId,
            email: impersonation.impersonatedUserEmail,
            id_rol: impersonation.impersonatedUserRol,
            nombre: impersonation.impersonatedUserName,
            id_comercio_asignado: impersonation.impersonatedUserComercio
        };

        // Modificar req.user para que refleje el usuario impersonado
        // Esto permite que el resto de la aplicación funcione normalmente
        req.user = {
            ...req.impersonatedUser,
            // Mantener el token original para validaciones
            _isImpersonated: true,
            _realUserId: req.realUser.id_usuario
        };

        // Inyectar contexto de impersonación en auditoría
        setAuditContext({
            userId: req.user.id_usuario,
            realUserId: req.realUser.id_usuario,
            impersonatedUserId: req.impersonatedUser.id_usuario
        });
    }

    next();
};

module.exports = { impersonationMiddleware };

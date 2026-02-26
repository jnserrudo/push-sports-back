const prisma = require('../config/prisma');

/**
 * Crea una notificación para un usuario específico.
 */
const createNotification = async ({ id_usuario, titulo, mensaje, tipo = 'INFO' }) => {
    try {
        const notification = await prisma.notificacion.create({
            data: {
                id_usuario,
                titulo,
                mensaje,
                tipo,
                leido: false
            }
        });
        return notification;
    } catch (error) {
        console.error('Error al crear notificación:', error);
        return null;
    }
};

/**
 * Envía una notificación a todos los administradores (SUPER_ADMIN)
 */
const notifyAdmins = async ({ titulo, mensaje, tipo = 'SYSTEM' }) => {
    try {
        const admins = await prisma.usuario.findMany({
            where: { id_rol: 1, activo: true }
        });

        const notifications = await Promise.all(
            admins.map(admin => createNotification({
                id_usuario: admin.id_usuario,
                titulo,
                mensaje,
                tipo
            }))
        );
        return notifications;
    } catch (error) {
        console.error('Error al notificar admins:', error);
        return [];
    }
};

/**
 * Envía una notificación a todos los supervisores/gestores de un comercio específico
 */
const notifyCommerceManagers = async (id_comercio, { titulo, mensaje, tipo = 'COMMERCE' }) => {
    try {
        const managers = await prisma.usuario.findMany({
            where: { 
                id_comercio_asignado: id_comercio, 
                id_rol: 2, 
                activo: true 
            }
        });

        const notifications = await Promise.all(
            managers.map(manager => createNotification({
                id_usuario: manager.id_usuario,
                titulo,
                mensaje,
                tipo
            }))
        );
        return notifications;
    } catch (error) {
        console.error('Error al notificar managers del comercio:', error);
        return [];
    }
};

module.exports = {
    createNotification,
    notifyAdmins,
    notifyCommerceManagers
};
